// Runs on the time card site. A manager's link carries a cost center split in the URL hash; we keep it
// the moment the page starts loading (sign-in redirects drop the hash), then offer to apply it once the
// user is on the time card.
(() => {
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
  const TIME_CARD_PATH = "/time/time-card";

  const code = Share.codeFromHash(location.hash);
  if (code && Share.decode(code)) chrome.storage.local.set({ pendingSplit: { code, at: Date.now() } });

  let shown = false;

  const lookup = (options, name) => {
    const q = name.trim().toLowerCase();
    return options.some((option) => option.toLowerCase() === q || option.toLowerCase().startsWith(q) || option.toLowerCase().includes(q));
  };

  const applySplit = async (split) => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({
      settings: { ...settings, template: { ccNames: split.names, percents: split.percents, half: false } },
      applyTemplateNext: true,
      prefillMonthNext: true, // the popup clears the selection and marks every workday of the month
    });
    await chrome.storage.local.remove("pendingSplit");
  };

  const showBanner = (split, missing) => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .bar { font: 14px/1.4 system-ui, sans-serif; background: #202124; color: #fff; padding: 10px 16px; display: flex; gap: 16px; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
      .text { flex: 1; } .title { font-weight: 600; } .split, .warn { opacity: .85; font-size: 13px; } .warn { color: #fdd663; }
      button { font: inherit; border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
      .apply { background: #8ab4f8; color: #202124; } .dismiss { background: transparent; color: #fff; border: 1px solid #5f6368; }`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const text = document.createElement("div");
    text.className = "text";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `Timesheet Filler: your manager shared a cost center split${split.label ? ` for ${split.label}` : ""}`;
    const detail = document.createElement("div");
    detail.className = "split";
    detail.textContent = split.names.map((name, i) => `${name} ${split.percents[i]}%`).join("  ·  ");
    const effect = document.createElement("div");
    effect.className = "split";
    effect.textContent = "Applying clears your current selection and marks every workday of this month. Add your holidays after.";
    text.append(title, detail, effect);
    if (missing.length) {
      const warn = document.createElement("div");
      warn.className = "warn";
      warn.textContent = `Not found in your cost center list: ${missing.join(", ")}. Check the spelling with your manager.`;
      text.append(warn);
    }
    const apply = document.createElement("button");
    apply.className = "apply";
    apply.textContent = missing.length ? "Apply anyway" : "Apply";
    const dismiss = document.createElement("button");
    dismiss.className = "dismiss";
    dismiss.textContent = "Dismiss";
    bar.append(text, apply, dismiss);
    root.append(style, bar);
    document.documentElement.append(host);

    apply.addEventListener("click", async () => {
      await applySplit(split);
      // Ask the background worker to open the popup; it can fail (older Chrome, no focused window).
      const opened = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "openPopup" }, (response) => {
            void chrome.runtime.lastError;
            resolve(Boolean(response && response.ok));
          });
        } catch {
          resolve(false);
        }
      });
      text.textContent = opened ? "Applied." : "Applied. Click the Timesheet Filler icon in your toolbar to use it.";
      apply.remove();
      dismiss.textContent = "Close";
      setTimeout(() => host.remove(), opened ? 1500 : 6000);
    });
    dismiss.addEventListener("click", async () => {
      await chrome.storage.local.remove("pendingSplit");
      host.remove();
    });
  };

  // The app routes client-side (login lands here without a new page load), so poll rather than load once.
  const check = async () => {
    if (shown || !location.pathname.startsWith(TIME_CARD_PATH)) return;
    const { pendingSplit, costCenterOptions = [] } = await chrome.storage.local.get(["pendingSplit", "costCenterOptions"]);
    if (!pendingSplit) return;
    if (Date.now() - pendingSplit.at > PENDING_TTL_MS) {
      await chrome.storage.local.remove("pendingSplit");
      return;
    }
    const split = Share.decode(pendingSplit.code);
    if (!split) return;
    shown = true;
    const missing = costCenterOptions.length ? split.names.filter((name) => !lookup(costCenterOptions, name)) : [];
    showBanner(split, missing);
  };

  setInterval(check, 1500);
})();
