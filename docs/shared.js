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
const MEMBER_COLORS = ["#36c7a5", "#55c7d8", "#f0bd3f", "#ff6b7f", "#8d96cf", "#58b77a", "#f28d35", "#c987ff"];

function sanitizeYear(value) {
  const year = Number.parseInt(value, 10);
  if (Number.isFinite(year) && year >= 2000 && year <= 2100) return year;
  return new Date().getFullYear();
}

function sanitizeGoal(value) {
  const goal = Number.parseInt(value, 10);
  if (Number.isFinite(goal) && goal > 0) return goal;
  return 1000;
}

function summarizeActivities({ activities, year, dailyGoal }) {
  const resolvedYear = sanitizeYear(year);
  const resolvedGoal = sanitizeGoal(dailyGoal);
  const days = daysInYear(resolvedYear);
  const todayIndex = getTargetDayIndex(resolvedYear);
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

  const inYearActivities = (activities || [])
    .map(activity => ({ ...activity, localDate: new Date(activity.date) }))
    .filter(activity => activity.localDate.getFullYear() === resolvedYear);

  const monthLimit = getMonthLimit(resolvedYear);
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
      target: day * resolvedGoal,
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

  return {
    year: resolvedYear,
    dailyGoal: resolvedGoal,
    days,
    todayIndex,
    points,
    currentPoints,
    typeSeries,
    typeTotals,
    monthlyTotals,
    inYearActivities,
    hasMetricFields,
    totalAscent: currentPoint.actual || 0,
    totalDistance: currentPoint.distance || 0,
    totalDuration: currentPoint.duration || 0,
    targetAscent: todayIndex * resolvedGoal,
    gap: (currentPoint.actual || 0) - todayIndex * resolvedGoal,
    average: todayIndex ? Math.round((currentPoint.actual || 0) / todayIndex) : 0,
    yearGoal: days * resolvedGoal
  };
}

function formatFeet(value) {
  return `${Math.round(value || 0).toLocaleString()} ft`;
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

function renderAscentChart(canvas, summary) {
  renderChartBase(canvas, summary, ctx => {
    const drawArea = getDrawArea(canvas, summary, 68, 24, 24, 54);
    drawBackground(ctx, drawArea.bounds, drawArea.area, drawArea.maxY, formatAxisFeet);
    drawMonthTicks(ctx, drawArea.bounds, summary);
    for (const series of summary.typeSeries) {
      drawLine(ctx, drawArea.bounds, drawArea.area, series.points, series.id, drawArea.maxY, series.color, 2.5, [], summary.days, 0.65);
    }
    drawLine(ctx, drawArea.bounds, drawArea.area, summary.points, "target", drawArea.maxY, CHART_COLORS.target, 2, [8, 7], summary.days, 1);
    drawLine(ctx, drawArea.bounds, drawArea.area, summary.currentPoints, "actual", drawArea.maxY, CHART_COLORS.actual, 3, [], summary.days, 1);
    drawTodayMarker(ctx, drawArea.bounds, drawArea.area, summary, drawArea.maxY, "actual", CHART_COLORS.actual);
  });
}

function renderMetricChart(canvas, summary, options) {
  const { valueKey, seriesSuffix, color, formatter } = options;
  renderChartBase(canvas, summary, ctx => {
    const drawArea = getDrawArea(canvas, summary, 58, 20, 20, 50, Math.max(...summary.currentPoints.map(point => point[valueKey] || 0), 1));
    drawBackground(ctx, drawArea.bounds, drawArea.area, drawArea.maxY, formatter);
    drawMonthTicks(ctx, drawArea.bounds, summary);

    for (const series of ACTIVITY_SERIES) {
      const key = `${series.id}${seriesSuffix}`;
      const points = summary.currentPoints.filter(point => point[key] > 0);
      drawLine(ctx, drawArea.bounds, drawArea.area, points, key, drawArea.maxY, series.color, 2.5, [], summary.days, 0.65);
    }

    drawLine(ctx, drawArea.bounds, drawArea.area, summary.currentPoints, valueKey, drawArea.maxY, color, 3, [], summary.days, 1);
    drawTodayMarker(ctx, drawArea.bounds, drawArea.area, summary, drawArea.maxY, valueKey, color);
  });
}

function renderComparisonChart(canvas, year, memberSeries) {
  const summaryLike = { year, days: daysInYear(year), todayIndex: getTargetDayIndex(year) };
  renderChartBase(canvas, summaryLike, ctx => {
    const maxValue = Math.max(
      1,
      ...memberSeries.flatMap(member => member.points.map(point => point.value || 0))
    );
    const drawArea = getDrawArea(canvas, summaryLike, 68, 24, 24, 54, maxValue);
    drawBackground(ctx, drawArea.bounds, drawArea.area, drawArea.maxY, formatAxisFeet);
    drawMonthTicks(ctx, drawArea.bounds, summaryLike);
    memberSeries.forEach((member, index) => {
      const points = member.points.map(point => ({ day: point.day, member: point.value }));
      drawLine(ctx, drawArea.bounds, drawArea.area, points, "member", drawArea.maxY, member.color || MEMBER_COLORS[index % MEMBER_COLORS.length], 3, [], summaryLike.days, 0.92);
    });
    drawTodayMarker(ctx, drawArea.bounds, drawArea.area, { ...summaryLike, points: [{ day: summaryLike.todayIndex, actual: maxValue }] }, drawArea.maxY);
  });
}

function colorForMember(index) {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}

function renderChartBase(canvas, summary, draw) {
  const parentWidth = canvas.parentElement.clientWidth;
  const cssHeight = Number.parseInt(getComputedStyle(canvas).height, 10) || 520;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(520, Math.floor(parentWidth * scale));
  canvas.height = Math.floor(cssHeight * scale);

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, parentWidth, cssHeight);
  draw(ctx);
}

function getDrawArea(canvas, summary, left, top, rightInset, bottomInset, explicitMaxValue = null) {
  const parentWidth = canvas.parentElement.clientWidth;
  const cssHeight = Number.parseInt(getComputedStyle(canvas).height, 10) || 520;
  const bounds = {
    left,
    right: parentWidth - rightInset,
    top,
    bottom: cssHeight - bottomInset
  };
  const area = {
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top
  };
  const fallback = Math.max(...(summary.points || []).map(point => point.actual || 0), summary.targetAscent || 0, summary.yearGoal || 0, 1);
  const maxY = niceCeil(explicitMaxValue ?? fallback);
  return { bounds, area, maxY };
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
  const pointSet = summary.points || [];
  const todayPoint = pointSet[summary.todayIndex - 1];
  if (!todayPoint) return;
  const x = xForDay(summary.todayIndex, bounds, summary.days);
  const y = yForValue(todayPoint[valueKey] || todayPoint.actual || 0, bounds, drawArea, maxY);

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
  return bounds.bottom - ((value || 0) / maxY) * drawArea.height;
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

function getCountedAscent(activity) {
  return shouldExcludeAscent(activity.type) ? 0 : Math.max(0, activity.ascent || 0);
}

function getDistanceMiles(activity) {
  return Math.max(0, activity.distance || 0);
}

function getDurationSeconds(activity) {
  return Math.max(0, activity.durationSeconds || activity.duration || 0);
}

function getActivitySeriesId(activityType) {
  const normalizedType = normalizeHeader(activityType || "");
  const series = ACTIVITY_SERIES.find(item => item.match(normalizedType));
  return series?.id || "";
}

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldExcludeAscent(activityType) {
  return EXCLUDED_ASCENT_TYPES.has(normalizeHeader(activityType));
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

window.KADAY_SHARED = {
  MONTHS,
  EXCLUDED_ASCENT_TYPES,
  CHART_COLORS,
  ACTIVITY_SERIES,
  MEMBER_COLORS,
  sanitizeYear,
  sanitizeGoal,
  summarizeActivities,
  formatFeet,
  formatMiles,
  formatDuration,
  formatDayOfYear,
  renderAscentChart,
  renderMetricChart,
  renderComparisonChart,
  colorForMember
};
