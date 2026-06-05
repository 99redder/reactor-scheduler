import assert from "node:assert/strict";
import { defaultExpanderSettings } from "../src/defaults.js";
import {
  checkExpanderFit,
  expanderBatchesNeeded,
  generateExpanderWindows,
  plannedBatchMinutes,
  scheduleExpanderOrders
} from "../src/expanderScheduler.js";

const settings = defaultExpanderSettings();
const totalCapacity = settings.expanders
  .map((expander) => generateExpanderWindows(expander, settings).reduce((sum, win) => sum + win.end - win.start, 0))
  .reduce((sum, minutes) => sum + minutes, 0);

assert.equal(totalCapacity, 17280, "two expanders should expose 17,280 min/week before changeovers");
assert.equal(settings.productionLeadDays, 2, "expander production lead time should default to 2 days");

assert.equal(expanderBatchesNeeded({ size: "30X", orderType: "bulk", quantity: 1 }, settings), 6);
assert.equal(expanderBatchesNeeded({ size: "38X", orderType: "bulk", quantity: 1 }, settings), 5);
assert.equal(expanderBatchesNeeded({ size: "52X", orderType: "bulk", quantity: 1 }, settings), 3);

const slowSettings = structuredClone(settings);
slowSettings.efficiency.globalPercent = 85;
assert.ok(plannedBatchMinutes(slowSettings, "30X") > plannedBatchMinutes(settings, "30X") * 1.17);
const fastFit = checkExpanderFit([], { id: "fast", size: "30X", orderType: "bulk", quantity: 1, color: "black", dueDate: "2026-06-08T12:00" }, settings);
const slowFit = checkExpanderFit([], { id: "slow", size: "30X", orderType: "bulk", quantity: 1, color: "black", dueDate: "2026-06-08T12:00" }, slowSettings);
assert.ok(slowFit.completion > fastFit.completion);
assert.equal(fastFit.deliveryDate, "2026-06-08T12:00");
assert.equal(fastFit.produceByDate, "2026-06-06T12:00");

const flipSchedule = scheduleExpanderOrders([
  { id: "w1", size: "30X", orderType: "bag", quantity: 9, color: "white", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "b1", size: "30X", orderType: "bag", quantity: 9, color: "black", preferredExpander: "E2", dueDate: "2026-06-08T12:00", createdAt: "2" }
], settings);
const e2FlipMinutes = flipSchedule.expanders.find((expander) => expander.id === "E2").flipMinutes;
assert.equal(e2FlipMinutes, 840);
assert.equal(flipSchedule.expanders.find((expander) => expander.id === "E1").flipMinutes, 0);

const sameColorSchedule = scheduleExpanderOrders([
  { id: "b1", size: "30X", orderType: "bag", quantity: 9, color: "black", preferredExpander: "E2", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "b2", size: "35X", orderType: "bag", quantity: 10, color: "black", preferredExpander: "E2", dueDate: "2026-06-08T12:00", createdAt: "2" }
], settings);
assert.equal(sameColorSchedule.expanders.find((expander) => expander.id === "E2").flipMinutes, 0);

const whiteConsolidated = scheduleExpanderOrders([
  { id: "w1", size: "30X", orderType: "bag", quantity: 9, color: "white", dueDate: "2026-06-08T12:00", createdAt: "1" },
  { id: "w2", size: "38X", orderType: "bag", quantity: 11, color: "white", dueDate: "2026-06-08T12:00", createdAt: "2" },
  { id: "w3", size: "52X", orderType: "bag", quantity: 18, color: "white", dueDate: "2026-06-08T12:00", createdAt: "3" }
], settings);
const e2 = whiteConsolidated.expanders.find((expander) => expander.id === "E2");
assert.equal(e2.whiteRunCount, 1);
assert.equal(e2.flipMinutes, 840);

assert.equal(whiteConsolidated.r3FeedBatches, whiteConsolidated.totalBatches / 2);

const excluded45 = scheduleExpanderOrders([
  { id: "45", size: "45X", orderType: "bag", quantity: 15, color: "black", dueDate: "2026-06-08T12:00", createdAt: "1" }
], settings);
assert.equal(excluded45.events.find((event) => event.orderId === "45")?.expanderId, "E2");

const e1FitBlocked = checkExpanderFit([], { id: "52", size: "52X", orderType: "bag", quantity: 18, color: "black", preferredExpander: "E1", dueDate: "2026-06-08T12:00" }, settings);
assert.equal(e1FitBlocked.status, "blocked");
assert.match(e1FitBlocked.message, /52X is barred from E1; route to E2/);

const noExclusionSettings = structuredClone(settings);
noExclusionSettings.exclusions = [];
noExclusionSettings.expanders.find((expander) => expander.id === "E1").colors = ["black", "white"];
const e1FitAllowed = checkExpanderFit([], { id: "52ok", size: "52X", orderType: "bag", quantity: 18, color: "black", preferredExpander: "E1", dueDate: "2026-06-08T12:00" }, noExclusionSettings);
assert.equal(e1FitAllowed.status, "scheduled");
assert.deepEqual(e1FitAllowed.expanders, ["E1"]);

const warningSettings = structuredClone(settings);
warningSettings.whiteCapacityThreshold = 10;
const warningSchedule = scheduleExpanderOrders([
  { id: "w1", size: "52X", orderType: "bulk", quantity: 10, color: "white", dueDate: "2026-06-08T12:00", createdAt: "1" }
], warningSettings);
assert.equal(warningSchedule.whiteWarning, true);

const skippedSchedule = scheduleExpanderOrders([
  { id: "skip", size: "30X", orderType: "bulk", quantity: 1, color: "black", dueDate: "2026-06-08T12:00", createdAt: "1" }
], settings, [], ["skip-eb1"]);
assert.equal(skippedSchedule.events.filter((event) => event.orderId === "skip" && event.type === "batch").length, 5);
assert.equal(skippedSchedule.events.some((event) => event.id === "skip-eb1"), false);

console.log("expander acceptance checks passed");
