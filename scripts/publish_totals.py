#!/usr/bin/env python3
"""Generate the public K-A-Day totals feed from a Garmin CSV export."""

from __future__ import annotations

import argparse
import csv
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


def main() -> None:
    args = parse_args()
    csv_path = resolve_csv_path(args)
    totals = parse_totals(csv_path, args.year, args.daily_goal)

    if args.dry_run:
        print(json.dumps(totals.as_json(), indent=2))
        return

    output_path = args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(totals.as_json(), indent=2) + "\n", encoding="utf-8")
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


def parse_totals(csv_path: Path, year: int, daily_goal: int) -> Totals:
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

        activity_count = 0
        total_ascent = 0
        total_distance = 0.0
        total_duration_seconds = 0
        latest_activity_date: date | None = None

        for row in reader:
            activity_date = parse_activity_date(cell(row, columns.date))
            if not activity_date or activity_date.year != year:
                continue

            activity_count += 1
            latest_activity_date = max(latest_activity_date, activity_date) if latest_activity_date else activity_date

            activity_type = normalize(cell(row, columns.activity_type))
            if activity_type not in EXCLUDED_ASCENT_TYPES:
                total_ascent += parse_ascent_feet(cell(row, columns.ascent), ascent_header)
            total_distance += parse_distance_miles(cell(row, columns.distance), distance_header)
            total_duration_seconds += parse_duration_seconds(cell(row, columns.duration))

    if activity_count == 0:
        raise ValueError(f"No {year} activities could be parsed from {csv_path}")

    return Totals(
        year=year,
        daily_goal=daily_goal,
        total_ascent=round(total_ascent),
        total_distance=total_distance,
        total_duration_seconds=round(total_duration_seconds),
        activity_count=activity_count,
        latest_activity_date=latest_activity_date.isoformat() if latest_activity_date else "",
        generated_at=datetime.now().astimezone().isoformat(timespec="seconds"),
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

    run(["git", "add", str(output_path)])
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
