import assert from "node:assert/strict";
import { defaultSettings } from "../src/defaults.js";
import {
  bagsPerBatch,
  batchesNeeded,
  checkCandidateFit,
  generateStaffedWindows,
  isTruckFillable,
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
assert.equal(bagsPerBatch(settings, 15, "HBS"), 6.5);

const hbrSettings = structuredClone(settings);
hbrSettings.sizes.find((row) => row.size === 5 && row.family === "HBR").bagsPerBatch = 10;
assert.equal(isTruckFillable(hbrSettings, 5, "HBR"), false);
assert.equal(batchesNeeded({ size: 5, family: "HBR", quantityBags: 30 }, hbrSettings), 3);

const expander = checkCandidateFit([], {
  id: "x",
  size: 38,
  family: "HBS",
  productCode: "38X",
  quantityBags: 52,
  dueDate: "2026-06-06T12:00"
}, settings);
assert.equal(expander.status, "expander");
assert.match(expander.message, /size-22 base on R3 \+ expander pass/);

const direct38 = checkCandidateFit([], {
  id: "direct38",
  size: 38,
  family: "HBS",
  productCode: "38X",
  expanded: false,
  quantityBags: 52,
  color: "black",
  grade: "standard",
  dueDate: "2026-06-08T12:00"
}, settings);
assert.equal(direct38.status, "scheduled");

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

const allocationSchedule = scheduleOrders([
  { id: "white", customer: "W", size: 15, family: "HBS", quantityBags: 6, color: "white", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "black", customer: "B", size: 15, family: "HBS", quantityBags: 6, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "2" }
], settings);
assert.equal(allocationSchedule.events.find((event) => event.orderId === "white")?.reactorId, "R2");
assert.equal(allocationSchedule.events.find((event) => event.orderId === "black")?.reactorId, "R1");

const cambroSchedule = scheduleOrders([
  { id: "cambro", customer: "Cambro", size: 20, family: "HBS", quantityBags: 9, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" }
], settings);
assert.equal(cambroSchedule.events.find((event) => event.orderId === "cambro")?.reactorId, "R1");

const cambroR2Fit = checkCandidateFit([], {
  id: "cambro-r2",
  customer: "Cambro",
  size: 20,
  family: "HBS",
  quantityBags: 9,
  color: "black",
  grade: "standard",
  preferredReactor: "R2",
  dueDate: "2026-06-08T12:00"
}, settings);
assert.equal(cambroR2Fit.status, "blocked");
assert.match(cambroR2Fit.message, /Cambro size-20 is barred from R2; must schedule on R1/);

const noExclusionSettings = structuredClone(settings);
noExclusionSettings.reactorExclusions = [];
const cambroR2Allowed = checkCandidateFit([], {
  id: "cambro-r2-ok",
  customer: "Cambro",
  size: 20,
  family: "HBS",
  quantityBags: 9,
  color: "black",
  grade: "standard",
  preferredReactor: "R2",
  dueDate: "2026-06-08T12:00"
}, noExclusionSettings);
assert.equal(cambroR2Allowed.status, "scheduled");
assert.deepEqual(cambroR2Allowed.reactors, ["R2"]);

const manualR2Schedule = scheduleOrders([
  { id: "white", customer: "W", size: 15, family: "HBS", quantityBags: 6, color: "white", grade: "standard", preferredReactor: "R2", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "black", customer: "B", size: 15, family: "HBS", quantityBags: 6, color: "black", grade: "standard", preferredReactor: "R2", dueDate: "2026-06-08T12:00", createdAt: "2" }
], settings);
assert.equal(manualR2Schedule.events.find((event) => event.type === "changeover")?.minutes, 540);

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
