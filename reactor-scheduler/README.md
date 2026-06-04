# Reactor Scheduler

Static single-user app for polymer bead reactor capacity planning. It runs from plain files, stores data in `localStorage`, and supports JSON export/import for backup.

## Run Locally

```sh
npm test
npm run serve
```

Open `http://127.0.0.1:4173/`.

## Deploy To GitHub Pages

Push this folder to a GitHub repo and publish the repo root, or copy the folder contents into a Pages branch. No build step or backend is required.

## Structure

- `src/scheduler.js`: pure scheduling engine for staffed windows, order-to-batch conversion, changeovers, fit checks, and utilization.
- `src/expanderScheduler.js`: independent expander scheduling engine for E1/E2, expanded-size batch times, E2 white consolidation, color flips, R3 feed advisory, and expander exclusions.
- `src/storage.js`: data-store abstraction. It ships with `localStorage`; replace this module later for a tiny JSON backend.
- `src/defaults.js`: editable seed settings for reactors, yields, changeovers, and plant timing.
- `tests/scheduler.test.js`: acceptance checks for the supervisor's sanity tests.
- `tests/expander.test.js`: acceptance checks for the expander scheduler.

## Current Scope

R1 and R2 are scheduled. R3 and size-30-plus expander routes are flagged out of scope and excluded from R1/R2 capacity math.

The Expander tab schedules E1/E2 independently from the reactor schedule. It treats size-22 base as buffered silo inventory and reports only an R3 feed advisory.
