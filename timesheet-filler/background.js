const TIME_CARD_URL = "https://corp.go.paylocity.com/time/time-card";
const LOGIN_HOST = "2000access.paylocity.com";
const APP_HOST = "corp.go.paylocity.com";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const CAPTURE_TIMEOUT_MS = 60 * 1000;
const MAX_PER_REQUEST = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// While a first-use cost center load runs, keep showing its headline text (except when the user must act).
let headline = null;

const setStatus = async (state, message, force = false) => {
  if (state === "running" && headline && !force) message = headline;
  await chrome.storage.session.set({ status: { state, message, at: Date.now() } });
  const badge = { running: ["…", "#1a73e8"], done: ["OK", "#188038"], error: ["ERR", "#d93025"] }[state];
  await chrome.action.setBadgeText({ text: badge ? badge[0] : "" });
  if (badge) await chrome.action.setBadgeBackgroundColor({ color: badge[1] });
};

// Everything injected into the page runs in the page's own world, where capture.js keeps the API headers.
const runInTab = async (tabId, func, args = []) => {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  return result.result;
};

// Runs in the page: click "Single Sign-On" on the login screen, and report whether we hold API headers yet.
const probePage = () => {
  if (location.hostname.endsWith("2000access.paylocity.com")) {
    for (const el of document.querySelectorAll("a, button, input[type=submit], input[type=button]")) {
      const label = (el.textContent || el.value || "").trim();
      if (/single\s*sign[\s-]*on/i.test(label)) {
        el.click();
        return { clickedSso: true };
      }
    }
    return {};
  }
  const capture = window.__tpCapture;
  return { hooked: Boolean(capture), ready: Boolean(capture && capture.headers && capture.headers.authorization) };
};

const waitForTimeCard = async (tabId) => {
  const loginDeadline = Date.now() + LOGIN_TIMEOUT_MS;
  let captureDeadline = null;
  let lastSsoClick = 0;
  let reloadedForHook = false;

  while (true) {
    await sleep(1500);
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== "complete") continue;

    // Without the "tabs" permission a tab's address is only visible on the two Paylocity hosts we have access to.
    // Anywhere else (the company's identity provider, mid sign-in) it is undefined: keep waiting.
    const url = tab.url ? new URL(tab.url) : null;
    if (url && url.hostname === LOGIN_HOST) {
      captureDeadline = null;
      if (Date.now() > loginDeadline) throw new Error("Timed out waiting for you to sign in.");
      await setStatus("running", "Waiting for sign-in…", true);
      // Click SSO at most every 10s so a user finishing the identity-provider step isn't interrupted.
      if (Date.now() - lastSsoClick > 10000) {
        const probe = await runInTab(tabId, probePage);
        if (probe.clickedSso) lastSsoClick = Date.now();
      }
    } else if (!url || url.hostname !== APP_HOST) {
      if (Date.now() > loginDeadline) throw new Error("Timed out waiting for you to sign in.");
    } else if (!url.pathname.startsWith("/time/time-card")) {
      captureDeadline = null;
      await chrome.tabs.update(tabId, { url: TIME_CARD_URL });
    } else {
      captureDeadline = captureDeadline ?? Date.now() + CAPTURE_TIMEOUT_MS;
      const probe = await runInTab(tabId, probePage);
      if (probe.ready) return;
      if (!probe.hooked && !reloadedForHook) {
        // The tab was open before the extension was installed/updated, so our capture script isn't in it yet.
        reloadedForHook = true;
        await chrome.tabs.reload(tabId);
        captureDeadline = null;
      } else if (Date.now() > captureDeadline) {
        throw new Error("The time card loaded but no API session was detected. Reload the page and try again.");
      }
    }
  }
};

// Reuse the tab the user is on and only navigate when it isn't already showing the time card.
const openTimeCard = async (tabId) => {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ? new URL(tab.url) : null;
  const onTimeCard = url && url.hostname === APP_HOST && url.pathname.startsWith("/time/time-card");
  if (!onTimeCard) await chrome.tabs.update(tabId, { url: TIME_CARD_URL });
};

// ---- Executed inside the time card page (same origin as the API). Must be self-contained. ----
// plan.action "load": who am I, which cost center levels the policy shows, their options and my defaults.
// plan.action "save": PATCH the prepared chunks of entries.
const apiInPage = async (plan) => {
  const capture = window.__tpCapture;
  if (!capture || !capture.headers.authorization) return { unauthorized: true };

  const call = async (method, path, { query, body } = {}) => {
    const url = new URL(`/api-gw${path}`, location.origin);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const headers = { accept: "application/json", ...capture.headers };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(url, { method, headers, credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 401) {
      const error = new Error("The session expired (401).");
      error.unauthorized = true;
      throw error;
    }
    if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}) ${(await response.text()).slice(0, 300)}`);
    const text = await response.text();
    return { data: text ? JSON.parse(text) : null, next: response.headers.get("x-pcty-next-token") };
  };

  // The API pages its lists with a next-token header.
  const all = async (path, query) => {
    const items = [];
    let next = null;
    do {
      const page = await call("GET", path, { query: next ? { ...query, nextToken: next } : query });
      items.push(...page.data);
      next = page.next;
    } while (next);
    return items;
  };

  try {
    if (plan.action === "load") {
      const me = (await call("GET", "/security/v1/userinfo")).data;
      const companyId = me.pcty_co;
      const employeeId = me.pcty_id;
      const employee = (await call("POST", `/time/v2/companyAssociations/${companyId}/employeeSearches`, { body: { employees: [{ companyId, employeeId }] } })).data[0];
      const policy = (await call("GET", `/time/v2/companyAssociations/${companyId}/policies/${employee.policyId}/costCenters`)).data;
      const levels = policy.displayCostCenterLevels.length ? policy.displayCostCenterLevels : policy.transferableCostCenterLevels;

      const path = `/time/v2/companies/${companyId}/employees/${employeeId}/costCenterAssignments`;
      const fields = "id,isDefault,name,code,level";
      const defaults = await all(path, { fields, isDefault: "true", limit: "1000" });
      const options = [];
      for (const level of levels) options.push(...(await all(path, { fields, level: String(level), limit: "1000" })));
      return {
        companyId,
        employeeId,
        defaults: defaults.map((d) => ({ id: d.id, level: d.level })),
        // Same wording as the time card's own dropdown: "code - name".
        options: options.map((o) => ({ label: `${o.code} - ${o.name}`, id: o.id, level: o.level })),
      };
    }

    // "save" and "delete" both report how many entries they got through (`done`), also when they fail midway.
    let done = 0;
    try {
      if (plan.action === "delete") {
        const wanted = new Set(plan.dates);
        const sorted = [...wanted].sort();
        const nextDay = (iso) => {
          const d = new Date(`${iso}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1);
          return d.toISOString().slice(0, 10);
        };
        // Everything the time card holds for those days (a duration day is a clock-in/clock-out pair).
        const path = `/time/v2/companies/${plan.companyId}/employees/${plan.employeeId}/timeEntries`;
        const filter = `relativeEntryTime ge '${sorted[0]}T00:00:00' AND relativeEntryTime lt '${nextDay(sorted[sorted.length - 1])}T00:00:00'`;
        const entries = [];
        for (let offset = 0; ; offset += 100) {
          const page = (await call("GET", path, { query: { filter, limit: "100", offset: String(offset) } })).data;
          entries.push(...page);
          if (page.length < 100) break;
        }
        const idsByDay = new Map();
        for (const entry of entries) {
          const day = entry.relativeEntryTime.slice(0, 10);
          if (!wanted.has(day)) continue;
          if (!idsByDay.has(day)) idsByDay.set(day, []);
          idsByDay.get(day).push(entry.id);
        }
        // Whole days per request, so a clock-in is never separated from its clock-out.
        const chunks = [[]];
        for (const ids of idsByDay.values()) {
          if (chunks[chunks.length - 1].length && chunks[chunks.length - 1].length + ids.length > 50) chunks.push([]);
          chunks[chunks.length - 1].push(...ids);
        }
        for (const ids of chunks.filter((c) => c.length)) {
          await call("POST", `/time/v2/companyAssociations/${plan.companyId}/timeEntryRemovalRequests`, { body: { ids } });
          done += ids.length;
        }
        return { done, days: idsByDay.size };
      }

      for (const chunk of plan.chunks) {
        await call("PATCH", `/time/v2/companyAssociations/${plan.companyId}/timeEntryDurations`, { body: chunk });
        done += chunk.length;
      }
    } catch (error) {
      return { error: error.message, unauthorized: Boolean(error.unauthorized), done };
    }
    return { done };
  } catch (error) {
    return { error: error.message, unauthorized: Boolean(error.unauthorized) };
  }
};

// Runs a step in the page. No result at all means the page navigated away and took the script with it; a
// 401 means the captured token went stale, so reload for a fresh one. Reading is retried once; saving only
// when the 401 came before anything was saved.
const runApi = async (tabId, plan) => {
  for (let attempt = 0; ; attempt++) {
    const result = await runInTab(tabId, apiInPage, [plan]);
    if (!result) {
      if (plan.action === "load" && attempt === 0) {
        await sleep(1500);
        await waitForTimeCard(tabId);
        continue;
      }
      throw new Error("The page reloaded or navigated while working, so the result was lost. Check the time card before retrying.");
    }
    if (result.unauthorized && attempt === 0 && !result.done) {
      await chrome.tabs.reload(tabId);
      await sleep(1500);
      await waitForTimeCard(tabId);
      continue;
    }
    if (result.error || result.unauthorized) {
      const verb = plan.action === "delete" ? "deleted" : "saved";
      const partial = result.done ? ` ${result.done} entr${result.done === 1 ? "y was" : "ies were"} ${verb} before it failed; check the time card before retrying.` : "";
      throw new Error(`${result.error || "Not signed in."}${partial}`);
    }
    return result;
  }
};

// ---- cost centers ----
const findOption = (query, options) => {
  const q = query.trim().toLowerCase();
  const labels = options.map((option) => option.label.toLowerCase());
  let index = labels.indexOf(q);
  if (index < 0) index = labels.findIndex((label) => label.startsWith(q));
  if (index < 0) index = labels.findIndex((label) => label.includes(q));
  return index < 0 ? null : options[index];
};

const rememberCostCenters = async (options) => {
  const names = [...new Set(options.map((option) => option.label))].sort((a, b) => a.localeCompare(b));
  if (names.length) await chrome.storage.local.set({ costCenterOptions: names });
};

// An entry's cost centers: one id per level. The levels the policy shows come from the chosen option, every
// other level from the employee's defaults, ordered by level (what the time card itself sends).
const costCenterIds = (option, defaults) => {
  const byLevel = new Map(defaults.map((d) => [d.level, d.id]));
  byLevel.set(option.level, option.id);
  return [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);
};

const handleJob = async (message) => {
  // Without a tab id (e.g. started from the settings page) the job gets a tab of its own.
  const ownTab = message.tabId === undefined;
  let tabId = message.tabId;
  if (ownTab) tabId = (await chrome.tabs.create({ url: TIME_CARD_URL, active: true })).id;
  else await openTimeCard(tabId);
  await waitForTimeCard(tabId);

  await setStatus("running", "Reading cost centers…");
  const me = await runApi(tabId, { action: "load" });
  await rememberCostCenters(me.options);

  if (message.type === "scan") {
    if (ownTab) await chrome.tabs.remove(tabId);
    await setStatus("done", "Cost centers loaded.");
    return;
  }

  if (message.type === "delete") {
    await setStatus("running", "Deleting entries…");
    const { done, days } = await runApi(tabId, { action: "delete", companyId: me.companyId, employeeId: me.employeeId, dates: message.dates });
    if (!done) {
      await setStatus("done", "No entries found on the selected days.");
      return;
    }
    await chrome.tabs.reload(tabId);
    await setStatus("done", `Deleted ${done} entr${done === 1 ? "y" : "ies"} on ${days} day${days === 1 ? "" : "s"}.`);
    return;
  }

  const { workEntries, vacEntries, vacCostCenter, note } = message.job;
  const entries = [...workEntries, ...vacEntries.map((e) => ({ date: e.date, costCenter: vacCostCenter, hours: e.hours }))];

  // Resolve every name before anything is saved, so a typo stops the run with nothing written.
  const resolved = new Map();
  const missing = [];
  for (const name of new Set(entries.map((entry) => entry.costCenter))) {
    const option = findOption(name, me.options);
    if (option) resolved.set(name, option);
    else missing.push(name);
  }
  if (missing.length) throw new Error(`No cost center matches: ${missing.join(", ")}. Nothing was saved.`);

  const items = entries.map((entry) => ({
    companyId: me.companyId,
    employeeId: me.employeeId,
    durationHours: entry.hours,
    relativeEntryDate: entry.date,
    origin: "web",
    note: note || "",
    costCenterIds: costCenterIds(resolved.get(entry.costCenter), me.defaults),
  }));
  const chunks = [];
  for (let i = 0; i < items.length; i += MAX_PER_REQUEST) chunks.push(items.slice(i, i + MAX_PER_REQUEST));

  // Replace, don't add: clear whatever the time card already holds on these days so nothing doubles up.
  await setStatus("running", "Clearing existing entries on those days…");
  const dates = message.job.clearDates && message.job.clearDates.length ? message.job.clearDates : [...new Set(entries.map((entry) => entry.date))];
  const cleared = await runApi(tabId, { action: "delete", companyId: me.companyId, employeeId: me.employeeId, dates });

  await setStatus("running", `Saving ${items.length} entr${items.length === 1 ? "y" : "ies"}…`);
  try {
    await runApi(tabId, { action: "save", companyId: me.companyId, chunks });
  } catch (error) {
    if (cleared.done) error.message += ` The ${cleared.done} existing entr${cleared.done === 1 ? "y" : "ies"} on those days had already been deleted.`;
    throw error;
  }

  // The API doesn't update what the page is showing, so refresh it.
  await chrome.tabs.reload(tabId);
  await setStatus("done", `Saved ${items.length} entr${items.length === 1 ? "y" : "ies"}.`);
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "progress") {
    setStatus("running", message.message);
    return false;
  }
  if (message.type === "openPopup") {
    if (!chrome.action.openPopup) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.action.openPopup().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true; // async response
  }
  if (message.type !== "submit" && message.type !== "scan" && message.type !== "delete") return false;
  headline = message.type === "scan" && message.firstTime ? "First time use… loading Cost Centers" : null;
  setStatus("running", "Starting…")
    .then(() => handleJob(message))
    .catch(async (error) => {
      console.error("Timesheet Filler failed", error);
      headline = null;
      await setStatus("error", error.message);
    })
    .finally(() => {
      headline = null;
    });
  return false;
});
