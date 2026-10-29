const DEFAULT_SETTINGS = { vacCostCenter: "Admin - VacHol", note: "", weekStart: "monday", limitHours: true, holidays: "cz", template: null };
const DEFAULT_SPLIT_STEP = 5;
const FULL_DAY = 8;
const HALF_DAY = 4;
const MAX_COST_CENTERS = 10;
const SCAN_RETRY_MS = 10 * 60 * 1000;
const FIRST_USE_TEXT = "First time use… loading Cost Centers";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COLORS = { work: "#1a73e8", vac: "#f9ab00", none: "#f8f9fa" };

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULT_SETTINGS };
// Adjustable in the popup but never saved: every time the popup opens it starts back at the default.
let splitStep = DEFAULT_SPLIT_STEP;
let percentInputs = [];
// work / vac map "yyyy-MM-dd" -> hours (4 or 8); a day can hold a half of each.
let state = { month: null, multi: false, half: false, rangeStart: null, work: {}, vac: {}, ccCount: 1, ccNames: [""], percents: [100] };

const pad = (n) => String(n).padStart(2, "0");
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const keyOf = (date) => toKey(date.getFullYear(), date.getMonth(), date.getDate());
const hoursPerClick = () => (state.half ? HALF_DAY : FULL_DAY);
const mondayFirst = () => settings.weekStart !== "sunday";
// Bank holidays are blacked out and can't be edited (Czechia by default, switch off in settings).
const holidayName = (key) => (settings.holidays === "none" ? null : Holidays.nameOf(key));
const stripHolidays = () => {
  for (const map of [state.work, state.vac]) for (const key of Object.keys(map)) if (holidayName(key)) delete map[key];
};

const save = () => chrome.storage.local.set({ popupState: state });

const equalPercents = (count) => {
  const base = Math.floor(100 / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? 100 - base * (count - 1) : base));
};

// Nearest multiple of the step, with 100 always available as the last stop.
const snapPercent = (value) => {
  const stops = [];
  for (let p = 0; p <= 100; p += splitStep) stops.push(p);
  if (stops[stops.length - 1] !== 100) stops.push(100);
  return stops.reduce((best, stop) => (Math.abs(stop - value) < Math.abs(best - value) ? stop : best));
};

const normalizeCostCenters = () => {
  state.ccCount = Math.min(Math.max(state.ccCount, 1), MAX_COST_CENTERS);
  state.ccNames = Array.from({ length: state.ccCount }, (_, i) => state.ccNames[i] || "");
  if (state.percents.length !== state.ccCount) state.percents = equalPercents(state.ccCount);
};

// Cost center count, names, split and half-day come from the settings template (or blank without one).
const applyTemplate = () => {
  const t = settings.template;
  state.ccCount = t ? t.ccNames.length : 1;
  state.ccNames = t ? [...t.ccNames] : [""];
  state.percents = t && t.percents.length === t.ccNames.length ? [...t.percents] : equalPercents(state.ccCount);
  state.half = Boolean(t && t.half);
};

// Marks every weekday of the shown month that isn't a bank holiday as a full work day.
const fillMonthWithWorkdays = () => {
  const [year, month] = state.month.split("-").map(Number);
  for (const d = new Date(year, month - 1, 1); d.getMonth() === month - 1; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6 || holidayName(keyOf(d))) continue;
    state.work[keyOf(d)] = FULL_DAY;
  }
};

const clearEverything = () => {
  state.work = {};
  state.vac = {};
  state.rangeStart = null;
  state.multi = false;
  applyTemplate();
  state.half = false; // clearing always unticks half day, whatever the template says
  refresh();
};

// ---- day state ----
// A day holds at most a full day. Adding one kind keeps whatever room is left for the other kind,
// so a half-day click on a full day only replaces half of it.
const trimToRoom = (map, key, room) => {
  if (room <= 0) delete map[key];
  else if (map[key] > room) map[key] = room;
};
const setWork = (key, hours) => {
  state.work[key] = hours;
  trimToRoom(state.vac, key, FULL_DAY - hours);
};
const setVac = (key, hours) => {
  state.vac[key] = hours;
  trimToRoom(state.work, key, FULL_DAY - hours);
};

// ---- calendar ----
const tileBackground = (work, vac) => {
  if (work === FULL_DAY) return null;
  if (vac === FULL_DAY) return null;
  // Half day(s): work on the top-left triangle, vacation on the bottom-right.
  return `linear-gradient(135deg, ${work ? COLORS.work : COLORS.none} 50%, ${vac ? COLORS.vac : COLORS.none} 50%)`;
};

const renderCalendar = () => {
  const [year, month] = state.month.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  $("monthLabel").textContent = `${MONTHS[month - 1]} ${year}`;

  const cal = $("calendar");
  cal.innerHTML = "";
  for (const dow of mondayFirst() ? ["M", "T", "W", "T", "F", "S", "S"] : ["S", "M", "T", "W", "T", "F", "S"]) {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = dow;
    cal.append(el);
  }
  const blanks = mondayFirst() ? (first.getDay() + 6) % 7 : first.getDay();
  for (let i = 0; i < blanks; i++) {
    const el = document.createElement("div");
    el.className = "blank";
    cal.append(el);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toKey(year, month - 1, d);
    const el = document.createElement("div");
    const weekday = new Date(year, month - 1, d).getDay();
    el.className = "day" + (weekday === 0 || weekday === 6 ? " weekend" : "");
    const holiday = holidayName(key);
    if (holiday) {
      el.classList.add("holiday");
      el.title = holiday;
      el.textContent = d;
      el.addEventListener("contextmenu", (event) => event.preventDefault());
      cal.append(el);
      continue;
    }
    const work = state.work[key] || 0;
    const vac = state.vac[key] || 0;
    if (work === FULL_DAY) el.classList.add("work");
    else if (vac === FULL_DAY) el.classList.add("vac");
    else if (work || vac) {
      el.classList.add("half");
      if (work && vac) el.classList.add("mixed");
      el.style.background = tileBackground(work, vac);
    }
    if (work || vac) el.title = [work && `Work ${work}h`, vac && `${settings.vacCostCenter} ${vac}h`].filter(Boolean).join(" · ");
    if (key === state.rangeStart) el.classList.add("anchor");
    el.textContent = d;
    el.addEventListener("click", () => toggleWork(key));
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      toggleVac(key);
    });
    cal.append(el);
  }
};

// One line per run of holidays in the displayed month, e.g. "24-26th: Christmas".
const renderHolidayLegend = () => {
  const [year, month] = state.month.split("-").map(Number);
  const legend = $("holidays");
  legend.innerHTML = "";
  const lines = settings.holidays === "none" ? [] : Holidays.legend(year, month - 1);
  for (const { range, label } of lines) {
    const row = document.createElement("div");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    row.append(swatch, " " + range + ": " + label);
    legend.append(row);
  }
};

// Weekdays from a to b inclusive (either order); a range's own endpoints are taken even on a weekend.
const workdaysBetween = (a, b) => {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const days = [];
  for (const d = new Date(`${from}T00:00:00`); keyOf(d) <= to; d.setDate(d.getDate() + 1)) {
    const key = keyOf(d);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if ((!weekend || key === from || key === to) && !holidayName(key)) days.push(key);
  }
  return days;
};

// Clicking a kind that's already on the day toggles it off; with half day ticked, a full day of
// that kind is cut down to half instead of removed.
const toggleKind = (map, setter, key) => {
  const current = map[key] || 0;
  if (current && !(state.half && current === FULL_DAY)) delete map[key];
  else setter(key, hoursPerClick());
};

// Range mode (left or right click): the first click sets the start, the second click the end, and the end
// click's button decides the kind (left = work, right = vacation). Range mode then switches itself off.
// A range replaces what's on the days: a vacation range over a filled-in month turns those days into vacation
// (with Half day ticked only half of each day is replaced, like a single click).
const rangeClick = (key, kind) => {
  if (!state.rangeStart) {
    state.rangeStart = key;
    return;
  }
  const hours = hoursPerClick();
  const set = kind === "work" ? setWork : setVac;
  for (const day of workdaysBetween(state.rangeStart, key)) set(day, hours);
  state.rangeStart = null;
  state.multi = false;
};

const toggleWork = (key) => {
  if (holidayName(key)) return;
  if (state.multi) rangeClick(key, "work");
  else toggleKind(state.work, setWork, key);
  refresh();
};

const toggleVac = (key) => {
  if (holidayName(key)) return;
  if (state.multi) rangeClick(key, "vac");
  else toggleKind(state.vac, setVac, key);
  refresh();
};

// ---- cost centers ----
const renderPickers = () => {
  $("ccCount").innerHTML = "";
  $("ccCount").append(
    CostCenterCount.create({
      value: state.ccCount,
      max: MAX_COST_CENTERS,
      onChange: (count) => {
        state.ccCount = count;
        state.percents = equalPercents(count);
        refresh();
      },
    }),
  );

  const pickers = $("ccPickers");
  pickers.innerHTML = "";
  percentInputs = [];
  state.ccNames.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "cc-row";
    row.append(
      CostCenterPicker.create({
        value: name,
        onChange: (value) => {
          state.ccNames[i] = value;
          updateDerived();
        },
      }),
    );
    if (state.ccCount > 1) {
      const pct = document.createElement("input");
      pct.type = "number";
      pct.className = "pct";
      pct.min = 0;
      pct.max = 100;
      pct.addEventListener("input", () => {
        const value = Math.min(100, Math.max(0, Number(pct.value) || 0));
        state.percents[i] = value;
        if (state.ccCount === 2) state.percents[1 - i] = 100 - value;
        updateDerived();
      });
      percentInputs.push(pct);
      row.append(pct, "%");
    }
    pickers.append(row);
  });
};

// Keep the percent boxes and slider in step with state without disturbing a box being typed in.
const renderSplit = () => {
  percentInputs.forEach((input, i) => {
    if (document.activeElement !== input) input.value = state.percents[i];
  });
  $("splitBox").hidden = state.ccCount !== 2;
  if (state.ccCount === 2) {
    $("split").value = state.percents[0];
    $("splitStep").value = splitStep;
  }
};

// ---- summary / submit ----
const buildJob = () => {
  const days = Object.keys(state.work).sort().map((date) => ({ date, hours: state.work[date] }));
  return {
    workEntries: days.length ? allocateHours(days, state.ccNames, state.percents) : [],
    vacEntries: Object.keys(state.vac).sort().map((date) => ({ date, hours: state.vac[date] })),
    vacCostCenter: settings.vacCostCenter,
    note: settings.note,
    // What Submit clears first: the marked days plus the weekends and bank holidays between them.
    clearDates: daysToDelete(),
  };
};

const weekdaysIn = (year, monthIndex) => {
  let count = 0;
  for (let d = new Date(year, monthIndex, 1); d.getMonth() === monthIndex; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6 && !holidayName(keyOf(d))) count += 1;
  }
  return count;
};

// A month can't hold more hours (work + vacation) than its Monday-Friday days x 8; selecting weekend days is
// what pushes a month over. Turn the check off in settings.
const monthsOverLimit = () => {
  const totals = {};
  for (const map of [state.work, state.vac]) {
    for (const [key, hours] of Object.entries(map)) totals[key.slice(0, 7)] = (totals[key.slice(0, 7)] || 0) + hours;
  }
  return Object.entries(totals).sort().flatMap(([monthKey, total]) => {
    const [year, month] = monthKey.split("-").map(Number);
    const days = weekdaysIn(year, month - 1);
    const limit = days * FULL_DAY;
    return total > limit ? [`${MONTHS[month - 1]} ${year}: ${total}h is over the ${limit}h limit (${days} workdays × ${FULL_DAY}h).`] : [];
  });
};

// Everything still needed before Submit can be used.
const problems = () => {
  const found = [];
  if (settings.limitHours !== false) found.push(...monthsOverLimit());
  const workDays = Object.keys(state.work).length;
  if (!workDays && !Object.keys(state.vac).length) found.push("Pick at least one day.");
  if (workDays) {
    const names = state.ccNames;
    if (names.some((name) => !name)) found.push(names.length === 1 ? "Choose a cost center." : "Choose all cost centers.");
    const filled = names.filter(Boolean).map((name) => name.toLowerCase());
    if (new Set(filled).size !== filled.length) found.push("Each cost center can only be chosen once.");
    const total = state.percents.reduce((a, b) => a + b, 0);
    if (total !== 100) found.push(`Percentages must add up to 100 (now ${total}).`);
  }
  return found;
};

const formatHours = (hours) => `${Number(hours.toFixed(2))}h`;

// Hours each cost center ends up with, from the same allocation that gets submitted.
const workSubtotals = () => {
  const totals = state.ccNames.map(() => 0);
  const days = Object.keys(state.work).sort().map((date) => ({ date, hours: state.work[date] }));
  if (!days.length) return totals;
  // Allocate by position so empty or duplicate names can't collide.
  for (const entry of allocateHours(days, state.ccNames.map((_, i) => String(i)), state.percents)) {
    totals[Number(entry.costCenter)] += entry.hours;
  }
  return totals;
};

// ---- delete entries (two clicks: the first one arms the button) ----
// "days": the marked days (plus weekends/holidays between them); "month": every day of the shown month.
const DELETE_ARM_MS = 5000;
let deleteArmed = null; // null | "days" | "month"
let deleteArmedTimer = null;

const markedDays = () => [...new Set([...Object.keys(state.work), ...Object.keys(state.vac)])].sort();

// Everything a delete should clear: the marked days plus every weekend day and bank holiday between the
// first and last of them (range selection skips those, so they'd otherwise be left behind).
const daysToDelete = () => {
  const days = markedDays();
  if (!days.length) return [];
  const all = new Set(days);
  for (const d = new Date(`${days[0]}T00:00:00`); keyOf(d) <= days[days.length - 1]; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6 || holidayName(keyOf(d))) all.add(keyOf(d));
  }
  return [...all].sort();
};

const daysOfShownMonth = () => {
  const [year, month] = state.month.split("-").map(Number);
  const days = [];
  for (const d = new Date(year, month - 1, 1); d.getMonth() === month - 1; d.setDate(d.getDate() + 1)) days.push(keyOf(d));
  return days;
};

const renderDeleteButtons = () => {
  const days = markedDays();
  const plural = days.length === 1 ? "" : "s";
  const monthName = MONTHS[Number(state.month.split("-")[1]) - 1];

  const selected = $("deleteEntries");
  selected.disabled = !days.length;
  selected.classList.toggle("armed", deleteArmed === "days");
  selected.title = `Delete all existing entries on the ${days.length} selected day${plural}, plus any on weekends and bank holidays in between`;
  selected.textContent = deleteArmed === "days" ? `Confirm delete (${days.length})` : days.length ? `Delete entries (${days.length})` : "Delete entries";

  const month = $("deleteMonth");
  month.classList.toggle("armed", deleteArmed === "month");
  month.title = `Delete every existing entry in ${monthName}`;
  month.textContent = deleteArmed === "month" ? `Confirm delete ${monthName.slice(0, 3)}` : "Delete month";
};

const disarmDelete = () => {
  clearTimeout(deleteArmedTimer);
  deleteArmed = null;
  deleteArmedTimer = null;
  renderDeleteButtons();
};

const onDeleteClick = (kind) => {
  if (kind === "days" && !markedDays().length) return;
  if (deleteArmed !== kind) {
    clearTimeout(deleteArmedTimer);
    deleteArmed = kind;
    deleteArmedTimer = setTimeout(disarmDelete, DELETE_ARM_MS);
    renderDeleteButtons();
    return;
  }
  disarmDelete();
  send({ type: "delete", dates: kind === "days" ? daysToDelete() : daysOfShownMonth() });
};

const renderSummary = () => {
  const workHours = Object.values(state.work).reduce((a, b) => a + b, 0);
  const vacHours = Object.values(state.vac).reduce((a, b) => a + b, 0);

  const summary = $("summary");
  summary.innerHTML = "";
  const work = document.createElement("li");
  work.textContent = `Work: ${formatHours(workHours)}`;
  if (state.ccCount > 1 && workHours) {
    const nested = document.createElement("ul");
    workSubtotals().forEach((hours, i) => {
      const item = document.createElement("li");
      item.textContent = `${state.ccNames[i] || `Cost center ${i + 1}`}: ${formatHours(hours)}`;
      nested.append(item);
    });
    work.append(nested);
  }
  const vac = document.createElement("li");
  vac.textContent = `Vacation: ${formatHours(vacHours)}`;
  summary.append(work, vac);

  const found = problems();
  $("submit").disabled = found.length > 0;
  $("problems").textContent = found.join(" ");
};

// Re-render everything that depends on state except the pickers (they hold typing focus).
const updateDerived = () => {
  renderSplit();
  renderSummary();
  disarmDelete(); // any change to the selection cancels a pending delete confirmation
  save();
};

const refresh = () => {
  normalizeCostCenters();
  stripHolidays();
  $("multi").checked = state.multi;
  $("half").checked = state.half;
  renderCalendar();
  renderHolidayLegend();
  renderPickers();
  updateDerived();
};

const showStatus = (status) => {
  $("status").className = "status " + (status.state === "running" ? "" : status.state);
  $("spinner").hidden = status.state !== "running";
  $("statusText").textContent = status.message;
};

// The extension drives the tab the user is on, so it needs that tab's id.
const send = async (message, text) => {
  showStatus({ state: "running", message: text || "Starting…" });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ ...message, tabId: tab && tab.id }, () => void chrome.runtime.lastError);
};

const loadCostCentersOnFirstUse = async (stored, status) => {
  const running = status && status.state === "running" && Date.now() - status.at < 5 * 60 * 1000;
  const recentlyTried = Date.now() - (stored.costCenterScanAttempt || 0) < SCAN_RETRY_MS;
  if (CostCenterPicker.hasOptions() || running || recentlyTried) return;
  await chrome.storage.local.set({ costCenterScanAttempt: Date.now() });
  send({ type: "scan", firstTime: true }, FIRST_USE_TEXT);
};

const init = async () => {
  await CostCenterPicker.init();
  const stored = await chrome.storage.local.get(["settings", "popupState", "applyTemplateNext", "prefillMonthNext", "costCenterScanAttempt"]);
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  const now = new Date();
  state = { ...state, month: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, ...(stored.popupState || {}) };
  // Older versions stored a plain list of work days (and cost center ids).
  if (Array.isArray(state.selected)) {
    state.work = Object.fromEntries(state.selected.map((day) => [day, FULL_DAY]));
    delete state.selected;
  }
  if (!Array.isArray(state.ccNames)) state.ccNames = [""];
  if (!stored.popupState || stored.applyTemplateNext) {
    applyTemplate();
    // A freshly applied template (e.g. from a manager's link) starts on the current month.
    state.month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    await chrome.storage.local.remove("applyTemplateNext");
  }
  if (stored.prefillMonthNext) {
    // From a manager's link: start from a clean selection with every workday of the current month marked.
    state.work = {};
    state.vac = {};
    state.rangeStart = null;
    state.multi = false;
    state.half = false;
    fillMonthWithWorkdays();
    await chrome.storage.local.remove("prefillMonthNext");
  }

  $("multi").addEventListener("change", (e) => { state.multi = e.target.checked; state.rangeStart = null; refresh(); });
  $("half").addEventListener("change", (e) => { state.half = e.target.checked; refresh(); });
  // The slider moves in 1% increments and we snap it ourselves, so 100% stays reachable
  // even when the step doesn't divide 100 (e.g. 7%: ..., 91, 98, 100).
  $("split").addEventListener("input", (e) => {
    const first = snapPercent(Number(e.target.value));
    state.percents = [first, 100 - first];
    updateDerived();
  });
  $("splitStep").addEventListener("change", (e) => {
    splitStep = Math.min(50, Math.max(1, Number(e.target.value) || DEFAULT_SPLIT_STEP));
    const first = snapPercent(state.percents[0]);
    state.percents = [first, 100 - first];
    updateDerived();
  });
  const shiftMonth = (delta) => {
    const [y, m] = state.month.split("-").map(Number);
    state.month = keyOf(new Date(y, m - 1 + delta, 1)).slice(0, 7);
    refresh();
  };
  $("prev").addEventListener("click", () => shiftMonth(-1));
  $("next").addEventListener("click", () => shiftMonth(1));
  $("openOptions").addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $("clear").addEventListener("click", clearEverything);
  $("deleteEntries").addEventListener("click", () => onDeleteClick("days"));
  $("deleteMonth").addEventListener("click", () => onDeleteClick("month"));
  $("submit").addEventListener("click", () => send({ type: "submit", job: buildJob() }));

  const { status } = await chrome.storage.session.get("status");
  if (status) showStatus(status);
  else {
    // Idle: use the status line to say what Submit does.
    $("status").className = "status idle";
    $("statusText").textContent = "Submit replaces entries on & between marked days.";
  }
  chrome.storage.session.onChanged.addListener((changes) => changes.status && showStatus(changes.status.newValue));
  CostCenterPicker.onOptionsChanged(renderPickers);

  refresh();
  loadCostCentersOnFirstUse(stored, status);
};

init();
