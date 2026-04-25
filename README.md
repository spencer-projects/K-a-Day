# K-A-Day

A local Garmin CSV tracker for a year-end vertical ascent goal.

Open `index.html` in a browser, export your activities from Garmin Connect, and load the CSV. The app stores parsed activity totals in browser local storage so you do not need to re-upload on every visit.

## Garmin export

1. Go to <https://connect.garmin.com/app/activities>.
2. Use the export/download button in the top-right of the activities page.
3. Choose CSV.
4. Load that CSV in K-A-Day.

This static version uses the CSV export as the data source so it can run locally without storing Garmin credentials or needing a backend service. The parser looks for common Garmin columns including `Date`, `Activity Type`, `Title`, `Total Ascent`, and `Elevation Gain`.

Activities with the Garmin activity type `Resort skiing` are kept in the activity list, but their ascent is counted as `0 ft` so lift-served vertical does not affect the year-end goal.

The chart draws the main actual line only through today. It also includes lighter cumulative lines for running, biking, skiing, and climbing activity types.

The activity counters show year-to-date ascent, mileage, and activity time for running, biking, skiing, and climbing. The mileage and activity-time charts use the same cumulative style as ascent, but without a goal line.

## Goal math

The default target is `1,000 ft/day`.

- Jan 1 target: `1,000 ft`
- Mar 30 target in a non-leap year: `89,000 ft`
- Full non-leap year target: `365,000 ft`
- Full leap year target: `366,000 ft`

Change the year or daily goal at the top of the page.

## Files

- `index.html` - app markup
- `styles.css` - responsive UI
- `app.js` - CSV parsing, local storage, goal math, and chart drawing
- `sample-data/activities.csv` - tiny Garmin-like sample export

## Phone totals

The `docs/` folder is a GitHub Pages-ready phone view that publishes only aggregate totals. It does not include the Garmin CSV, activity rows, titles, or source file path.

### First GitHub Pages publish

1. Create an empty GitHub repository for this project.
2. From this folder, make the first commit and push `main`:

```sh
git add .
git commit -m "Initial K-A-Day site"
git remote add origin git@github.com:<your-github-user>/K-A-Day.git
git push -u origin main
```

If you prefer HTTPS instead of SSH, use:

```sh
git remote add origin https://github.com/<your-github-user>/K-A-Day.git
```

3. In the GitHub repository, open **Settings > Pages** and set:
   - **Source**: Deploy from a branch
   - **Branch**: `main`
   - **Folder**: `/docs`

GitHub Pages docs: <https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>

After GitHub Pages finishes publishing, the phone site will be available at:

```text
https://<your-github-user>.github.io/K-A-Day/
```

Generate the public totals feed after exporting from Garmin:

```sh
scripts/publish_totals.py
```

Use the newest Garmin-looking CSV in Downloads:

```sh
scripts/publish_totals.py --latest
```

Commit and push only the regenerated totals after GitHub Pages is configured:

```sh
scripts/publish_totals.py --latest --publish
```

The `--publish` command expects:

- an `origin` remote
- at least one existing commit on `main`
- GitHub Pages already configured to publish `/docs`

The iPhone widget script lives at `docs/kaday-scriptable-widget.js`; in Scriptable, set the widget parameter to:

```text
https://<your-github-user>.github.io/K-A-Day/summary.json
```
