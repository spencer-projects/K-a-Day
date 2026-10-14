const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const storageKey = "kaday-static-state-v1";

// Exercise the real upload event, persistence and summary with only the DOM
// and canvas drawing replaced, so these checks do not need a browser package.
function tracker(savedState, folder = "") {
  const elements = new Map();
  const storage = new Map(savedState ? [[storageKey, JSON.stringify(savedState)]] : []);
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: "", textContent: "", innerHTML: "", listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, listener) { this.listeners[name] = listener; }
    });
    return elements.get(selector);
  }
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: {
      querySelector: element,
      querySelectorAll: () => [element("stat1"), element("stat2"), element("stat3")]
    },
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value)
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, folder, "shared.js"), "utf8"), context);
  context.window.KADAY_SHARED.renderAscentChart = () => {};
  context.window.KADAY_SHARED.renderMetricChart = () => {};
  vm.runInContext(fs.readFileSync(path.join(root, folder, "app.js"), "utf8"), context);
  return {
    async upload(csv) {
      element("#csv-input").listeners.change({ target: {
        files: [{ name: "Activities.csv", text: async () => csv }]
      } });
      await new Promise(resolve => setImmediate(resolve));
    },
    get saved() { return JSON.parse(storage.get(storageKey)); },
    get activities() {
      const saved = this.saved;
      return saved.profiles[saved.currentUser.toLowerCase()].activities;
    },
    get note() { return element("#parse-note").textContent; }
  };
}

function csv(headers, rows) {
  return [headers, ...rows].map(row => row.map(value =>
    `"${String(value).replaceAll('"', '""')}"`
  ).join(",")).join("\r\n");
}

const headers = ["Activity Type", "Date", "Title", "Ascent", "Total Ascent", "Distance", "Time"];
const dualColumnCsv = csv(headers, [
  ["Mountaineering", "2026-10-13 07:21:15", "Mountain, ridge", "2,117", "--", "4.54", "08:25:53"],
  ["Indoor Climbing", "2026-09-30 08:00:00", "Climb", "320", "319", "0", "00:45:00"],
  ["Indoor Climbing", "2026-09-15 08:00:00", "Climb", "254", "255", "0", "00:35:00"],
  ["Pool Swimming", "2026-09-14 08:00:00", "Pool", "800", "--", "1760", "00:30:00"],
  ["Resort Skiing", "2026-01-02 08:00:00", "Ski", "5000", "--", "4", "01:00:00"]
]);

test("Garmin elevation Ascent wins over its separate Total Ascent field", async () => {
  const app = tracker();
  await app.upload(dualColumnCsv);
  assert.equal(app.activities.length, 5);
  assert.equal(app.activities.reduce((sum, row) => sum + row.ascent, 0), 2691);
  assert.equal(app.activities.find(row => row.type === "Mountaineering").ascent, 2117);
  assert.equal(app.activities.find(row => row.type === "Pool Swimming").distance, 1);
  assert.equal(app.activities.find(row => row.type === "Pool Swimming").ascent, 0);
  assert.equal(app.activities.find(row => row.type === "Resort Skiing").ascent, 0);
});

test("reimport repairs zero and positive incorrect ascent, preserves history, and stays idempotent", async () => {
  const app = tracker();
  await app.upload(csv(headers, [
    ["Hiking", "2025-07-01 08:00:00", "Older hike", "1500", "--", "6", "02:00:00"]
  ]));
  await app.upload(dualColumnCsv);
  const brokenState = app.saved;
  for (const row of brokenState.profiles.default.activities) {
    if (row.type === "Mountaineering") row.ascent = 0;
    if (row.type === "Indoor Climbing") row.ascent = row.ascent === 320 ? 319 : 255;
  }
  const repaired = tracker(brokenState);
  await repaired.upload(dualColumnCsv);
  assert.equal(repaired.activities.length, 6);
  assert.equal(repaired.activities.reduce((sum, row) => sum + row.ascent, 0), 4191);
  assert.match(repaired.note, /0 new, 3 upgraded, 2 duplicates skipped/);
  const once = repaired.saved;
  await repaired.upload(dualColumnCsv);
  assert.deepEqual(repaired.saved, once);
  assert.match(repaired.note, /0 new, 0 upgraded, 5 duplicates skipped/);
  assert.deepEqual(tracker(repaired.saved).activities, repaired.activities);
});

test("legacy and unit-labeled elevation headers remain supported", async () => {
  for (const [header, value, expected] of [
    ["Total Ascent", "1,200", 1200], ["Elevation Gain (ft)", "800", 800],
    ["Ascent (m)", "100", 328], ["Ascent (metres)", "100", 328],
    ["Ascent (ft)", "2117", 2117]
  ]) {
    const app = tracker();
    await app.upload(csv(["Date", "Activity Type", "Max Ascent", header], [
      ["2026-10-13 08:00:00", "Hiking", "9999", value]
    ]));
    assert.equal(app.activities[0].ascent, expected, header);
  }
  const app = tracker();
  await app.upload(csv(["Date", "Activity Type", "Total Ascent", "Ascent (m)"], [
    ["2026-10-13 08:00:00", "Hiking", "9999", "100"]
  ]));
  assert.equal(app.activities[0].ascent, 328);
});

test("ascent lookalikes report an error instead of silently importing the wrong metric", async () => {
  const app = tracker();
  await app.upload(csv(["Date", "Activity Type", "Max Ascent", "Climb Time"], [
    ["2026-10-13 08:00:00", "Hiking", "9999", "01:00:00"]
  ]));
  assert.equal(app.activities.length, 0);
  assert.match(app.note, /Could not find an ascent column/);
});

test("incomplete reimports preserve previously saved metrics", async () => {
  const app = tracker();
  await app.upload(dualColumnCsv);
  await app.upload(csv(["Date", "Activity Type", "Ascent"], [
    ["2026-10-13 07:21:15", "Mountaineering", "--"]
  ]));
  const row = app.activities.find(row => row.type === "Mountaineering");
  assert.equal(row.ascent, 2117);
  assert.equal(row.distance, 4.54);
  assert.equal(row.durationSeconds, 30353);
});

test("GitHub Pages uses the same fixed importer", async () => {
  assert.equal(fs.readFileSync(path.join(root, "app.js"), "utf8"),
    fs.readFileSync(path.join(root, "docs/app.js"), "utf8"));
  const app = tracker(undefined, "docs");
  await app.upload(dualColumnCsv);
  assert.equal(app.activities.reduce((sum, row) => sum + row.ascent, 0), 2691);
});

test("provided Garmin export imports all 40 activities and 26,754 ft", {
  skip: !process.env.GARMIN_TEST_CSV && "Set GARMIN_TEST_CSV to verify the original export"
}, async () => {
  const app = tracker();
  const content = fs.readFileSync(process.env.GARMIN_TEST_CSV, "utf8");
  await app.upload(content);
  assert.equal(app.activities.length, 40);
  assert.equal(app.activities.reduce((sum, row) => sum + row.ascent, 0), 26754);
  await app.upload(content);
  assert.equal(app.activities.length, 40);
  assert.match(app.note, /0 new, 0 upgraded, 40 duplicates skipped/);
});
