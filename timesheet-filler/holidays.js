// Czech bank holidays (computed, so no data to keep up to date). Days like Christmas that run
// consecutively are shown as one legend line.
const Holidays = (() => {
  const pad = (n) => String(n).padStart(2, "0");
  const key = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  // Anonymous Gregorian algorithm.
  const easterSunday = (y) => {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  };

  const cache = {};

  // { "yyyy-MM-dd": { name, group } } for a year; group is the legend label when days run together.
  const forYear = (year) => {
    if (cache[year]) return cache[year];
    const days = {};
    const add = (month, day, name, group = name) => { days[`${year}-${pad(month)}-${pad(day)}`] = { name, group }; };
    add(1, 1, "New Year's Day");
    const easter = easterSunday(year);
    for (const [offset, name] of [[-2, "Good Friday"], [1, "Easter Monday"]]) {
      const d = new Date(easter);
      d.setDate(d.getDate() + offset);
      days[key(d)] = { name, group: name };
    }
    add(5, 1, "Labour Day");
    add(5, 8, "Liberation Day");
    add(7, 5, "Cyril & Methodius Day");
    add(7, 6, "Jan Hus Day");
    add(9, 28, "Statehood Day");
    add(10, 28, "Independence Day");
    add(11, 17, "Freedom & Democracy Day");
    add(12, 24, "Christmas Eve", "Christmas");
    add(12, 25, "Christmas Day", "Christmas");
    add(12, 26, "St. Stephen's Day", "Christmas");
    cache[year] = days;
    return days;
  };

  const ordinal = (n) => {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return `${n}th`;
    return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
  };

  // Consecutive holiday days of one month as legend lines: [{ range: "24-26th", label: "Christmas" }].
  const legend = (year, monthIndex) => {
    const days = forYear(year);
    const inMonth = [];
    for (let d = 1; d <= 31; d++) {
      const date = new Date(year, monthIndex, d);
      if (date.getMonth() !== monthIndex) break;
      const holiday = days[key(date)];
      if (holiday) inMonth.push({ day: d, group: holiday.group });
    }
    const lines = [];
    let run = null;
    for (const { day, group } of inMonth) {
      if (run && run.last === day - 1) {
        run.last = day;
        if (!run.groups.includes(group)) run.groups.push(group);
      } else {
        run = { first: day, last: day, groups: [group] };
        lines.push(run);
      }
    }
    return lines.map((l) => ({
      range: l.first === l.last ? ordinal(l.first) : `${l.first}-${ordinal(l.last)}`,
      label: l.groups.join(" / "),
    }));
  };

  return { forYear, legend, nameOf: (isoDate) => (forYear(Number(isoDate.slice(0, 4)))[isoDate] || {}).name || null };
})();
