const els = {
  status: document.querySelector("#status-pill"),
  totalAscent: document.querySelector("#total-ascent"),
  gapLine: document.querySelector("#gap-line"),
  targetAscent: document.querySelector("#target-ascent"),
  dailyAverage: document.querySelector("#daily-average"),
  totalDistance: document.querySelector("#total-distance"),
  totalDuration: document.querySelector("#total-duration"),
  activityCount: document.querySelector("#activity-count"),
  latestActivity: document.querySelector("#latest-activity"),
  generatedAt: document.querySelector("#generated-at")
};

loadSummary();

async function loadSummary() {
  try {
    const response = await fetch(`summary.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Totals unavailable");
    render(await response.json());
  } catch (error) {
    els.status.textContent = "Offline";
    els.gapLine.textContent = "Could not load the latest totals.";
  }
}

function render(summary) {
  const dayIndex = targetDayIndex(summary.year);
  const target = dayIndex * summary.dailyGoal;
  const gap = Math.round(summary.totalAscent - target);
  const average = dayIndex ? Math.round(summary.totalAscent / dayIndex) : 0;
  const isGood = gap >= 0;

  els.status.textContent = isGood ? "Ahead" : "Behind";
  els.status.classList.toggle("is-good", isGood);
  els.status.classList.toggle("is-behind", !isGood);
  els.totalAscent.textContent = formatFeet(summary.totalAscent);
  els.gapLine.textContent = `${isGood ? "+" : "-"}${formatFeet(Math.abs(gap))} vs today's target`;
  els.gapLine.classList.toggle("is-good", isGood);
  els.gapLine.classList.toggle("is-behind", !isGood);
  els.targetAscent.textContent = formatFeet(target);
  els.dailyAverage.textContent = `${average.toLocaleString()} ft/day`;
  els.totalDistance.textContent = formatMiles(summary.totalDistance);
  els.totalDuration.textContent = formatDuration(summary.totalDurationSeconds);
  els.activityCount.textContent = Number(summary.activityCount || 0).toLocaleString();
  els.latestActivity.textContent = formatDate(summary.latestActivityDate);
  els.generatedAt.textContent = formatDateTime(summary.generatedAt);
}

function targetDayIndex(year) {
  const today = new Date();
  if (today.getFullYear() < year) return 1;
  if (today.getFullYear() > year) return daysInYear(year);
  return dayOfYear(today);
}

function daysInYear(year) {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((current - start) / 86400000) + 1;
}

function formatFeet(value) {
  return `${Math.round(Number(value) || 0).toLocaleString()} ft`;
}

function formatMiles(value) {
  const miles = Number(value) || 0;
  return `${miles.toLocaleString(undefined, { maximumFractionDigits: miles < 100 ? 1 : 0 })} mi`;
}

function formatDuration(seconds) {
  const totalSeconds = Math.round(Number(seconds) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours ? `${hours.toLocaleString()}h ${minutes}m` : `${minutes}m`;
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
