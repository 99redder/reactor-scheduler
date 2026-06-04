import assert from "node:assert/strict";
import { defaultSettings } from "../src/defaults.js";
import {
  batchesNeeded,
  checkCandidateFit,
  generateStaffedWindows,
  scheduleOrders
} from "../src/scheduler.js";

const settings = defaultSettings();
const r1 = settings.reactors.find((reactor) => reactor.id === "R1");
const r2 = settings.reactors.find((reactor) => reactor.id === "R2");

const r1Capacity = generateStaffedWindows(r1, settings)
  .reduce((sum, win) => sum + Math.floor((win.end - win.start) / settings.batchMinutes), 0);
const r2Capacity = generateStaffedWindows(r2, settings)
  .reduce((sum, win) => sum + Math.floor((win.end - win.start) / settings.batchMinutes), 0);

assert.equal(r1Capacity, 48, "R1 should pack 48 batches at defaults");
assert.equal(r2Capacity, 29, "R2 should lose capacity to dark shift and stranded minutes");

assert.equal(batchesNeeded({ size: 15, family: "HBS", quantityBags: 52 }, settings), 8);
assert.equal(batchesNeeded({ size: 24, family: "HBS", quantityBags: 52 }, settings), 5);
assert.equal(batchesNeeded({ size: 13.5, family: "HBS", quantityBags: 52 }, settings), 9);

const expander = checkCandidateFit([], {
  id: "x",
  size: 38,
  family: "HBS",
  quantityBags: 52,
  dueDate: "2026-06-06T12:00"
}, settings);
assert.equal(expander.status, "expander");

const colorSwitchSettings = structuredClone(settings);
colorSwitchSettings.reactors.find((reactor) => reactor.id === "R1").enabled = false;
const colorSchedule = scheduleOrders([
  { id: "a", customer: "A", size: 15, family: "HBS", quantityBags: 6, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "b", customer: "B", size: 15, family: "HBS", quantityBags: 6, color: "white", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "2" }
], colorSwitchSettings);
assert.equal(colorSchedule.events.find((event) => event.type === "changeover")?.minutes, 540);

const sameColorSchedule = scheduleOrders([
  { id: "a", customer: "A", size: 15, family: "HBS", quantityBags: 6, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "b", customer: "B", size: 15, family: "HBS", quantityBags: 6, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "2" }
], colorSwitchSettings);
assert.equal(sameColorSchedule.events.filter((event) => event.type === "changeover").length, 0);

const fit = checkCandidateFit([], {
  id: "fit",
  size: 15,
  family: "HBS",
  quantityBags: 52,
  color: "white",
  grade: "standard",
  dueDate: "2026-06-08T12:00"
}, settings);
assert.equal(fit.fits, true);
assert.equal(fit.batches, 8);
assert.ok(Number.isFinite(fit.completion));

console.log("scheduler acceptance checks passed");
