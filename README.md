# K-A-Day

A static Garmin CSV tracker for a year-end vertical ascent goal.

This version runs entirely in the browser. It stores each person's activity history in that browser's local storage, so GitHub Pages works again and friends can also run the repo locally on their own computer without a backend.

## Run it locally

You can either open `index.html` directly or use a tiny local file server:

```sh
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

## GitHub Pages

The `docs/` folder contains the hosted copy for GitHub Pages.

1. Push this repo to GitHub.
2. In the repo, open **Settings > Pages**.
3. Set:
   - **Source**: Deploy from a branch
   - **Branch**: `main`
   - **Folder**: `/docs`

After Pages publishes, the app will be available at:

```text
https://<your-github-user>.github.io/K-A-Day/
```

## Local profiles

The `User` field is now a local profile name, not a shared account.

- Each browser keeps its own saved profiles and activity history.
- Uploading a CSV merges new activities into that local profile's lifetime list.
- Friends can use the public GitHub Pages site independently, or clone the repo and run it locally with their own browser storage.
- No uploaded activity data is shared between people unless they manually share CSV files.

## Garmin export

1. Go to <https://connect.garmin.com/app/activities>.
2. Use the export/download button in the top-right of the activities page.
3. Choose CSV.
4. Upload that CSV in K-A-Day.

The parser looks for common Garmin columns including `Date`, `Activity Type`, `Title`, `Total Ascent`, `Elevation Gain`, `Distance`, and `Time`.

## Goal math

The default target is `1,000 ft/day`.

- Jan 1 target: `1,000 ft`
- Mar 30 target in a non-leap year: `89,000 ft`
- Full non-leap year target: `365,000 ft`
- Full leap year target: `366,000 ft`

Change the year or daily goal at the top of the page.

## Files

- `index.html` - tracker page
- `shared.js` - summary math and chart rendering helpers
- `app.js` - tracker page logic
- `styles.css` - responsive dark UI
