"""Regressions for Garmin exports with separate activity and climbing ascent."""

import csv
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "publish_totals.py"
SPEC = importlib.util.spec_from_file_location("publish_totals", SCRIPT)
publication = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = publication
SPEC.loader.exec_module(publication)


class GarminAscentTests(unittest.TestCase):
    def parse_rows(self, headers, rows):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "activities.csv"
            with path.open("w", newline="", encoding="utf-8-sig") as handle:
                writer = csv.writer(handle)
                writer.writerow(headers)
                writer.writerows(rows)
            return publication.parse_publication(path, 2026, 1000)

    def test_activity_ascent_wins_over_climbing_total_ascent(self):
        totals, activities = self.parse_rows(
            ["Activity Type", "Date", "Ascent", "Max Ascent", "Total Ascent", "Climb Time"],
            [
                ["Mountaineering", "2026-10-13 07:21:15", "2,117", "--", "--", "--"],
                ["Indoor Climbing", "2026-09-30 19:57:15", "320", "100", "319", "00:30:00"],
            ],
        )
        self.assertEqual(totals.total_ascent, 2437)
        self.assertEqual([activity.ascent_feet for activity in activities], [2117, 320])

    def test_activity_ascent_with_units_wins_regardless_of_column_order(self):
        for header, value, expected in (
            ("Ascent (ft)", "1,234", 1234),
            ("Ascent (feet)", "1,234", 1234),
            ("Ascent (m)", "100", 328),
            ("Ascent (meters)", "100", 328),
            ("Ascent (metres)", "100", 328),
        ):
            with self.subTest(header=header):
                totals, _ = self.parse_rows(
                    ["Date", "Activity Type", "Total Ascent", header],
                    [["2026-10-13", "Hiking", "999", value]],
                )
                self.assertEqual(totals.total_ascent, expected)

    def test_legacy_ascent_headers_remain_supported(self):
        for header in ("Total Ascent", "Total Ascent (ft)", "Elevation Gain", "Elev Gain", "Gain", "Climb"):
            with self.subTest(header=header):
                totals, _ = self.parse_rows(
                    ["Date", "Activity Type", header],
                    [["2026-10-13", "Hiking", "123"]],
                )
                self.assertEqual(totals.total_ascent, 123)

    def test_similar_headers_are_not_ascent_columns(self):
        for header in ("Max Ascent", "Climb Time", "Total Rest", "Elevation Gain Rate"):
            with self.subTest(header=header):
                with self.assertRaisesRegex(ValueError, "required column.*ascent"):
                    publication.find_columns(["Date", "Activity Type", header])

    def test_blank_activity_ascent_does_not_use_climbing_total(self):
        totals, _ = self.parse_rows(
            ["Date", "Activity Type", "Ascent", "Total Ascent"],
            [["2026-10-13", "Indoor Climbing", "--", "999"]],
        )
        self.assertEqual(totals.total_ascent, 0)

    def test_excluded_activity_types_still_have_zero_ascent(self):
        totals, activities = self.parse_rows(
            ["Date", "Activity Type", "Ascent", "Total Ascent"],
            [
                ["2026-10-13", "Open Water Swimming", "100", "--"],
                ["2026-10-12", "Resort Skiing", "200", "--"],
                ["2026-10-11", "Hiking", "300", "--"],
            ],
        )
        self.assertEqual(totals.total_ascent, 300)
        self.assertEqual([activity.ascent_feet for activity in activities], [0, 0, 300])


if __name__ == "__main__":
    unittest.main()
