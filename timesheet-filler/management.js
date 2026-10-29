// Settings > Management: a manager keeps a table of direct reports with their monthly cost center
// split and copies a ready-to-paste Slack message ("@Name - link", sorted by first name).
const Management = (() => {
  const MAX_COST_CENTERS = 10;
  const $ = (id) => document.getElementById(id);
  let data = { open: false, label: "", channel: "", rows: [] };

  const equalPercents = (count) => {
    const base = Math.floor(100 / count);
    return Array.from({ length: count }, (_, i) => (i === count - 1 ? 100 - base * (count - 1) : base));
  };

  const save = () => chrome.storage.local.set({ management: data });
  const cleanName = (name) => name.trim().replace(/^@+/, "").trim();

  // ---- validation and output ----
  const rowProblem = (row) => {
    if (!cleanName(row.name)) return "needs a name";
    if (row.ccNames.some((name) => !name.trim())) return "needs every cost center filled in";
    const lower = row.ccNames.map((name) => name.trim().toLowerCase());
    if (new Set(lower).size !== lower.length) return "uses the same cost center twice";
    if (row.percents.reduce((a, b) => a + b, 0) !== 100) return `percentages add up to ${row.percents.reduce((a, b) => a + b, 0)}, not 100`;
    return null;
  };

  // One message line: "@Name - " then a hyperlink whose text is the split ("CommunityRTB 60%, Citrus 40%";
  // each cost center is its first word only) and whose target applies that split.
  const lineParts = (row) => {
    const names = row.ccNames.map((n) => n.trim());
    return {
      mention: `@${cleanName(row.name)}`,
      text: names.map((name, i) => `${name.split(/\s+/)[0]} ${row.percents[i]}%`).join(", "),
      url: Share.link({ names, percents: row.percents, label: data.label.trim() }),
    };
  };

  // Plain-text fallback for apps that ignore the rich text on the clipboard.
  let plainMessage = "";

  const renderOutput = () => {
    const problems = data.rows.map((row, i) => [row, rowProblem(row), i]).filter(([, problem]) => problem);
    const sorted = [...data.rows]
      .filter((row) => !rowProblem(row))
      .sort((a, b) => cleanName(a.name).localeCompare(cleanName(b.name), undefined, { sensitivity: "base" }));

    const output = $("mgmtOutput");
    output.innerHTML = "";
    const lines = problems.length ? [] : sorted.map(lineParts);
    for (const { mention, text, url } of lines) {
      const div = document.createElement("div");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = text;
      div.append(`${mention} - `, link);
      output.append(div);
    }
    plainMessage = lines.map(({ mention, text, url }) => `${mention} - ${text} ${url}`).join("\n");
    $("mgmtProblems").textContent = problems.length
      ? problems.map(([row, problem, i]) => `${cleanName(row.name) || `Row ${i + 1}`} ${problem}.`).join(" ")
      : data.rows.length ? "" : "Add your first employee.";
    $("mgmtCopy").disabled = problems.length > 0 || !data.rows.length;
    $("mgmtOpen").disabled = $("mgmtCopy").disabled || !channelUrl();
  };

  // Only plain https links are opened (a Slack channel link copied from the app).
  const channelUrl = () => (/^https:\/\/\S+$/i.test(data.channel.trim()) ? data.channel.trim() : null);

  const changed = () => {
    save();
    renderOutput();
  };

  // ---- table ----
  const slotCount = () => Math.max(1, ...data.rows.map((row) => row.count));

  const renderTable = () => {
    const table = $("mgmtTable");
    table.innerHTML = "";
    const slots = slotCount();
    const head = table.createTHead().insertRow();
    ["Employee (Slack name)", "Cost centers", ...Array.from({ length: slots }, (_, i) => `Cost center ${i + 1}`), ""].forEach((title) => {
      const th = document.createElement("th");
      th.textContent = title;
      head.append(th);
    });

    const body = table.createTBody();
    data.rows.forEach((row, rowIndex) => {
      const tr = body.insertRow();

      const name = document.createElement("input");
      name.type = "text";
      name.className = "name";
      name.placeholder = "Jane Doe";
      name.value = row.name;
      name.addEventListener("input", () => { row.name = name.value; changed(); });
      tr.insertCell().append(name);

      tr.insertCell().append(
        CostCenterCount.create({
          value: row.count,
          max: MAX_COST_CENTERS,
          onChange: (count) => {
            row.ccNames = Array.from({ length: count }, (_, i) => row.ccNames[i] || "");
            row.percents = equalPercents(count);
            row.count = count;
            save();
            renderTable();
            renderOutput();
          },
        }),
      );

      for (let i = 0; i < slots; i++) {
        const cell = tr.insertCell();
        if (i >= row.count) {
          cell.className = "unused";
          continue;
        }
        const box = document.createElement("div");
        box.className = "cell";
        box.append(CostCenterPicker.create({ value: row.ccNames[i], onChange: (value) => { row.ccNames[i] = value; changed(); } }));
        if (row.count > 1) {
          const pct = document.createElement("input");
          pct.type = "number";
          pct.className = "pct";
          pct.min = 0;
          pct.max = 100;
          pct.value = row.percents[i];
          pct.addEventListener("input", () => { row.percents[i] = Number(pct.value) || 0; changed(); });
          box.append(pct, "%");
        }
        cell.append(box);
      }

      const remove = document.createElement("button");
      remove.className = "link";
      remove.textContent = "✕";
      remove.title = "Remove employee";
      remove.addEventListener("click", () => {
        data.rows.splice(rowIndex, 1);
        save();
        renderTable();
        renderOutput();
      });
      tr.insertCell().append(remove);
    });
  };

  const addRow = () => {
    // A new row starts as a copy of the last one: teams usually share a split.
    const last = data.rows[data.rows.length - 1];
    data.rows.push(last
      ? { name: "", count: last.count, ccNames: [...last.ccNames], percents: [...last.percents] }
      : { name: "", count: 1, ccNames: [""], percents: [100] });
    save();
    renderTable();
    renderOutput();
  };

  // Rich text (links keep their custom text when pasted into Slack) with a plain-text fallback.
  const copyMessage = async () => {
    const html = $("mgmtOutput").innerHTML;
    if (window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainMessage], { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(plainMessage);
    }
  };

  const setOpen = (open) => {
    data.open = open;
    $("mgmt").hidden = !open;
    $("mgmtToggle").setAttribute("aria-expanded", String(open));
    $("mgmtToggle").querySelector(".chevron").textContent = open ? "▾" : "▸";
    document.querySelector("main").classList.toggle("wide", open);
    save();
  };

  const init = async () => {
    const stored = await chrome.storage.local.get("management");
    data = { open: false, label: "", channel: "", rows: [], ...(stored.management || {}) };
    $("mgmtLabel").value = data.label;
    $("mgmtLabel").addEventListener("input", () => { data.label = $("mgmtLabel").value; changed(); });
    $("mgmtToggle").addEventListener("click", () => setOpen(!data.open));
    $("mgmtAdd").addEventListener("click", addRow);
    $("mgmtCopy").addEventListener("click", async () => {
      await copyMessage();
      $("mgmtMsg").textContent = "Copied. Paste it in Slack.";
    });
    $("mgmtChannel").value = data.channel;
    $("mgmtChannel").addEventListener("input", () => { data.channel = $("mgmtChannel").value; changed(); });
    $("mgmtOpen").addEventListener("click", async () => {
      await copyMessage();
      await chrome.tabs.create({ url: channelUrl() });
      $("mgmtMsg").textContent = "Copied and opened the channel. Paste the message there.";
    });
    setOpen(data.open);
    renderTable();
    renderOutput();
  };

  return { init };
})();
