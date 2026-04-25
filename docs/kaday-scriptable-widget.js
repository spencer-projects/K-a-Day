// Paste this into Scriptable on your iPhone. Set the widget parameter to your
// published summary.json URL, or replace the placeholder below after GitHub Pages is live.
const DEFAULT_SUMMARY_URL = "https://YOUR-GITHUB-USERNAME.github.io/K-A-Day/summary.json";
const SUMMARY_URL = args.widgetParameter || DEFAULT_SUMMARY_URL;

const widget = new ListWidget();
widget.backgroundColor = new Color("#f5f7f2");
widget.setPadding(14, 14, 14, 14);

try {
  const summary = await loadSummary(SUMMARY_URL);
  renderWidget(widget, summary);
} catch (error) {
  renderError(widget);
}

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();

async function loadSummary(url) {
  const request = new Request(url);
  request.cachePolicy = "reloadIgnoringLocalCacheData";
  return request.loadJSON();
}

function renderWidget(widget, summary) {
  const dayIndex = targetDayIndex(summary.year);
  const target = dayIndex * summary.dailyGoal;
  const gap = Math.round(summary.totalAscent - target);
  const average = dayIndex ? Math.round(summary.totalAscent / dayIndex) : 0;
  const isGood = gap >= 0;
  const accent = new Color(isGood ? "#006f5b" : "#d9485f");

  const header = widget.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();

  const title = header.addText("K-A-Day");
  title.font = Font.boldSystemFont(13);
  title.textColor = new Color("#5c665f");

  header.addSpacer();

  const status = header.addText(isGood ? "Ahead" : "Behind");
  status.font = Font.boldSystemFont(13);
  status.textColor = accent;

  widget.addSpacer(8);

  const ascent = widget.addText(formatFeet(summary.totalAscent));
  ascent.font = Font.boldSystemFont(config.widgetFamily === "small" ? 26 : 32);
  ascent.minimumScaleFactor = 0.7;
  ascent.textColor = new Color("#202421");

  const gapText = widget.addText(`${isGood ? "+" : "-"}${formatFeet(Math.abs(gap))} vs today`);
  gapText.font = Font.boldSystemFont(15);
  gapText.minimumScaleFactor = 0.75;
  gapText.textColor = accent;

  widget.addSpacer();

  const details = widget.addText(`${average.toLocaleString()} ft/day · ${formatMiles(summary.totalDistance)}`);
  details.font = Font.semiboldSystemFont(12);
  details.minimumScaleFactor = 0.75;
  details.textColor = new Color("#5c665f");

  const fresh = widget.addText(`Latest ${formatShortDate(summary.latestActivityDate)} · ${formatRefresh(summary.generatedAt)}`);
  fresh.font = Font.mediumSystemFont(11);
  fresh.minimumScaleFactor = 0.75;
  fresh.textColor = new Color("#5c665f");

  widget.url = SUMMARY_URL.replace(/summary\.json(?:\?.*)?$/, "");
}

function renderError(widget) {
  const title = widget.addText("K-A-Day");
  title.font = Font.boldSystemFont(14);
  title.textColor = new Color("#202421");
  widget.addSpacer(8);

  const message = widget.addText("Totals unavailable");
  message.font = Font.boldSystemFont(18);
  message.textColor = new Color("#d9485f");
  widget.addSpacer();

  const hint = widget.addText("Check the widget parameter URL.");
  hint.font = Font.mediumSystemFont(12);
  hint.textColor = new Color("#5c665f");
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

function formatShortDate(value) {
  if (!value) return "--";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRefresh(value) {
  if (!value) return "--";
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
