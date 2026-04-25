const STORAGE_KEY = "k-a-day-state";
const DEFAULT_USER_NAME = "Default";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EXCLUDED_ASCENT_TYPES = new Set(["resortskiing"]);
const CHART_COLORS = {
  background: "#1d2723",
  grid: "#2d3934",
  axis: "#53645d",
  label: "#9eada5",
  text: "#edf4ef",
  actual: "#36c7a5",
  target: "#ff6b7f",
  cyan: "#55c7d8",
  gold: "#f0bd3f"
};
const ACTIVITY_SERIES = [
  { id: "running", label: "Running", color: "#58b77a", match: type => type.includes("run") },
  {
    id: "biking",
    label: "Biking",
    color: "#4f9cb7",
    match: type => type.includes("bike") || type.includes("biking") || type.includes("cycling") || type.includes("ride")
  },
  { id: "skiing", label: "Skiing", color: "#8d96cf", match: type => type.includes("ski") },
  { id: "climbing", label: "Climbing", color: "#b58e24", match: type => type.includes("climb") || type.includes("boulder") }
];

const els = {
  userInput: document.querySelector("#user-input"),
  yearInput: document.querySelector("#year-input"),
  dailyGoalInput: document.querySelector("#daily-goal-input"),
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
  statCards: document.querySelectorAll(".stat-card")
};

const defaultState = {
  userName: DEFAULT_USER_NAME,
  year: new Date().getFullYear(),
  dailyGoal: 1000,
  activities: [],
  sourceName: ""
};

let vault = loadVault();
let state = loadUserState(vault.currentUser);

function loadVault() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.users && typeof saved.users === "object") {
      const currentUser = sanitizeUserName(saved.currentUser || DEFAULT_USER_NAME);
      const users = Object.fromEntries(
        Object.entries(saved.users).map(([userName, userState]) => [sanitizeUserName(userName), normalizeState(userState, userName)])
      );
      if (!users[currentUser]) users[currentUser] = normalizeState({}, currentUser);
      return { currentUser, users };
    }

    if (saved && typeof saved === "object") {
      const migratedUser = sanitizeUserName(saved.userName || DEFAULT_USER_NAME);
      return {
        currentUser: migratedUser,
        users: {
          [migratedUser]: normalizeState(saved, migratedUser)
        }
      };
    }
  } catch {
    // fall through to empty vault
  }

  return {
    currentUser: DEFAULT_USER_NAME,
    users: {
      [DEFAULT_USER_NAME]: normalizeState({}, DEFAULT_USER_NAME)
    }
  };
}

function normalizeState(savedState, userName = DEFAULT_USER_NAME) {
  return {
    ...defaultState,
    ...savedState,
    userName: sanitizeUserName(userName),
    activities: Array.isArray(savedState?.activities) ? savedState.activities : []
  };
}

function loadUserState(userName) {
  const normalizedUserName = sanitizeUserName(userName);
  return normalizeState(vault.users[normalizedUserName], normalizedUserName);
}

function saveState() {
  vault.currentUser = state.userName;
  vault.users[state.userName] = normalizeState(state, state.userName);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

function init() {
  els.userInput.value = state.userName;
  els.yearInput.value = state.year;
  els.dailyGoalInput.value = state.dailyGoal;

  els.userInput.addEventListener("change", () => {
    switchUser(els.userInput.value);
  });

  els.userInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.userInput.blur();
    }
  });

  els.yearInput.addEventListener("input", () => {
    state.year = sanitizeYear(els.yearInput.value);
    saveState();
    render();
  });

  els.dailyGoalInput.addEventListener("input", () => {
    state.dailyGoal = sanitizeGoal(els.dailyGoalInput.value);
    saveState();
    render();
  });

  els.csvInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
  });

  els.clearButton.addEventListener("click", () => {
    state.activities = [];
    state.sourceName = "";
    saveState();
    els.csvInput.value = "";
    render();
  });

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
    if (file) loadFile(file);
  });

  window.addEventListener("resize", () => renderCharts(summarize()));

  render();
}

function sanitizeYear(value) {
  const year = Number.parseInt(value, 10);
  if (Number.isFinite(year) && year >= 2000 && year <= 2100) return year;
  return defaultState.year;
}

function sanitizeUserName(value) {
  const userName = cleanCell(value).replace(/\s+/g, " ");
  return userName ? userName.slice(0, 40) : DEFAULT_USER_NAME;
}

function sanitizeGoal(value) {
  const goal = Number.parseInt(value, 10);
  if (Number.isFinite(goal) && goal > 0) return goal;
  return defaultState.dailyGoal;
}

function switchUser(nextUserName) {
  const userName = sanitizeUserName(nextUserName);
  saveState();
  if (!vault.users[userName]) {
    vault.users[userName] = normalizeState({
      year: state.year,
      dailyGoal: state.dailyGoal
    }, userName);
  }
  vault.currentUser = userName;
  state = loadUserState(userName);
  saveState();
  els.userInput.value = state.userName;
  render(`Switched to ${state.userName}.`);
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => loadCsv(String(reader.result || ""), file.name);
  reader.onerror = () => {
    els.parseNote.textContent = "Could not read that CSV. Try exporting it again from Garmin Connect.";
  };
  reader.readAsText(file);
}

function loadCsv(csvText, sourceName) {
  try {
    const parsed = parseGarminActivities(csvText);
    const merged = mergeActivities(state.activities, parsed.activities);
    state.activities = merged.activities;
    state.sourceName = merged.sourceName || sourceName;
    saveState();
    render(buildMergeNote(parsed.note, merged, sourceName));
  } catch (error) {
    els.parseNote.textContent = error.message;
  }
}

function parseGarminActivities(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error("That CSV does not contain any activities.");
  }

  const headers = rows[0].map(header => header.trim());
  const normalizedHeaders = headers.map(normalizeHeader);
  const dateIndex = findHeaderIndex(normalizedHeaders, ["date", "activitydate", "starttime", "startdate"]);
  const ascentIndex = findHeaderIndex(normalizedHeaders, [
    "totalascent",
    "elevationgain",
    "elevgain",
    "ascent",
    "gain",
    "climb"
  ]);
  const titleIndex = findHeaderIndex(normalizedHeaders, ["title", "activityname", "name"]);
  const typeIndex = findHeaderIndex(normalizedHeaders, ["activitytype", "type", "sport"]);
  const distanceIndex = findHeaderIndex(normalizedHeaders, ["distance", "mileage"]);
  const durationIndex = findHeaderIndex(normalizedHeaders, ["time", "duration", "movingtime", "elapsedtime"]);

  if (dateIndex === -1) {
    throw new Error("Could not find an activity date column in that CSV.");
  }

  if (ascentIndex === -1) {
    throw new Error("Could not find an ascent column. Garmin exports usually call it Total Ascent or Elevation Gain.");
  }

  const ascentHeader = headers[ascentIndex] || "";
  const distanceHeader = headers[distanceIndex] || "";
  let excludedAscentCount = 0;
  let blankAscentCount = 0;
  const activities = rows.slice(1).map(row => {
    const date = parseActivityDate(row[dateIndex]);
    const rawAscent = parseAscentFeet(row[ascentIndex], ascentHeader);
    const distance = distanceIndex === -1 ? 0 : parseDistanceMiles(row[distanceIndex], distanceHeader);
    const durationSeconds = durationIndex === -1 ? 0 : parseDurationSeconds(row[durationIndex]);
    const title = cleanCell(row[titleIndex]) || cleanCell(row[typeIndex]) || "Activity";
    const type = cleanCell(row[typeIndex]);
    const excludesAscent = shouldExcludeAscent(type);
    const ascent = Number.isFinite(rawAscent) ? rawAscent : 0;

    if (excludesAscent) excludedAscentCount += 1;
    if (!Number.isFinite(rawAscent)) blankAscentCount += 1;

    return date
      ? {
          date: date.toISOString(),
          title,
          type,
          ascent: excludesAscent ? 0 : Math.max(0, ascent),
          distance: Math.max(0, distance || 0),
          durationSeconds: Math.max(0, durationSeconds || 0),
          ascentExcluded: excludesAscent
        }
      : null;
  }).filter(Boolean);

  if (!activities.length) {
    throw new Error("No dated ascent activities could be parsed from that CSV.");
  }

  activities.sort((a, b) => new Date(a.date) - new Date(b.date));

  const unitNote = /meter|\(m\)|\sm$/i.test(ascentHeader)
    ? "Converted ascent from meters to feet."
    : "Assumed ascent values are feet, matching Garmin's exported units.";
  const blankAscentNote = blankAscentCount
    ? ` Treated blank ascent as 0 ft for ${blankAscentCount.toLocaleString()} activit${blankAscentCount === 1 ? "y" : "ies"}.`
    : "";
  const excludeNote = excludedAscentCount
    ? ` Removed ascent from ${excludedAscentCount.toLocaleString()} Resort skiing ${excludedAscentCount === 1 ? "activity" : "activities"}.`
    : "";

  return {
    activities,
    note: `${activities.length.toLocaleString()} activities loaded. ${unitNote}${blankAscentNote}${excludeNote}`
  };
}

function mergeActivities(existingActivities, incomingActivities) {
  const mergedMap = new Map();
  let added = 0;
  let replaced = 0;
  let skipped = 0;

  for (const activity of existingActivities || []) {
    mergedMap.set(activityFingerprint(activity), activity);
  }

  for (const activity of incomingActivities || []) {
    const key = activityFingerprint(activity);
    const existing = mergedMap.get(key);

    if (!existing) {
      mergedMap.set(key, activity);
      added += 1;
      continue;
    }

    if (isMoreCompleteActivity(activity, existing)) {
      mergedMap.set(key, mergeActivityRecords(existing, activity));
      replaced += 1;
    } else {
      skipped += 1;
    }
  }

  const activities = [...mergedMap.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  return {
    activities,
    added,
    replaced,
    skipped,
    sourceName: "Merged lifetime list"
  };
}

function buildMergeNote(parseNote, merged, sourceName) {
  const mergeBits = [
    `${merged.added.toLocaleString()} new`,
    `${merged.skipped.toLocaleString()} duplicate${merged.skipped === 1 ? "" : "s"} skipped`
  ];

  if (merged.replaced) {
    mergeBits.splice(1, 0, `${merged.replaced.toLocaleString()} existing upgraded`);
  }

  return `${parseNote} ${sourceName}: ${mergeBits.join(", ")}. Lifetime list now has ${merged.activities.length.toLocaleString()} activities.`;
}

function activityFingerprint(activity) {
  return [
    new Date(activity.date).toISOString(),
    normalizeHeader(activity.type || ""),
    normalizeHeader(activity.title || ""),
    roundMetric(activity.distance, 3),
    Number(activity.durationSeconds || activity.duration || 0),
    Number(activity.ascent || 0)
  ].join("|");
}

function mergeActivityRecords(existing, incoming) {
  return {
    ...existing,
    ...incoming,
    title: chooseBetterText(existing.title, incoming.title),
    type: chooseBetterText(existing.type, incoming.type),
    ascent: chooseBetterNumber(existing.ascent, incoming.ascent),
    distance: chooseBetterNumber(existing.distance, incoming.distance),
    durationSeconds: chooseBetterNumber(existing.durationSeconds || existing.duration, incoming.durationSeconds || incoming.duration),
    ascentExcluded: existing.ascentExcluded || incoming.ascentExcluded
  };
}

function isMoreCompleteActivity(candidate, current) {
  return activityCompletenessScore(candidate) > activityCompletenessScore(current);
}

function activityCompletenessScore(activity) {
  let score = 0;
  if (cleanCell(activity.title)) score += 1;
  if (cleanCell(activity.type)) score += 1;
  if (Number(activity.distance || 0) > 0) score += 2;
  if (Number(activity.durationSeconds || activity.duration || 0) > 0) score += 2;
  if (Number(activity.ascent || 0) > 0 || activity.ascentExcluded) score += 1;
  return score;
}

function chooseBetterText(existing, incoming) {
  return cleanCell(incoming).length >= cleanCell(existing).length ? incoming : existing;
}

function chooseBetterNumber(existing, incoming) {
  return Number(incoming || 0) > 0 ? incoming : existing;
}

function roundMetric(value, digits) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "0";
}

function parseCsv(text) {
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
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(value => value.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldExcludeAscent(activityType) {
  return EXCLUDED_ASCENT_TYPES.has(normalizeHeader(activityType));
}

function getActivitySeriesId(activityType) {
  const normalizedType = normalizeHeader(activityType);
  const series = ACTIVITY_SERIES.find(item => item.match(normalizedType));
  return series?.id || "";
}

function findHeaderIndex(headers, candidates) {
  for (const candidate of candidates) {
    const exactIndex = headers.indexOf(candidate);
    if (exactIndex !== -1) return exactIndex;
  }

  return headers.findIndex(header => candidates.some(candidate => header.includes(candidate)));
}

function cleanCell(value) {
  return String(value || "").trim();
}

function parseActivityDate(value) {
  const text = cleanCell(value);
  if (!text) return null;

  const isoMatch = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return createLocalDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashMatch) {
    const year = normalizeYear(Number(slashMatch[3]));
    return createLocalDate(year, Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const monthMatch = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (monthMatch) {
    const month = MONTHS.findIndex(month => month.toLowerCase() === monthMatch[1].slice(0, 3).toLowerCase()) + 1;
    return month ? createLocalDate(Number(monthMatch[3]), month, Number(monthMatch[2])) : null;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.valueOf()) ? null : createLocalDate(
    fallback.getFullYear(),
    fallback.getMonth() + 1,
    fallback.getDate()
  );
}

function normalizeYear(year) {
  return year < 100 ? 2000 + year : year;
}

function createLocalDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function parseAscentFeet(value, header) {
  const text = cleanCell(value);
  if (!text) return Number.NaN;
  const isMeters = /meter|\(m\)|\sm$/i.test(header) || /\d\s?m$/i.test(text);
  const numeric = Number.parseFloat(text.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return Number.NaN;
  return Math.round(isMeters ? numeric * 3.28084 : numeric);
}

function parseDistanceMiles(value, header) {
  const text = cleanCell(value);
  if (!text) return 0;
  const numeric = Number.parseFloat(text.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  const isKilometers = /kilometer|kilometre|\bkm\b/i.test(`${header} ${text}`);
  return isKilometers ? numeric * 0.621371 : numeric;
}

function parseDurationSeconds(value) {
  const text = cleanCell(value);
  if (!text) return 0;

  const colonParts = text.split(":").map(part => Number.parseFloat(part));
  if (colonParts.length >= 2 && colonParts.every(Number.isFinite)) {
    const parts = colonParts.slice(-3);
    while (parts.length < 3) parts.unshift(0);
    return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }

  const hours = Number.parseFloat(text.match(/(\d+(?:\.\d+)?)\s*h/i)?.[1] || 0);
  const minutes = Number.parseFloat(text.match(/(\d+(?:\.\d+)?)\s*m/i)?.[1] || 0);
  const seconds = Number.parseFloat(text.match(/(\d+(?:\.\d+)?)\s*s/i)?.[1] || 0);
  if (hours || minutes || seconds) return Math.round(hours * 3600 + minutes * 60 + seconds);

  const numeric = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function summarize() {
  const year = sanitizeYear(state.year);
  const dailyGoal = sanitizeGoal(state.dailyGoal);
  const days = daysInYear(year);
  const todayIndex = getTargetDayIndex(year);
  const byDay = new Array(days + 1).fill(0);
  const distanceByDay = new Array(days + 1).fill(0);
  const durationByDay = new Array(days + 1).fill(0);
  const byActivityType = Object.fromEntries(
    ACTIVITY_SERIES.map(series => [series.id, {
      ascent: new Array(days + 1).fill(0),
      distance: new Array(days + 1).fill(0),
      duration: new Array(days + 1).fill(0)
    }])
  );
  const inYearActivities = state.activities
    .map(activity => ({ ...activity, localDate: new Date(activity.date) }))
    .filter(activity => activity.localDate.getFullYear() === year);
  const monthLimit = getMonthLimit(year);
  const monthlyTotals = Array.from({ length: monthLimit }, (_, index) => ({
    month: index,
    label: MONTHS[index],
    activities: 0,
    ascent: 0,
    distance: 0,
    duration: 0
  }));
  const hasMetricFields = !inYearActivities.length || inYearActivities.some(activity =>
    Object.prototype.hasOwnProperty.call(activity, "distance") ||
    Object.prototype.hasOwnProperty.call(activity, "durationSeconds") ||
    Object.prototype.hasOwnProperty.call(activity, "duration")
  );

  for (const activity of inYearActivities) {
    const day = getDayOfYear(activity.localDate);
    const countedAscent = getCountedAscent(activity);
    const distance = getDistanceMiles(activity);
    const duration = getDurationSeconds(activity);
    const seriesId = getActivitySeriesId(activity.type);
    byDay[day] += countedAscent;
    distanceByDay[day] += distance;
    durationByDay[day] += duration;
    if (activity.localDate.getMonth() < monthLimit) {
      const monthTotal = monthlyTotals[activity.localDate.getMonth()];
      monthTotal.activities += 1;
      monthTotal.ascent += countedAscent;
      monthTotal.distance += distance;
      monthTotal.duration += duration;
    }
    if (seriesId) {
      byActivityType[seriesId].ascent[day] += countedAscent;
      byActivityType[seriesId].distance[day] += distance;
      byActivityType[seriesId].duration[day] += duration;
    }
  }

  let cumulative = 0;
  let cumulativeDistance = 0;
  let cumulativeDuration = 0;
  const cumulativeByActivityType = Object.fromEntries(
    ACTIVITY_SERIES.map(series => [series.id, { ascent: 0, distance: 0, duration: 0 }])
  );
  const points = [];
  for (let day = 1; day <= days; day += 1) {
    cumulative += byDay[day];
    cumulativeDistance += distanceByDay[day];
    cumulativeDuration += durationByDay[day];
    for (const series of ACTIVITY_SERIES) {
      cumulativeByActivityType[series.id].ascent += byActivityType[series.id].ascent[day];
      cumulativeByActivityType[series.id].distance += byActivityType[series.id].distance[day];
      cumulativeByActivityType[series.id].duration += byActivityType[series.id].duration[day];
    }
    points.push({
      day,
      actual: cumulative,
      target: day * dailyGoal,
      distance: cumulativeDistance,
      duration: cumulativeDuration,
      ...Object.fromEntries(ACTIVITY_SERIES.flatMap(series => [
        [series.id, cumulativeByActivityType[series.id].ascent],
        [`${series.id}Distance`, cumulativeByActivityType[series.id].distance],
        [`${series.id}Duration`, cumulativeByActivityType[series.id].duration]
      ]))
    });
  }

  const currentPoints = points.slice(0, todayIndex);
  const currentPoint = currentPoints[currentPoints.length - 1] || {};
  const typeSeries = ACTIVITY_SERIES.map(series => ({
    ...series,
    points: currentPoints.filter(point => point[series.id] > 0)
  }));
  const typeTotals = ACTIVITY_SERIES.map(series => ({
    ...series,
    ascent: currentPoint[series.id] || 0,
    distance: currentPoint[`${series.id}Distance`] || 0,
    duration: currentPoint[`${series.id}Duration`] || 0
  }));
  const totalAscent = currentPoint.actual || 0;
  const totalDistance = currentPoint.distance || 0;
  const totalDuration = currentPoint.duration || 0;
  const targetAscent = todayIndex * dailyGoal;
  const gap = totalAscent - targetAscent;
  const average = todayIndex ? Math.round(totalAscent / todayIndex) : 0;
  const yearGoal = days * dailyGoal;

  return {
    year,
    dailyGoal,
    days,
    todayIndex,
    points,
    currentPoints,
    typeSeries,
    typeTotals,
    monthlyTotals,
    inYearActivities,
    hasMetricFields,
    totalAscent,
    totalDistance,
    totalDuration,
    targetAscent,
    gap,
    average,
    yearGoal
  };
}

function daysInYear(year) {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

function getTargetDayIndex(year) {
  const today = new Date();
  if (today.getFullYear() < year) return 1;
  if (today.getFullYear() > year) return daysInYear(year);
  return getDayOfYear(today);
}

function getMonthLimit(year) {
  const today = new Date();
  if (today.getFullYear() < year) return 0;
  if (today.getFullYear() > year) return 12;
  return today.getMonth() + 1;
}

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((stripTime(date) - start) / 86400000) + 1;
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function render(note) {
  const summary = summarize();
  els.userInput.value = state.userName;
  els.yearInput.value = summary.year;
  els.dailyGoalInput.value = summary.dailyGoal;
  els.totalAscent.textContent = formatFeet(summary.totalAscent);
  els.targetAscent.textContent = formatFeet(summary.targetAscent);
  els.gapAscent.textContent = `${summary.gap >= 0 ? "+" : "-"}${formatFeet(Math.abs(summary.gap))}`;
  els.dailyAverage.textContent = `${summary.average.toLocaleString()} ft/day`;

  els.statCards[2].classList.toggle("is-good", summary.gap >= 0);
  els.statCards[2].classList.toggle("is-behind", summary.gap < 0);

  const dateLabel = formatDayOfYear(summary.year, summary.todayIndex);
  els.chartSubtitle.textContent = state.activities.length
    ? `${state.sourceName || "CSV"}: ${summary.inYearActivities.length.toLocaleString()} activities in ${summary.year}. Through ${dateLabel}, the target is ${formatFeet(summary.targetAscent)}.`
    : `For ${summary.year}, the full-year goal is ${formatFeet(summary.yearGoal)}.`;

  els.metricsSubtitle.textContent = getMetricsSubtitle(summary, dateLabel);

  els.activityCount.textContent = summary.inYearActivities.length
    ? `${summary.inYearActivities.length.toLocaleString()} activities counted for ${summary.year}.`
    : "No activities loaded for this year.";
  els.monthlyCount.textContent = summary.monthlyTotals.length
    ? `${summary.monthlyTotals.length} months shown for ${summary.year}.`
    : `${summary.year} has not started yet.`;

  if (note) {
    els.parseNote.textContent = note;
  } else if (state.activities.length && !summary.hasMetricFields) {
    els.parseNote.textContent = "Reload your Garmin CSV to populate mileage and activity time for data saved before those fields were tracked.";
  } else if (!state.activities.length) {
    els.parseNote.textContent = "";
  }

  renderActivityTotals(summary.typeTotals);
  renderTable(summary.inYearActivities);
  renderMonthlyTotals(summary.monthlyTotals);
  renderCharts(summary);
}

function formatFeet(value) {
  return `${Math.round(value).toLocaleString()} ft`;
}

function formatMiles(value) {
  const miles = Number(value) || 0;
  return `${miles.toLocaleString(undefined, { maximumFractionDigits: miles < 100 ? 1 : 0 })} mi`;
}

function formatDuration(seconds) {
  const totalSeconds = Math.round(seconds || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours) return `${hours.toLocaleString()}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDayOfYear(year, dayIndex) {
  const date = new Date(year, 0, dayIndex);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getMetricsSubtitle(summary, dateLabel) {
  if (!state.activities.length) {
    return "Cumulative totals through today, with lighter lines by activity.";
  }

  if (!summary.hasMetricFields) {
    return "Reload your Garmin CSV to populate mileage and activity time.";
  }

  return `Through ${dateLabel}: ${formatMiles(summary.totalDistance)} and ${formatDuration(summary.totalDuration)} logged.`;
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

function renderTable(activities) {
  if (!activities.length) {
    els.activityTable.innerHTML = `<tr><td colspan="3">Your exported activities will appear here.</td></tr>`;
    return;
  }

  const recent = [...activities].sort((a, b) => b.localDate - a.localDate).slice(0, 8);
  els.activityTable.innerHTML = recent.map(activity => `
    <tr>
      <td>${activity.localDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
      <td>${escapeHtml(activity.title || activity.type || "Activity")}</td>
      <td>${formatFeet(getCountedAscent(activity))}</td>
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

function getCountedAscent(activity) {
  return shouldExcludeAscent(activity.type) ? 0 : Math.max(0, activity.ascent || 0);
}

function getDistanceMiles(activity) {
  return Math.max(0, activity.distance || 0);
}

function getDurationSeconds(activity) {
  return Math.max(0, activity.durationSeconds || activity.duration || 0);
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

function renderCharts(summary) {
  renderAscentChart(summary);
  renderMetricChart(summary, {
    canvas: els.mileageChart,
    valueKey: "distance",
    seriesSuffix: "Distance",
    color: CHART_COLORS.cyan,
    formatter: formatAxisMiles
  });
  renderMetricChart(summary, {
    canvas: els.timeChart,
    valueKey: "duration",
    seriesSuffix: "Duration",
    color: CHART_COLORS.gold,
    formatter: formatAxisDuration
  });
}

function renderAscentChart(summary) {
  const canvas = els.chart;
  const parentWidth = canvas.parentElement.clientWidth;
  const cssHeight = Number.parseInt(getComputedStyle(canvas).height, 10) || 520;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(640, Math.floor(parentWidth * scale));
  canvas.height = Math.floor(cssHeight * scale);

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, parentWidth, cssHeight);

  const bounds = {
    left: 68,
    right: parentWidth - 24,
    top: 24,
    bottom: cssHeight - 54
  };

  const maxActual = Math.max(...summary.points.map(point => point.actual), summary.targetAscent, summary.yearGoal);
  const maxY = niceCeil(maxActual);
  const drawArea = {
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top
  };

  drawBackground(ctx, bounds, drawArea, maxY);
  drawMonthTicks(ctx, bounds, summary);
  for (const series of summary.typeSeries) {
    drawLine(ctx, bounds, drawArea, series.points, series.id, maxY, series.color, 2.5, [], summary.days, 0.65);
  }
  drawLine(ctx, bounds, drawArea, summary.points, "target", maxY, CHART_COLORS.target, 2, [8, 7], summary.days, 1);
  drawLine(ctx, bounds, drawArea, summary.currentPoints, "actual", maxY, CHART_COLORS.actual, 3, [], summary.days, 1);
  drawTodayMarker(ctx, bounds, drawArea, summary, maxY);
}

function renderMetricChart(summary, options) {
  const { canvas, valueKey, seriesSuffix, color, formatter } = options;
  const parentWidth = canvas.parentElement.clientWidth;
  const cssHeight = Number.parseInt(getComputedStyle(canvas).height, 10) || 360;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(520, Math.floor(parentWidth * scale));
  canvas.height = Math.floor(cssHeight * scale);

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, parentWidth, cssHeight);

  const bounds = {
    left: 58,
    right: parentWidth - 20,
    top: 20,
    bottom: cssHeight - 50
  };
  const drawArea = {
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top
  };
  const maxValue = Math.max(...summary.currentPoints.map(point => point[valueKey] || 0), 1);
  const maxY = niceCeil(maxValue);

  drawBackground(ctx, bounds, drawArea, maxY, formatter);
  drawMonthTicks(ctx, bounds, summary);

  for (const series of ACTIVITY_SERIES) {
    const key = `${series.id}${seriesSuffix}`;
    const points = summary.currentPoints.filter(point => point[key] > 0);
    drawLine(ctx, bounds, drawArea, points, key, maxY, series.color, 2.5, [], summary.days, 0.65);
  }

  drawLine(ctx, bounds, drawArea, summary.currentPoints, valueKey, maxY, color, 3, [], summary.days, 1);
  drawTodayMarker(ctx, bounds, drawArea, summary, maxY, valueKey, color);
}

function drawBackground(ctx, bounds, drawArea, maxY, formatter = formatAxisFeet) {
  ctx.fillStyle = CHART_COLORS.background;
  ctx.fillRect(0, 0, bounds.right + 24, bounds.bottom + 54);
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = CHART_COLORS.label;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const gridCount = 5;
  for (let index = 0; index <= gridCount; index += 1) {
    const y = bounds.bottom - (drawArea.height * index / gridCount);
    const value = maxY * index / gridCount;
    ctx.beginPath();
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.right, y);
    ctx.stroke();
    ctx.fillText(formatter(value), bounds.left - 10, y);
  }

  ctx.strokeStyle = CHART_COLORS.axis;
  ctx.beginPath();
  ctx.moveTo(bounds.left, bounds.top);
  ctx.lineTo(bounds.left, bounds.bottom);
  ctx.lineTo(bounds.right, bounds.bottom);
  ctx.stroke();
}

function drawMonthTicks(ctx, bounds, summary) {
  ctx.fillStyle = CHART_COLORS.label;
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let month = 0; month < 12; month += 1) {
    const day = getDayOfYear(new Date(summary.year, month, 1));
    const x = xForDay(day, bounds, summary.days);
    ctx.fillText(MONTHS[month], x, bounds.bottom + 18);
  }
}

function drawLine(ctx, bounds, drawArea, points, key, maxY, color, width, dash, totalDays, opacity) {
  if (!points.length) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();

  points.forEach((point, index) => {
    const x = xForDay(point.day, bounds, totalDays);
    const y = yForValue(point[key], bounds, drawArea, maxY);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  if (points.length === 1) {
    const point = points[0];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(xForDay(point.day, bounds, totalDays), yForValue(point[key], bounds, drawArea, maxY), width + 1, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawTodayMarker(ctx, bounds, drawArea, summary, maxY, valueKey = "actual", color = CHART_COLORS.actual) {
  const todayPoint = summary.points[summary.todayIndex - 1];
  if (!todayPoint) return;

  const x = xForDay(summary.todayIndex, bounds, summary.days);
  const y = yForValue(todayPoint[valueKey] || 0, bounds, drawArea, maxY);

  ctx.save();
  ctx.strokeStyle = CHART_COLORS.cyan;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(x, bounds.top);
  ctx.lineTo(x, bounds.bottom);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CHART_COLORS.text;
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  ctx.textAlign = x > bounds.right - 120 ? "right" : "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("Today", x + (x > bounds.right - 120 ? -8 : 8), bounds.top + 4);
  ctx.restore();
}

function xForDay(day, bounds, totalDays) {
  const ratio = totalDays <= 1 ? 0 : (day - 1) / (totalDays - 1);
  return bounds.left + (bounds.right - bounds.left) * ratio;
}

function yForValue(value, bounds, drawArea, maxY) {
  return bounds.bottom - (value / maxY) * drawArea.height;
}

function niceCeil(value) {
  if (value <= 0) return 1000;
  const power = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / power) * power;
}

function formatAxisFeet(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function formatAxisMiles(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return String(Math.round(value));
  return value.toFixed(value < 10 ? 1 : 0);
}

function formatAxisDuration(value) {
  const hours = value / 3600;
  if (hours >= 1000) return `${(hours / 1000).toFixed(1)}k h`;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.round(value / 60)}m`;
}

init();
