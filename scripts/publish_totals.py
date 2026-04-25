#!/usr/bin/env python3
"""Generate the public K-A-Day totals feed from a Garmin CSV export."""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable


DEFAULT_CSV = Path("/Users/spencer/Downloads/Activities_2023-2025.csv")
DEFAULT_OUTPUT = Path("docs/summary.json")
DEFAULT_DAILY_GOAL = 1000
EXCLUDED_ASCENT_TYPES = {"resortskiing"}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ACTIVITY_SERIES = (
    {"id": "running", "label": "Running", "color": "#58b77a", "keywords": ("run",)},
    {"id": "biking", "label": "Biking", "color": "#4f9cb7", "keywords": ("bike", "biking", "cycling", "ride")},
    {"id": "skiing", "label": "Skiing", "color": "#8d96cf", "keywords": ("ski",)},
    {"id": "climbing", "label": "Climbing", "color": "#b58e24", "keywords": ("climb", "boulder")},
)
CHART_COLORS = {
    "background": "#f4f7f1",
    "grid": "#d9e0d7",
    "axis": "#aab5ab",
    "label": "#5c665f",
    "text": "#202421",
    "actual": "#008c72",
    "target": "#d9485f",
    "cyan": "#1c8ea1",
    "gold": "#c49416",
}


@dataclass
class ColumnMap:
    date: int
    activity_type: int
    ascent: int
    distance: int
    duration: int


@dataclass
class Totals:
    year: int
    daily_goal: int
    total_ascent: int
    total_distance: float
    total_duration_seconds: int
    activity_count: int
    latest_activity_date: str
    generated_at: str

    def as_json(self) -> dict:
        return {
            "year": self.year,
            "dailyGoal": self.daily_goal,
            "totalAscent": self.total_ascent,
            "totalDistance": round(self.total_distance, 2),
            "totalDurationSeconds": self.total_duration_seconds,
            "activityCount": self.activity_count,
            "latestActivityDate": self.latest_activity_date,
            "generatedAt": self.generated_at,
        }


@dataclass
class Activity:
    activity_date: date
    activity_type: str
    ascent_feet: int
    distance_miles: float
    duration_seconds: int


def main() -> None:
    args = parse_args()
    csv_path = resolve_csv_path(args)
    totals, activities = parse_publication(csv_path, args.year, args.daily_goal)

    if args.dry_run:
        print(json.dumps(totals.as_json(), indent=2))
        return

    output_path = args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(totals.as_json(), indent=2) + "\n", encoding="utf-8")
    write_chart_svgs(output_path.parent, args.year, args.daily_goal, activities)
    print(f"Wrote {output_path} from {csv_path.name}")
    print(
        f"{totals.activity_count:,} activities, "
        f"{totals.total_ascent:,} ft, "
        f"{totals.total_distance:,.1f} mi, "
        f"{totals.total_duration_seconds / 3600:,.1f} h"
    )

    if args.publish:
        publish(output_path, totals)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Parse a Garmin activities CSV and write docs/summary.json for the phone tracker."
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help=f"CSV file to parse. Default: {DEFAULT_CSV}")
    parser.add_argument(
        "--latest",
        action="store_true",
        help="Use the newest Garmin-looking CSV in ~/Downloads instead of --csv.",
    )
    parser.add_argument("--downloads-dir", type=Path, default=Path.home() / "Downloads")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--year", type=int, default=date.today().year)
    parser.add_argument("--daily-goal", type=int, default=DEFAULT_DAILY_GOAL)
    parser.add_argument("--dry-run", action="store_true", help="Print the generated JSON without writing it.")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Commit docs/summary.json and push it to the configured git remote.",
    )
    return parser.parse_args()


def resolve_csv_path(args: argparse.Namespace) -> Path:
    if args.latest:
        return newest_download_csv(args.downloads_dir)

    csv_path = args.csv.expanduser()
    if csv_path.exists():
        return csv_path

    return newest_download_csv(args.downloads_dir)


def newest_download_csv(downloads_dir: Path) -> Path:
    downloads_dir = downloads_dir.expanduser()
    preferred = list(downloads_dir.glob("Activities*.csv"))
    candidates = preferred or list(downloads_dir.glob("*.csv"))
    if not candidates:
        raise FileNotFoundError(f"No CSV files found in {downloads_dir}")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def parse_publication(csv_path: Path, year: int, daily_goal: int) -> tuple[Totals, list[Activity]]:
    csv_path = csv_path.expanduser()
    if daily_goal <= 0:
        raise ValueError("--daily-goal must be greater than zero")

    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        try:
            headers = next(reader)
        except StopIteration as exc:
            raise ValueError("The CSV is empty") from exc

        columns = find_columns(headers)
        ascent_header = headers[columns.ascent]
        distance_header = headers[columns.distance] if columns.distance != -1 else ""

        activities: list[Activity] = []

        for row in reader:
            activity_date = parse_activity_date(cell(row, columns.date))
            if not activity_date or activity_date.year != year:
                continue

            activity_type = normalize(cell(row, columns.activity_type))
            activities.append(
                Activity(
                    activity_date=activity_date,
                    activity_type=activity_type,
                    ascent_feet=0
                    if activity_type in EXCLUDED_ASCENT_TYPES
                    else parse_ascent_feet(cell(row, columns.ascent), ascent_header),
                    distance_miles=parse_distance_miles(cell(row, columns.distance), distance_header),
                    duration_seconds=parse_duration_seconds(cell(row, columns.duration)),
                )
            )

    if not activities:
        raise ValueError(f"No {year} activities could be parsed from {csv_path}")

    latest_activity_date = max(activity.activity_date for activity in activities)
    total_ascent = round(sum(activity.ascent_feet for activity in activities))
    total_distance = sum(activity.distance_miles for activity in activities)
    total_duration_seconds = round(sum(activity.duration_seconds for activity in activities))

    return (
        Totals(
            year=year,
            daily_goal=daily_goal,
            total_ascent=total_ascent,
            total_distance=total_distance,
            total_duration_seconds=total_duration_seconds,
            activity_count=len(activities),
            latest_activity_date=latest_activity_date.isoformat(),
            generated_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        ),
        activities,
    )


def find_columns(headers: list[str]) -> ColumnMap:
    normalized_headers = [normalize(header) for header in headers]
    columns = ColumnMap(
        date=find_header_index(normalized_headers, ["date", "activitydate", "starttime", "startdate"]),
        activity_type=find_header_index(normalized_headers, ["activitytype", "type", "sport"]),
        ascent=find_header_index(
            normalized_headers,
            ["totalascent", "elevationgain", "elevgain", "ascent", "gain", "climb"],
        ),
        distance=find_header_index(normalized_headers, ["distance", "mileage"]),
        duration=find_header_index(normalized_headers, ["time", "duration", "movingtime", "elapsedtime"]),
    )

    missing = []
    if columns.date == -1:
        missing.append("date")
    if columns.activity_type == -1:
        missing.append("activity type")
    if columns.ascent == -1:
        missing.append("ascent")
    if missing:
        raise ValueError(f"Could not find required column(s): {', '.join(missing)}")
    return columns


def find_header_index(headers: list[str], candidates: Iterable[str]) -> int:
    candidates = list(candidates)
    for candidate in candidates:
        if candidate in headers:
            return headers.index(candidate)
    for index, header in enumerate(headers):
        if any(candidate in header for candidate in candidates):
            return index
    return -1


def cell(row: list[str], index: int) -> str:
    if index == -1 or index >= len(row):
        return ""
    return row[index].strip()


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def parse_activity_date(value: str) -> date | None:
    text = value.strip()
    if not text:
        return None

    iso_match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if iso_match:
        return safe_date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))

    slash_match = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", text)
    if slash_match:
        year = int(slash_match.group(3))
        if year < 100:
            year += 2000
        return safe_date(year, int(slash_match.group(1)), int(slash_match.group(2)))

    month_match = re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b", text)
    if month_match:
        month = month_number(month_match.group(1))
        return safe_date(int(month_match.group(3)), month, int(month_match.group(2))) if month else None

    return None


def safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def month_number(value: str) -> int:
    months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    prefix = value[:3].lower()
    return months.index(prefix) + 1 if prefix in months else 0


def parse_ascent_feet(value: str, header: str) -> int:
    text = value.strip()
    if not text or text == "--":
        return 0
    numeric = parse_number(text)
    if not math.isfinite(numeric):
        return 0
    is_meters = bool(re.search(r"meter|\(m\)|\sm$", header, re.I) or re.search(r"\d\s?m$", text, re.I))
    return round(numeric * 3.28084) if is_meters else round(numeric)


def parse_distance_miles(value: str, header: str) -> float:
    text = value.strip()
    if not text or text == "--":
        return 0.0
    numeric = parse_number(text)
    if not math.isfinite(numeric):
        return 0.0
    is_kilometers = bool(re.search(r"kilometer|kilometre|\bkm\b", f"{header} {text}", re.I))
    return numeric * 0.621371 if is_kilometers else numeric


def parse_duration_seconds(value: str) -> int:
    text = value.strip()
    if not text or text == "--":
        return 0

    if ":" in text:
        try:
            parts = [float(part) for part in text.split(":")][-3:]
        except ValueError:
            parts = []
        if parts:
            while len(parts) < 3:
                parts.insert(0, 0.0)
            return round(parts[0] * 3600 + parts[1] * 60 + parts[2])

    hours = regex_number(text, r"(\d+(?:\.\d+)?)\s*h")
    minutes = regex_number(text, r"(\d+(?:\.\d+)?)\s*m")
    seconds = regex_number(text, r"(\d+(?:\.\d+)?)\s*s")
    if hours or minutes or seconds:
        return round(hours * 3600 + minutes * 60 + seconds)
    numeric = parse_number(text)
    return round(numeric) if math.isfinite(numeric) else 0


def parse_number(value: str) -> float:
    cleaned = re.sub(r"[^0-9.-]", "", value.replace(",", ""))
    if cleaned in {"", "-", ".", "-."}:
        return math.nan
    try:
        return float(cleaned)
    except ValueError:
        return math.nan


def regex_number(text: str, pattern: str) -> float:
    match = re.search(pattern, text, re.I)
    return float(match.group(1)) if match else 0.0


def write_chart_svgs(output_dir: Path, year: int, daily_goal: int, activities: list[Activity]) -> None:
    summary = summarize_activities(activities, year, daily_goal)
    charts = {
        "ascent-chart.svg": render_ascent_chart(summary),
        "mileage-chart.svg": render_metric_chart(
            summary,
            title="Mileage",
            value_key="distance",
            series_suffix="Distance",
            color=CHART_COLORS["cyan"],
            formatter=format_axis_miles,
        ),
        "time-chart.svg": render_metric_chart(
            summary,
            title="Activity time",
            value_key="duration",
            series_suffix="Duration",
            color=CHART_COLORS["gold"],
            formatter=format_axis_duration,
        ),
    }

    for filename, content in charts.items():
        (output_dir / filename).write_text(content, encoding="utf-8")


def summarize_activities(activities: list[Activity], year: int, daily_goal: int) -> dict:
    days = days_in_year(year)
    today_index = target_day_index(year)
    by_day = [0] * (days + 1)
    distance_by_day = [0.0] * (days + 1)
    duration_by_day = [0] * (days + 1)
    by_activity_type = {
        series["id"]: {
            "ascent": [0] * (days + 1),
            "distance": [0.0] * (days + 1),
            "duration": [0] * (days + 1),
        }
        for series in ACTIVITY_SERIES
    }

    for activity in activities:
        day = day_of_year(activity.activity_date)
        series_id = get_activity_series_id(activity.activity_type)
        by_day[day] += activity.ascent_feet
        distance_by_day[day] += activity.distance_miles
        duration_by_day[day] += activity.duration_seconds
        if series_id:
            by_activity_type[series_id]["ascent"][day] += activity.ascent_feet
            by_activity_type[series_id]["distance"][day] += activity.distance_miles
            by_activity_type[series_id]["duration"][day] += activity.duration_seconds

    cumulative_ascent = 0
    cumulative_distance = 0.0
    cumulative_duration = 0
    cumulative_by_activity = {
        series["id"]: {"ascent": 0, "distance": 0.0, "duration": 0}
        for series in ACTIVITY_SERIES
    }
    points = []
    for day in range(1, days + 1):
        cumulative_ascent += by_day[day]
        cumulative_distance += distance_by_day[day]
        cumulative_duration += duration_by_day[day]
        point = {
            "day": day,
            "actual": cumulative_ascent,
            "target": day * daily_goal,
            "distance": cumulative_distance,
            "duration": cumulative_duration,
        }
        for series in ACTIVITY_SERIES:
            cumulative_by_activity[series["id"]]["ascent"] += by_activity_type[series["id"]]["ascent"][day]
            cumulative_by_activity[series["id"]]["distance"] += by_activity_type[series["id"]]["distance"][day]
            cumulative_by_activity[series["id"]]["duration"] += by_activity_type[series["id"]]["duration"][day]
            point[series["id"]] = cumulative_by_activity[series["id"]]["ascent"]
            point[f'{series["id"]}Distance'] = cumulative_by_activity[series["id"]]["distance"]
            point[f'{series["id"]}Duration'] = cumulative_by_activity[series["id"]]["duration"]
        points.append(point)

    return {
        "year": year,
        "daily_goal": daily_goal,
        "days": days,
        "today_index": today_index,
        "year_goal": days * daily_goal,
        "points": points,
        "current_points": points[:today_index],
        "target_ascent": today_index * daily_goal,
    }


def render_ascent_chart(summary: dict) -> str:
    width = 1200
    height = 640
    bounds = {"left": 68, "right": width - 24, "top": 24, "bottom": height - 54}
    draw_area = {"width": bounds["right"] - bounds["left"], "height": bounds["bottom"] - bounds["top"]}
    max_actual = max((point["actual"] for point in summary["points"]), default=0)
    max_y = nice_ceil(max(max_actual, summary["target_ascent"], summary["year_goal"]))

    elements = render_chart_frame(
        summary,
        width,
        height,
        bounds,
        draw_area,
        max_y,
        format_axis_feet,
        subtitle="Actual vs target",
    )

    for series in ACTIVITY_SERIES:
        points = [point for point in summary["current_points"] if point[series["id"]] > 0]
        elements.append(
            svg_polyline(
                summary,
                points,
                series["id"],
                bounds,
                draw_area,
                max_y,
                stroke=series["color"],
                stroke_width=2.5,
                opacity=0.55,
            )
        )

    elements.append(
        svg_polyline(
            summary,
            summary["points"],
            "target",
            bounds,
            draw_area,
            max_y,
            stroke=CHART_COLORS["target"],
            stroke_width=2,
            dash="8 7",
        )
    )
    elements.append(
        svg_polyline(
            summary,
            summary["current_points"],
            "actual",
            bounds,
            draw_area,
            max_y,
            stroke=CHART_COLORS["actual"],
            stroke_width=3,
        )
    )
    elements.append(svg_today_marker(summary, bounds, draw_area, max_y, "actual", CHART_COLORS["actual"]))

    return wrap_svg(width, height, "Ascent chart", elements)


def render_metric_chart(
    summary: dict,
    *,
    title: str,
    value_key: str,
    series_suffix: str,
    color: str,
    formatter,
) -> str:
    width = 1200
    height = 420
    bounds = {"left": 58, "right": width - 20, "top": 20, "bottom": height - 50}
    draw_area = {"width": bounds["right"] - bounds["left"], "height": bounds["bottom"] - bounds["top"]}
    max_value = max((point[value_key] for point in summary["current_points"]), default=0)
    max_y = nice_ceil(max(max_value, 1))

    elements = render_chart_frame(summary, width, height, bounds, draw_area, max_y, formatter, subtitle=title)

    for series in ACTIVITY_SERIES:
        key = f'{series["id"]}{series_suffix}'
        points = [point for point in summary["current_points"] if point[key] > 0]
        elements.append(
            svg_polyline(
                summary,
                points,
                key,
                bounds,
                draw_area,
                max_y,
                stroke=series["color"],
                stroke_width=2.5,
                opacity=0.55,
            )
        )

    elements.append(
        svg_polyline(
            summary,
            summary["current_points"],
            value_key,
            bounds,
            draw_area,
            max_y,
            stroke=color,
            stroke_width=3,
        )
    )
    elements.append(svg_today_marker(summary, bounds, draw_area, max_y, value_key, color))

    return wrap_svg(width, height, title, elements)


def render_chart_frame(
    summary: dict,
    width: int,
    height: int,
    bounds: dict,
    draw_area: dict,
    max_y: int,
    formatter,
    *,
    subtitle: str,
) -> list[str]:
    elements = [
        f'<rect x="0" y="0" width="{width}" height="{height}" rx="12" fill="{CHART_COLORS["background"]}"/>',
        svg_text(bounds["left"], 30, subtitle, size=18, weight=700, anchor="start", fill=CHART_COLORS["text"]),
    ]

    grid_count = 5
    for index in range(grid_count + 1):
        y = bounds["bottom"] - (draw_area["height"] * index / grid_count)
        value = max_y * index / grid_count
        elements.append(
            f'<line x1="{fmt(bounds["left"])}" y1="{fmt(y)}" x2="{fmt(bounds["right"])}" y2="{fmt(y)}" '
            f'stroke="{CHART_COLORS["grid"]}" stroke-width="1"/>'
        )
        elements.append(
            svg_text(
                bounds["left"] - 10,
                y + 4,
                formatter(value),
                size=12,
                anchor="end",
                fill=CHART_COLORS["label"],
            )
        )

    elements.append(
        f'<path d="M {fmt(bounds["left"])} {fmt(bounds["top"])} V {fmt(bounds["bottom"])} H {fmt(bounds["right"])}" '
        f'fill="none" stroke="{CHART_COLORS["axis"]}" stroke-width="1.5"/>'
    )

    for month in range(12):
        day = day_of_year(date(summary["year"], month + 1, 1))
        x = x_for_day(day, bounds, summary["days"])
        elements.append(
            svg_text(x, bounds["bottom"] + 28, MONTHS[month], size=12, anchor="middle", fill=CHART_COLORS["label"])
        )

    return elements


def svg_polyline(
    summary: dict,
    points: list[dict],
    key: str,
    bounds: dict,
    draw_area: dict,
    max_y: int,
    *,
    stroke: str,
    stroke_width: float,
    opacity: float = 1.0,
    dash: str | None = None,
) -> str:
    if not points:
        return ""

    coord_string = " ".join(
        f"{fmt(x_for_day(point['day'], bounds, summary['days']))},{fmt(y_for_value(point[key], bounds, draw_area, max_y))}"
        for point in points
    )
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    extra = ""
    if len(points) == 1:
        point = points[0]
        extra = (
            f'<circle cx="{fmt(x_for_day(point["day"], bounds, summary["days"]))}" '
            f'cy="{fmt(y_for_value(point[key], bounds, draw_area, max_y))}" '
            f'r="{fmt(stroke_width + 1)}" fill="{stroke}" opacity="{fmt(opacity)}"/>'
        )

    return (
        f'<polyline fill="none" points="{coord_string}" stroke="{stroke}" stroke-width="{fmt(stroke_width)}" '
        f'stroke-linecap="round" stroke-linejoin="round" opacity="{fmt(opacity)}"{dash_attr}/>{extra}'
    )


def svg_today_marker(summary: dict, bounds: dict, draw_area: dict, max_y: int, key: str, color: str) -> str:
    today_point = summary["points"][summary["today_index"] - 1] if summary["points"] else None
    if not today_point:
        return ""

    x = x_for_day(summary["today_index"], bounds, summary["days"])
    y = y_for_value(today_point[key], bounds, draw_area, max_y)
    anchor = "end" if x > bounds["right"] - 120 else "start"
    label_x = x - 8 if anchor == "end" else x + 8

    return (
        f'<line x1="{fmt(x)}" y1="{fmt(bounds["top"])}" x2="{fmt(x)}" y2="{fmt(bounds["bottom"])}" '
        f'stroke="{CHART_COLORS["cyan"]}" stroke-width="1.5" stroke-dasharray="4 6"/>'
        f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="5" fill="{color}"/>'
        f'{svg_text(label_x, bounds["top"] + 12, "Today", size=12, weight=700, anchor=anchor, fill=CHART_COLORS["text"])}'
    )


def wrap_svg(width: int, height: int, title: str, elements: list[str]) -> str:
    content = "".join(element for element in elements if element)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="{html.escape(title)}">{content}</svg>\n'
    )


def svg_text(
    x: float,
    y: float,
    text: str,
    *,
    size: int,
    anchor: str,
    fill: str,
    weight: int = 500,
) -> str:
    return (
        f'<text x="{fmt(x)}" y="{fmt(y)}" fill="{fill}" font-family="Inter, system-ui, sans-serif" '
        f'font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{html.escape(text)}</text>'
    )


def get_activity_series_id(activity_type: str) -> str:
    for series in ACTIVITY_SERIES:
        if any(keyword in activity_type for keyword in series["keywords"]):
            return series["id"]
    return ""


def days_in_year(year: int) -> int:
    return 366 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 365


def target_day_index(year: int) -> int:
    today = date.today()
    if today.year < year:
        return 1
    if today.year > year:
        return days_in_year(year)
    return day_of_year(today)


def day_of_year(value: date) -> int:
    return (value - date(value.year, 1, 1)).days + 1


def x_for_day(day: int, bounds: dict, total_days: int) -> float:
    ratio = 0 if total_days <= 1 else (day - 1) / (total_days - 1)
    return bounds["left"] + (bounds["right"] - bounds["left"]) * ratio


def y_for_value(value: float, bounds: dict, draw_area: dict, max_y: int) -> float:
    return bounds["bottom"] - (value / max_y) * draw_area["height"] if max_y else bounds["bottom"]


def nice_ceil(value: float) -> int:
    if value <= 0:
        return 1000
    power = 10 ** math.floor(math.log10(value))
    return math.ceil(value / power) * power


def format_axis_feet(value: float) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}m"
    if value >= 1000:
        return f"{round(value / 1000)}k"
    return str(round(value))


def format_axis_miles(value: float) -> str:
    if value >= 1000:
        return f"{value / 1000:.1f}k"
    if value >= 100:
        return str(round(value))
    return f"{value:.1f}" if value < 10 else f"{value:.0f}"


def format_axis_duration(value: float) -> str:
    hours = value / 3600
    if hours >= 1000:
        return f"{hours / 1000:.1f}k h"
    if hours >= 1:
        return f"{round(hours)}h"
    return f"{round(value / 60)}m"


def fmt(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def publish(output_path: Path, totals: Totals) -> None:
    ensure_git_repository()
    if not has_commits():
        raise SystemExit(
            "No git commits exist yet. Make the initial commit and push main before using --publish."
        )
    if not has_remote("origin"):
        raise SystemExit(
            "No git remote named origin. Create the GitHub repo, add origin, and push main before using --publish."
        )

    run(
        [
            "git",
            "add",
            str(output_path),
            str(output_path.parent / "ascent-chart.svg"),
            str(output_path.parent / "mileage-chart.svg"),
            str(output_path.parent / "time-chart.svg"),
        ]
    )
    if run(["git", "diff", "--cached", "--quiet"], check=False).returncode == 0:
        print("No summary changes to commit.")
        return
    run(["git", "commit", "-m", f"Update K-A-Day totals {totals.latest_activity_date}"])
    branch = current_branch()
    if has_upstream(branch):
        run(["git", "push"])
    else:
        run(["git", "push", "-u", "origin", branch])


def ensure_git_repository() -> None:
    if run(["git", "rev-parse", "--is-inside-work-tree"], check=False, capture_output=True).returncode != 0:
        raise SystemExit("This command must be run inside the K-A-Day git repository.")


def has_commits() -> bool:
    return run(["git", "rev-parse", "--verify", "HEAD"], check=False, capture_output=True).returncode == 0


def has_remote(name: str) -> bool:
    return run(["git", "remote", "get-url", name], check=False, capture_output=True).returncode == 0


def current_branch() -> str:
    result = run(["git", "branch", "--show-current"], capture_output=True)
    branch = result.stdout.strip()
    if not branch:
        raise SystemExit("Could not determine the current git branch.")
    return branch


def has_upstream(branch: str) -> bool:
    return run(
        ["git", "rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}"],
        check=False,
        capture_output=True,
    ).returncode == 0


def run(
    command: list[str],
    check: bool = True,
    capture_output: bool = False,
) -> subprocess.CompletedProcess:
    if capture_output:
        return subprocess.run(
            command,
            check=check,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    return subprocess.run(command, check=check)


if __name__ == "__main__":
    main()
