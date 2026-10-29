const DEFAULT_SETTINGS = { vacCostCenter: "Admin - VacHol", note: "", weekStart: "monday", limitHours: true, holidays: "cz", template: null };
const MAX_COST_CENTERS = 10;

const $ = (id) => document.getElementById(id);
let template = { ccNames: [""], percents: [100], half: false };
let vacCostCenter = DEFAULT_SETTINGS.vacCostCenter;

const equalPercents = (count) => {
  const base = Math.floor(100 / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? 100 - base * (count - 1) : base));
};

const renderVacPicker = () => {
  $("vacPicker").innerHTML = "";
  $("vacPicker").append(CostCenterPicker.create({ value: vacCostCenter, onChange: (value) => { vacCostCenter = value; } }));
};

const renderTemplate = () => {
  const count = template.ccNames.length;
  $("tplCount").innerHTML = "";
  $("tplCount").append(
    CostCenterCount.create({
      value: count,
      max: MAX_COST_CENTERS,
      onChange: (n) => {
        template.ccNames = Array.from({ length: n }, (_, i) => template.ccNames[i] || "");
        template.percents = equalPercents(n);
        renderTemplate();
      },
    }),
  );
  $("tplHalf").checked = template.half;

  const rows = $("tplRows");
  rows.innerHTML = "";
  template.ccNames.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "tpl-row";
    row.append(CostCenterPicker.create({ value: name, onChange: (value) => { template.ccNames[i] = value; } }));
    if (count > 1) {
      const pct = document.createElement("input");
      pct.type = "number";
      pct.className = "pct";
      pct.min = 0;
      pct.max = 100;
      pct.value = template.percents[i];
      pct.addEventListener("input", () => { template.percents[i] = Number(pct.value) || 0; });
      row.append(pct, "%");
    }
    rows.append(row);
  });
};

const save = async () => {
  const sum = template.percents.reduce((a, b) => a + b, 0);
  if (sum !== 100) {
    $("msg").textContent = `Template percentages must add up to 100 (currently ${sum}).`;
    return;
  }
  const hasTemplate = template.ccNames.some(Boolean) || template.half || template.ccNames.length > 1;
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: {
      ...DEFAULT_SETTINGS,
      ...settings,
      weekStart: document.querySelector('input[name="weekStart"]:checked').value,
      limitHours: $("limitHours").checked,
      holidays: document.querySelector('input[name="holidays"]:checked').value,
      vacCostCenter: vacCostCenter.trim() || DEFAULT_SETTINGS.vacCostCenter,
      note: $("note").value.trim(),
      template: hasTemplate ? { ...template, ccNames: [...template.ccNames], percents: [...template.percents] } : null,
    },
    applyTemplateNext: true,
  });
  $("msg").textContent = "Saved.";
};

const init = async () => {
  await CostCenterPicker.init();
  await Management.init();
  const stored = await chrome.storage.local.get("settings");
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  document.querySelector(`input[name="weekStart"][value="${settings.weekStart}"]`).checked = true;
  $("limitHours").checked = settings.limitHours !== false;
  document.querySelector(`input[name="holidays"][value="${settings.holidays}"]`).checked = true;
  vacCostCenter = settings.vacCostCenter;
  $("note").value = settings.note;
  if (settings.template) template = { ...settings.template, ccNames: [...settings.template.ccNames], percents: [...settings.template.percents] };
  renderVacPicker();
  renderTemplate();

  $("tplHalf").addEventListener("change", (e) => { template.half = e.target.checked; });
  $("tplClear").addEventListener("click", () => {
    template = { ccNames: [""], percents: [100], half: false };
    renderTemplate();
  });
  $("reloadCc").addEventListener("click", () => {
    $("ccMsg").textContent = "Opening the time card in a new tab…";
    chrome.runtime.sendMessage({ type: "scan" }, () => void chrome.runtime.lastError);
  });
  $("importApply").addEventListener("click", () => {
    const split = Share.decode($("importSplit").value);
    if (!split) {
      $("importMsg").textContent = "That doesn't look like a split link.";
      return;
    }
    template = { ccNames: split.names, percents: split.percents, half: template.half };
    renderTemplate();
    $("importSplit").value = "";
    $("importMsg").textContent = "Loaded into the template above. Press Save to keep it.";
  });
  $("save").addEventListener("click", save);

  chrome.storage.session.onChanged.addListener((changes) => {
    const status = changes.status && changes.status.newValue;
    if (status) $("ccMsg").textContent = status.message;
  });
};

init();
