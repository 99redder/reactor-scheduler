import assert from "node:assert/strict";
import { defaultSettings } from "../src/defaults.js";
import {
  bagsPerBatch,
  batchesPerTruck,
  batchesNeeded,
  checkCandidateFit,
  generateStaffedWindows,
  isTruckFillable,
  scheduleOrders,
  visibleYieldFields
} from "../src/scheduler.js";

const settings = defaultSettings();
const r1 = settings.reactors.find((reactor) => reactor.id === "R1");
const r2 = settings.reactors.find((reactor) => reactor.id === "R2");
const r3 = settings.reactors.find((reactor) => reactor.id === "R3");

const r1Capacity = generateStaffedWindows(r1, settings)
  .reduce((sum, win) => sum + Math.floor((win.end - win.start) / settings.batchMinutes), 0);
const r2Capacity = generateStaffedWindows(r2, settings)
  .reduce((sum, win) => sum + Math.floor((win.end - win.start) / settings.batchMinutes), 0);

assert.equal(r1Capacity, 48, "R1 should pack 48 batches at defaults");
assert.equal(r2Capacity, 29, "R2 should lose capacity to dark shift and stranded minutes");
assert.deepEqual(r3.colors, ["black"], "R3 should be black-only by default");
assert.equal(settings.productionLeadDays, 2, "reactor production lead time should default to 2 days");

assert.equal(batchesNeeded({ size: 15, family: "HBS", quantityBags: 52 }, settings), 8);
assert.equal(batchesNeeded({ size: 24, family: "HBS", quantityBags: 52 }, settings), 5);
assert.equal(batchesNeeded({ size: 13.5, family: "HBS", quantityBags: 52 }, settings), 9);
assert.equal(bagsPerBatch(settings, 15, "HBS"), 6.5);

const hbrSettings = structuredClone(settings);
hbrSettings.sizes.find((row) => row.size === 5 && row.family === "HBR").bagsPerBatch = 10;
assert.equal(isTruckFillable(hbrSettings, 5, "HBR"), false);
assert.equal(batchesNeeded({ size: 5, family: "HBR", quantityBags: 30 }, hbrSettings), 3);
assert.equal(batchesPerTruck(hbrSettings, 5, "HBR"), null);
assert.deepEqual(visibleYieldFields(hbrSettings, 5, "HBR"), {
  bagsPerBatch: 10,
  truckFillable: false,
  batchesPerTruck: null
});

const hbrDefault = settings.sizes.find((row) => row.size === 5 && row.family === "HBR");
assert.equal(hbrDefault.truck_fillable, false);
assert.equal(Object.hasOwn(hbrDefault, "batchesPerTruck"), false);

const flagDrivenSettings = structuredClone(settings);
flagDrivenSettings.sizes.push({ id: "14-HBR", size: 14, family: "HBR", truck_fillable: false, bags_per_batch: 7, expanded: false });
assert.equal(isTruckFillable(flagDrivenSettings, 14, "HBR"), false);
assert.equal(batchesNeeded({ size: 14, family: "HBR", quantityBags: 30 }, flagDrivenSettings), 5);

const expander = checkCandidateFit([], {
  id: "x",
  size: 38,
  family: "HBS",
  productCode: "legacy reference ignored",
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

const r1SwitchSettings = structuredClone(settings);
r1SwitchSettings.reactors.find((reactor) => reactor.id === "R1").colors = ["black", "white"];
r1SwitchSettings.reactors.find((reactor) => reactor.id === "R2").enabled = false;
const r1SwitchSchedule = scheduleOrders([
  { id: "r1-black", customer: "A", size: 15, family: "HBS", quantityBags: 6, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "r1-white", customer: "B", size: 15, family: "HBS", quantityBags: 6, color: "white", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "2" }
], r1SwitchSettings);
assert.equal(r1SwitchSchedule.events.filter((event) => event.type === "changeover").length, 0);

const allocationSchedule = scheduleOrders([
  { id: "white", customer: "W", size: 15, family: "HBS", quantityBags: 6, color: "white", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "black", customer: "B", size: 15, family: "HBS", quantityBags: 6, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "2" }
], settings);
assert.equal(allocationSchedule.events.find((event) => event.orderId === "white")?.reactorId, "R2");
assert.equal(allocationSchedule.events.find((event) => event.orderId === "black")?.reactorId, "R1");

const cambroSchedule = scheduleOrders([
  { id: "cambro", company: "Cambro", location: "CA", customer: "Cambro CA", size: 20, family: "HBS", quantityBags: 9, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" }
], settings);
assert.equal(cambroSchedule.events.find((event) => event.orderId === "cambro")?.reactorId, "R1");

["CA", "TX"].forEach((location) => {
  const cambroR2Fit = checkCandidateFit([], {
    id: `cambro-${location.toLowerCase()}-r2`,
    company: "Cambro",
    location,
    customer: `Cambro ${location}`,
    size: 20,
    family: "HBS",
    quantityBags: 9,
    color: "black",
    grade: "standard",
    preferredReactor: "R2",
    dueDate: "2026-06-08T12:00"
  }, settings);
  assert.equal(cambroR2Fit.status, "blocked");
  assert.match(cambroR2Fit.message, new RegExp(`Cambro ${location} size-20 is barred from R2; must schedule on R1`));
});

const locationSpecificSettings = structuredClone(settings);
locationSpecificSettings.reactorExclusions = [
  { company: "Ventek", location: "OH", size: 15, reactor: "R2" }
];
const ventekOhR2 = checkCandidateFit([], {
  id: "ventek-oh-r2",
  company: "Ventek",
  location: "OH",
  customer: "Ventek OH",
  size: 15,
  family: "HBS",
  quantityBags: 9,
  color: "black",
  grade: "standard",
  preferredReactor: "R2",
  dueDate: "2026-06-08T12:00"
}, locationSpecificSettings);
assert.equal(ventekOhR2.status, "blocked");
const ventekMiR2 = checkCandidateFit([], {
  id: "ventek-mi-r2",
  company: "Ventek",
  location: "MI",
  customer: "Ventek MI",
  size: 15,
  family: "HBS",
  quantityBags: 9,
  color: "black",
  grade: "standard",
  preferredReactor: "R2",
  dueDate: "2026-06-08T12:00"
}, locationSpecificSettings);
assert.equal(ventekMiR2.status, "scheduled");

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
assert.equal(fit.deliveryDate, "2026-06-08T12:00");
assert.equal(fit.produceByDate, "2026-06-06T12:00");
assert.ok(Number.isFinite(fit.completion));

const skippedSchedule = scheduleOrders([
  { id: "skip", customer: "Skip", size: 15, family: "HBS", quantityBags: 52, color: "black", grade: "standard", dueDate: "2026-06-08T12:00", createdAt: "1" }
], settings, [], ["skip-b1"]);
assert.equal(skippedSchedule.events.filter((event) => event.orderId === "skip" && event.type === "batch").length, 7);
assert.equal(skippedSchedule.events.some((event) => event.id === "skip-b1"), false);

console.log("scheduler acceptance checks passed");
