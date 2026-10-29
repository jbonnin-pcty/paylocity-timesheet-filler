// Splits the month's total hours across cost centers by percentage. Days are filled in order, so
// at most one day per cost-center boundary ends up split between two cost centers.
const QUARTER = 0.25;
const roundToQuarter = (hours) => Math.round(hours / QUARTER) * QUARTER;

// days: [{ date: "yyyy-MM-dd", hours }] sorted by date, costCenters / percents: parallel arrays
// (percents sum to 100). returns [{ date, costCenter, hours }]
function allocateHours(days, costCenters, percents) {
  const total = days.reduce((sum, day) => sum + day.hours, 0);
  const targets = percents.map((percent) => roundToQuarter((total * percent) / 100));
  const lastIndex = targets.length - 1;
  const assigned = targets.slice(0, lastIndex).reduce((sum, hours) => sum + hours, 0);
  targets[lastIndex] = Math.max(0, total - assigned);

  const entries = [];
  let dayIndex = 0;
  let roomInDay = days.length ? days[0].hours : 0;
  costCenters.forEach((costCenter, i) => {
    let needed = targets[i];
    while (needed > 0.0001 && dayIndex < days.length) {
      const hours = Math.min(needed, roomInDay);
      entries.push({ date: days[dayIndex].date, costCenter, hours });
      needed -= hours;
      roomInDay -= hours;
      if (roomInDay <= 0.0001) {
        dayIndex += 1;
        roomInDay = dayIndex < days.length ? days[dayIndex].hours : 0;
      }
    }
  });
  return entries;
}
