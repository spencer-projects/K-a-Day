const {
  CHART_COLORS,
  colorForMember,
  summarizeActivities,
  sanitizeGoal,
  sanitizeYear,
  formatFeet,
  formatMiles,
  formatDuration,
  formatDayOfYear,
  renderAscentChart,
  renderMetricChart,
  renderComparisonChart
} = window.KADAY_SHARED;

const STORAGE_KEY = "kaday-static-state-v1";
const DEFAULT_YEAR = new Date().getFullYear();
const DEFAULT_DAILY_GOAL = 1000;

const els = {
  userInput: document.querySelector("#user-input"),
  yearInput: document.querySelector("#year-input"),
  dailyGoalInput: document.querySelector("#daily-goal-input"),
  trackerTab: document.querySelector("#tracker-tab"),
  leaderboardTab: document.querySelector("#leaderboard-tab"),
  trackerViews: document.querySelectorAll(".view-tracker"),
  leaderboardViews: document.querySelectorAll(".view-leaderboard"),
  csvInput: document.querySelector("#csv-input"),
  dropZone: document.querySelector("#drop-zone"),
  clearButton: document.querySelector("#clear-button"),
  totalAscent: document.querySelector("#total-ascent"),
  targetAscent: document.querySelector("#target-ascent"),
  gapAscent: document.querySelector("#gap-ascent"),
  dailyAverage: document.querySelector("#daily-average"),
  activityTotals: document.querySelector("#activity-totals"),
  chart: document.querySelector("#progress-chart"),
  mileageChart: document.querySelector("#mileage-chart"),
  timeChart: document.querySelector("#time-chart"),
  chartSubtitle: document.querySelector("#chart-subtitle"),
  metricsSubtitle: document.querySelector("#metrics-subtitle"),
  activityCount: document.querySelector("#activity-count"),
  monthlyCount: document.querySelector("#monthly-count"),
  parseNote: document.querySelector("#parse-note"),
  activityTable: document.querySelector("#activity-table"),
  monthlyTable: document.querySelector("#monthly-table"),
  statCards: document.querySelectorAll(".stat-card"),
  leaderboardCount: document.querySelector("#leaderboard-count"),
  leaderboardLeading: document.querySelector("#leaderboard-leading"),
  leaderboardTotal: document.querySelector("#leaderboard-total"),
  leaderboardDistance: document.querySelector("#leaderboard-distance"),
  leaderboardChart: document.querySelector("#leaderboard-chart"),
  leaderboardLegend: document.querySelector("#leaderboard-legend"),
  leaderboardSubtitle: document.querySelector("#leaderboard-subtitle"),
  leaderboardCopy: document.querySelector("#leaderboard-copy"),
  leaderboardTable: document.querySelector("#leaderboard-table")
};

const saved = loadState();
const state = {
  currentUser: saved.currentUser,
  profiles: saved.profiles,
  activeTab: saved.activeTab || "tracker",
  note: "",
  sourceName: currentProfile().sourceName || ""
};

init();

function init() {
  wireEvents();
  syncInputs();
  render();
}

function wireEvents() {
  els.userInput.addEventListener("change", () => {
    switchUser(els.userInput.value);
  });

  els.userInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      switchUser(els.userInput.value);
      els.userInput.blur();
    }
  });

  els.yearInput.addEventListener("input", () => {
    currentProfile().year = sanitizeYear(els.yearInput.value);
    persistState();
    render();
  });

  els.dailyGoalInput.addEventListener("change", () => {
    currentProfile().dailyGoal = sanitizeGoal(els.dailyGoalInput.value);
    persistState();
    render();
  });

  els.csvInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) uploadCsv(file);
  });

  els.clearButton.addEventListener("click", clearActivities);
  els.trackerTab.addEventListener("click", () => setActiveTab("tracker"));
  els.leaderboardTab.addEventListener("click", () => setActiveTab("leaderboard"));

  ["dragenter", "dragover"].forEach(type => {
    els.dropZone.addEventListener(type, event => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach(type => {
    els.dropZone.addEventListener(type, event => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  });

  els.dropZone.addEventListener("drop", event => {
    const file = [...event.dataTransfer.files].find(item => item.name.toLowerCase().endsWith(".csv"));
    if (file) uploadCsv(file);
  });

  window.addEventListener("resize", () => render());
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const profiles = typeof parsed.profiles === "object" && parsed.profiles ? parsed.profiles : {};
    const currentUser = sanitizeUserName(parsed.currentUser || "Default");
    if (!profiles[normalizeName(currentUser)]) {
      profiles[normalizeName(currentUser)] = createProfile(currentUser);
    }
    for (const key of Object.keys(profiles)) {
      profiles[key] = hydrateProfile(profiles[key], key);
    }
    return {
      currentUser,
      profiles,
      activeTab: parsed.activeTab === "leaderboard" ? "leaderboard" : "tracker"
    };
  } catch {
    const currentUser = "Default";
    return {
      currentUser,
      profiles: { [normalizeName(currentUser)]: createProfile(currentUser) },
      activeTab: "tracker"
    };
  }
}

function hydrateProfile(profile, fallbackKey) {
  const username = sanitizeUserName(profile?.username || fallbackKey || "Default");
  return {
    username,
    year: sanitizeYear(profile?.year || DEFAULT_YEAR),
    dailyGoal: sanitizeGoal(profile?.dailyGoal || DEFAULT_DAILY_GOAL),
    sourceName: String(profile?.sourceName || ""),
    activities: Array.isArray(profile?.activities) ? profile.activities : []
  };
}

function createProfile(username) {
  return {
    username,
    year: DEFAULT_YEAR,
    dailyGoal: DEFAULT_DAILY_GOAL,
    sourceName: "",
    activities: []
  };
}

function currentProfile() {
  const key = normalizeName(state.currentUser);
  if (!state.profiles[key]) state.profiles[key] = createProfile(state.currentUser);
  return state.profiles[key];
}

function switchUser(value) {
  const username = sanitizeUserName(value || "Default");
  state.currentUser = username;
  const key = normalizeName(username);
  if (!state.profiles[key]) {
    state.profiles[key] = createProfile(username);
    state.note = `Created local profile for ${username}.`;
  } else {
    state.note = "";
  }
  state.sourceName = currentProfile().sourceName || "";
  persistState();
  syncInputs();
  render();
}

function syncInputs() {
  const profile = currentProfile();
  els.userInput.value = profile.username;
  els.yearInput.value = profile.year;
  els.dailyGoalInput.value = profile.dailyGoal;
}

async function uploadCsv(file) {
  try {
    const csvText = await file.text();
    const parsed = parseGarminCsv(csvText);
    const merged = mergeActivities(currentProfile().activities, parsed.activities);
    currentProfile().activities = merged.activities;
    currentProfile().sourceName = file.name;
    state.sourceName = file.name;
    state.note = `${parsed.note} ${file.name}: ${merged.added.toLocaleString()} new, ${merged.replaced.toLocaleString()} upgraded, ${merged.skipped.toLocaleString()} duplicates skipped. Lifetime list now has ${merged.activities.length.toLocaleString()} activities.`;
    persistState();
    render();
  } catch (error) {
    state.note = error.message;
    render();
  } finally {
    els.csvInput.value = "";
  }
}

function clearActivities() {
  const profile = currentProfile();
  if (!window.confirm(`Clear every saved activity for ${profile.username}?`)) return;
  profile.activities = [];
  profile.sourceName = "";
  state.sourceName = "";
  state.note = `Cleared saved activities for ${profile.username}.`;
  persistState();
  render();
}

function render() {
  const profile = currentProfile();
  const summary = summarizeActivities({
    activities: profile.activities,
    year: profile.year,
    dailyGoal: profile.dailyGoal
  });
  const leaderboard = buildLeaderboard(profile.year);

  syncInputs();
  applyActiveTab();

  els.totalAscent.textContent = formatFeet(summary.totalAscent);
  els.targetAscent.textContent = formatFeet(summary.targetAscent);
  els.gapAscent.textContent = `${summary.gap >= 0 ? "+" : "-"}${formatFeet(Math.abs(summary.gap))}`;
  els.dailyAverage.textContent = `${summary.average.toLocaleString()} ft/day`;
  els.statCards[2].classList.toggle("is-good", summary.gap >= 0);
  els.statCards[2].classList.toggle("is-behind", summary.gap < 0);

  const dateLabel = formatDayOfYear(summary.year, summary.todayIndex);
  els.chartSubtitle.textContent = profile.activities.length
    ? `${profile.username}: ${summary.inYearActivities.length.toLocaleString()} activities in ${summary.year}. Through ${dateLabel}, the target is ${formatFeet(summary.targetAscent)}.`
    : `For ${summary.year}, the full-year goal is ${formatFeet(summary.yearGoal)}.`;
  els.metricsSubtitle.textContent = profile.activities.length
    ? `Through ${dateLabel}: ${formatMiles(summary.totalDistance)} and ${formatDuration(summary.totalDuration)} logged.`
    : "Cumulative totals through today, with lighter lines by activity.";
  els.activityCount.textContent = summary.inYearActivities.length
    ? `${summary.inYearActivities.length.toLocaleString()} activities counted for ${summary.year}.`
    : "No activities loaded for this year.";
  els.monthlyCount.textContent = summary.monthlyTotals.length
    ? `${summary.monthlyTotals.length} months shown for ${summary.year}.`
    : `${summary.year} has not started yet.`;
  els.parseNote.textContent = state.note || "Saved only in this browser. Friends can use the same site independently on their own device.";

  renderActivityTotals(summary.typeTotals);
  renderActivityTable(summary.inYearActivities);
  renderMonthlyTotals(summary.monthlyTotals);
  renderCharts(summary);
  renderLeaderboard(leaderboard, profile.year);
}

function renderActivityTotals(typeTotals) {
  els.activityTotals.innerHTML = typeTotals.map(series => `
    <article class="type-total" style="--series-color: ${series.color}">
      <span>${series.label}</span>
      <strong>${formatFeet(series.ascent)}</strong>
      <small>${formatMiles(series.distance)} &middot; ${formatDuration(series.duration)}</small>
    </article>
  `).join("");
}

function renderActivityTable(activities) {
  if (!activities.length) {
    els.activityTable.innerHTML = `<tr><td colspan="3">Your exported activities will appear here.</td></tr>`;
    return;
  }

  const recent = [...activities].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  els.activityTable.innerHTML = recent.map(activity => `
    <tr>
      <td>${new Date(activity.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
      <td>${escapeHtml(activity.title || activity.type || "Activity")}</td>
      <td>${formatFeet(activity.ascent)}</td>
    </tr>
  `).join("");
}

function renderMonthlyTotals(monthlyTotals) {
  if (!monthlyTotals.length) {
    els.monthlyTable.innerHTML = `<tr><td colspan="5">Monthly totals will appear here once the selected year starts.</td></tr>`;
    return;
  }

  els.monthlyTable.innerHTML = monthlyTotals.map(month => `
    <tr>
      <td>${month.label}</td>
      <td>${month.activities.toLocaleString()}</td>
      <td>${formatFeet(month.ascent)}</td>
      <td>${formatMiles(month.distance)}</td>
      <td>${formatDuration(month.duration)}</td>
    </tr>
  `).join("");
}

function renderCharts(summary) {
  renderAscentChart(els.chart, summary);
  renderMetricChart(els.mileageChart, summary, {
    valueKey: "distance",
    seriesSuffix: "Distance",
    color: CHART_COLORS.cyan,
    formatter: value => {
      if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
      if (value >= 100) return String(Math.round(value));
      return value.toFixed(value < 10 ? 1 : 0);
    }
  });
  renderMetricChart(els.timeChart, summary, {
    valueKey: "duration",
    seriesSuffix: "Duration",
    color: CHART_COLORS.gold,
    formatter: value => {
      const hours = value / 3600;
      if (hours >= 1000) return `${(hours / 1000).toFixed(1)}k h`;
      if (hours >= 1) return `${Math.round(hours)}h`;
      return `${Math.round(value / 60)}m`;
    }
  });
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    currentUser: state.currentUser,
    profiles: state.profiles,
    activeTab: state.activeTab
  }));
}

function setActiveTab(tab) {
  state.activeTab = tab === "leaderboard" ? "leaderboard" : "tracker";
  persistState();
  applyActiveTab();
}

function applyActiveTab() {
  const trackerActive = state.activeTab !== "leaderboard";
  els.trackerTab.classList.toggle("is-active", trackerActive);
  els.trackerTab.setAttribute("aria-pressed", String(trackerActive));
  els.leaderboardTab.classList.toggle("is-active", !trackerActive);
  els.leaderboardTab.setAttribute("aria-pressed", String(!trackerActive));
  els.trackerViews.forEach(element => {
    element.hidden = !trackerActive;
  });
  els.leaderboardViews.forEach(element => {
    element.hidden = trackerActive;
  });
}

function sanitizeUserName(value) {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  return cleaned.slice(0, 40) || "Default";
}

function normalizeName(value) {
  return sanitizeUserName(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildLeaderboard(year) {
  return Object.values(state.profiles)
    .map((profile, index) => ({
      username: profile.username,
      color: colorForMember(index),
      summary: summarizeActivities({
        activities: profile.activities,
        year,
        dailyGoal: profile.dailyGoal
      })
    }))
    .sort((left, right) => (
      right.summary.totalAscent - left.summary.totalAscent ||
      right.summary.totalDistance - left.summary.totalDistance ||
      left.username.localeCompare(right.username)
    ));
}

function renderLeaderboard(leaderboard, year) {
  const leading = leaderboard.reduce((best, member) => Math.max(best, member.summary.totalAscent), 0);
  const totalAscent = leaderboard.reduce((sum, member) => sum + member.summary.totalAscent, 0);
  const totalDistance = leaderboard.reduce((sum, member) => sum + member.summary.totalDistance, 0);

  els.leaderboardCount.textContent = leaderboard.length.toLocaleString();
  els.leaderboardLeading.textContent = formatFeet(leading);
  els.leaderboardTotal.textContent = formatFeet(totalAscent);
  els.leaderboardDistance.textContent = formatMiles(totalDistance);
  els.leaderboardSubtitle.textContent = leaderboard.length
    ? `Every saved profile in this browser for ${year}.`
    : `No saved profiles found for ${year}.`;
  els.leaderboardCopy.textContent = leaderboard.length
    ? `${leaderboard.length.toLocaleString()} local profiles ranked for ${year}.`
    : "Create another local user name to start comparing profiles in this browser.";

  els.leaderboardLegend.innerHTML = leaderboard.length
    ? leaderboard.map(member => `<span><i style="background:${member.color}"></i>${escapeHtml(member.username)}</span>`).join("")
    : `<span><i class="actual-key"></i>No saved profiles yet</span>`;

  if (!leaderboard.length) {
    els.leaderboardTable.innerHTML = `<tr><td colspan="6">Leaderboard rows will appear here.</td></tr>`;
  } else {
    els.leaderboardTable.innerHTML = leaderboard.map((member, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(member.username)}</td>
        <td>${member.summary.inYearActivities.length.toLocaleString()}</td>
        <td>${formatFeet(member.summary.totalAscent)}</td>
        <td>${formatMiles(member.summary.totalDistance)}</td>
        <td>${formatDuration(member.summary.totalDuration)}</td>
      </tr>
    `).join("");
  }

  const series = leaderboard.map(member => ({
    label: member.username,
    color: member.color,
    points: member.summary.currentPoints.map(point => ({ day: point.day, value: point.actual }))
  }));
  renderComparisonChart(els.leaderboardChart, year, series);
}

function parseGarminCsv(csvText) {
  const rows = splitCsvRows(csvText);
  if (rows.length < 2) throw new Error("That CSV does not contain any activities.");

  const headers = rows[0].map(cleanText);
  const normalizedHeaders = headers.map(normalizeHeader);
  const columns = {
    date: findHeaderIndex(normalizedHeaders, ["date", "activitydate", "starttime", "startdate"]),
    type: findHeaderIndex(normalizedHeaders, ["activitytype", "type", "sport"]),
    title: findHeaderIndex(normalizedHeaders, ["title", "activityname", "name"]),
    ascent: findHeaderIndex(normalizedHeaders, ["totalascent", "elevationgain", "elevgain", "ascent", "gain", "climb"]),
    distance: findHeaderIndex(normalizedHeaders, ["distance", "mileage"]),
    duration: findHeaderIndex(normalizedHeaders, ["time", "duration", "movingtime", "elapsedtime"])
  };

  if (columns.date === -1) throw new Error("Could not find an activity date column in that CSV.");
  if (columns.type === -1) throw new Error("Could not find an activity type column in that CSV.");
  if (columns.ascent === -1) throw new Error("Could not find an ascent column. Garmin exports usually call it Total Ascent or Elevation Gain.");

  const ascentHeader = headers[columns.ascent];
  const distanceHeader = columns.distance === -1 ? "" : headers[columns.distance];
  let blanks = 0;
  let excluded = 0;
  const activities = [];

  for (const row of rows.slice(1)) {
    if (!row.some(value => cleanText(value))) continue;
    const date = parseActivityDate(getCell(row, columns.date));
    if (!date) continue;
    const type = cleanText(getCell(row, columns.type));
    const title = cleanText(getCell(row, columns.title)) || type || "Activity";
    const rawAscent = parseAscentFeet(getCell(row, columns.ascent), ascentHeader);
    const excludedAscent = normalizeHeader(type) === "resortskiing";
    const ascent = excludedAscent ? 0 : Math.max(0, Math.round(rawAscent ?? 0));
    const distance = columns.distance === -1 ? 0 : Math.max(0, parseDistanceMiles(getCell(row, columns.distance), distanceHeader));
    const durationSeconds = columns.duration === -1 ? 0 : Math.max(0, parseDurationSeconds(getCell(row, columns.duration)));

    if (rawAscent == null) blanks += 1;
    if (excludedAscent) excluded += 1;

    activities.push({
      date: date.toISOString(),
      title,
      type,
      ascent,
      distance,
      durationSeconds,
      ascentExcluded: excludedAscent ? 1 : 0
    });
  }

  if (!activities.length) throw new Error("No dated activities could be parsed from that CSV.");

  activities.sort((a, b) => new Date(a.date) - new Date(b.date));
  const blankNote = blanks ? ` Treated blank ascent as 0 ft for ${blanks.toLocaleString()} ${blanks === 1 ? "activity" : "activities"}.` : "";
  const excludedNote = excluded ? ` Removed ascent from ${excluded.toLocaleString()} Resort skiing ${excluded === 1 ? "activity" : "activities"}.` : "";
  return {
    activities,
    note: `${activities.length.toLocaleString()} activities loaded. Assumed ascent values are feet, matching Garmin's exported units.${blankNote}${excludedNote}`
  };
}

function mergeActivities(existingActivities, incomingActivities) {
  const byFingerprint = new Map((existingActivities || []).map(activity => [activityFingerprint(activity), activity]));
  let added = 0;
  let replaced = 0;
  let skipped = 0;

  for (const activity of incomingActivities) {
    const fingerprint = activityFingerprint(activity);
    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, activity);
      added += 1;
      continue;
    }
    if (activityScore(activity) > activityScore(existing)) {
      byFingerprint.set(fingerprint, mergeActivity(existing, activity));
      replaced += 1;
    } else {
      skipped += 1;
    }
  }

  const activities = [...byFingerprint.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  return { activities, added, replaced, skipped };
}

function mergeActivity(existing, incoming) {
  return {
    date: existing.date,
    title: cleanText(incoming.title).length >= cleanText(existing.title).length ? incoming.title : existing.title,
    type: cleanText(incoming.type).length >= cleanText(existing.type).length ? incoming.type : existing.type,
    ascent: incoming.ascent > 0 ? incoming.ascent : existing.ascent,
    distance: incoming.distance > 0 ? incoming.distance : existing.distance,
    durationSeconds: incoming.durationSeconds > 0 ? incoming.durationSeconds : existing.durationSeconds,
    ascentExcluded: existing.ascentExcluded || incoming.ascentExcluded ? 1 : 0
  };
}

function activityFingerprint(activity) {
  return [
    new Date(activity.date).toISOString(),
    normalizeHeader(activity.type),
    normalizeHeader(activity.title),
    Number(activity.distance || 0).toFixed(3),
    Math.round(activity.durationSeconds || 0),
    Math.round(activity.ascent || 0)
  ].join("|");
}

function activityScore(activity) {
  let score = 0;
  if (cleanText(activity.title)) score += 1;
  if (cleanText(activity.type)) score += 1;
  if (Number(activity.distance || 0) > 0) score += 2;
  if (Number(activity.durationSeconds || 0) > 0) score += 2;
  if (Number(activity.ascent || 0) > 0 || activity.ascentExcluded) score += 1;
  return score;
}

function splitCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.length > 1 || cleanText(row[0])) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function findHeaderIndex(headers, candidates) {
  for (const candidate of candidates) {
    const exact = headers.indexOf(candidate);
    if (exact !== -1) return exact;
  }
  for (let index = 0; index < headers.length; index += 1) {
    if (candidates.some(candidate => headers[index].includes(candidate))) return index;
  }
  return -1;
}

function getCell(row, index) {
  return index >= 0 && index < row.length ? row[index] : "";
}

function parseActivityDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.replace("T", " ").replace("Z", "");
  const direct = Date.parse(normalized);
  if (!Number.isNaN(direct)) return new Date(direct);

  const match = normalized.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return null;
}

function parseAscentFeet(value, header) {
  const text = cleanText(value);
  if (!text || text === "--") return null;
  const numeric = Number.parseFloat(text.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return /meter|\(m\)|\sm$/i.test(header) ? numeric * 3.28084 : numeric;
}

function parseDistanceMiles(value, header) {
  const text = cleanText(value);
  if (!text || text === "--") return 0;
  const numeric = Number.parseFloat(text.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return /kilometer|kilometre|\bkm\b/i.test(`${header} ${text}`) ? numeric * 0.621371 : numeric;
}

function parseDurationSeconds(value) {
  const text = cleanText(value);
  if (!text || text === "--") return 0;
  const parts = text.split(":").map(part => Number.parseFloat(part));
  if (parts.length >= 2 && parts.every(Number.isFinite)) {
    while (parts.length < 3) parts.unshift(0);
    return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  const numeric = Number.parseFloat(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}
