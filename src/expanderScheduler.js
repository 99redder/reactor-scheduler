import { dateToScheduleMinute, minutesToDate, normalizeColor } from "./scheduler.js";

export function generateExpanderWindows(expander, settings) {
  const windows = [];
  const shiftsPerDay = Math.floor(settings.minutesPerDay / settings.shiftLength);
  const total = settings.daysPerWeek * settings.minutesPerDay;
  for (let day = 0; day < settings.daysPerWeek; day += 1) {
    for (let shift = 0; shift < shiftsPerDay; shift += 1) {
      if (!expander.staffedShifts.includes(shift)) continue;
      const start = day * settings.minutesPerDay + shift * settings.shiftLength;
      windows.push({ start, end: Math.min(start + settings.shiftLength, total), expanderId: expander.id });
    }
  }
  if (!expander.mergeAdjacentWindows) return windows;
  return windows.reduce((merged, window) => {
    const prior = merged[merged.length - 1];
    if (prior && prior.end === window.start) prior.end = window.end;
    else merged.push({ ...window });
    return merged;
  }, []);
}

export function expanderBagsPerBatch(settings, size) {
  const row = findExpanderSize(settings, size);
  if (!row) return null;
  if (Number(row.bagsPerBatch)) return Number(row.bagsPerBatch);
  if (Number(row.batchesPerTruck)) return Number(settings.truckBags) / Number(row.batchesPerTruck);
  return null;
}

export function plannedBatchMinutes(settings, size) {
  const row = findExpanderSize(settings, size);
  if (!row) return 0;
  const efficiency = Math.max(1, Number(settings.efficiency?.globalPercent || 100));
  return Number(row.batchMinutes) / (efficiency / 100);
}

export function expanderBatchesNeeded(order, settings) {
  const bags = order.orderType === "bulk" ? Number(order.quantity || 0) * Number(settings.truckBags) : Number(order.quantityBags ?? order.quantity ?? 0);
  const perBatch = expanderBagsPerBatch(settings, order.size);
  if (!bags || !perBatch) return 0;
  return Math.ceil(bags / perBatch);
}

export function scheduleExpanderOrders(orders, settings, loadedBatchIds = []) {
  const expanders = settings.expanders.filter((expander) => expander.enabled);
  const states = Object.fromEntries(expanders.map((expander) => [expander.id, {
    expander,
    windows: generateExpanderWindows(expander, settings),
    events: [],
    currentColor: expander.defaultColor || "black"
  }]));
  const allBatches = buildExpanderBatches(orders, settings);
  const white = allBatches.filter((batch) => normalizeColor(batch.color) === "white").sort(batchSort);
  const black = allBatches.filter((batch) => normalizeColor(batch.color) !== "white").sort(batchSort);
  const unscheduled = [];

  if (states.E2 && white.length) {
    placeWhiteRun(states.E2, white, settings, loadedBatchIds, unscheduled);
  } else {
    unscheduled.push(...white);
  }

  for (const batch of black) {
    const candidates = expanders
      .filter((expander) => expanderCanRun(expander, batch, settings))
      .map((expander) => placeExpanderCandidate(batch, states[expander.id], settings, loadedBatchIds))
      .filter(Boolean)
      .sort((a, b) => expanderScore(a, batch) - expanderScore(b, batch) || a.batchEvent.end - b.batchEvent.end);
    if (candidates.length) commitExpanderPlacement(candidates[0], states[candidates[0].expanderId]);
    else unscheduled.push(batch);
  }

  return summarizeExpanderSchedule(states, unscheduled, settings);
}

export function checkExpanderFit(orders, candidateOrder, settings, loadedBatchIds = []) {
  const candidate = { ...candidateOrder, id: candidateOrder.id || `candidate-${Date.now()}`, createdAt: new Date().toISOString() };
  const schedule = scheduleExpanderOrders([...orders, candidate], settings, loadedBatchIds);
  const events = schedule.events.filter((event) => event.orderId === candidate.id && event.type === "batch");
  const completion = events.length ? Math.max(...events.map((event) => event.end)) : null;
  const due = candidate.dueDate ? dateToScheduleMinute(settings.weekStart, candidate.dueDate) : Number.MAX_SAFE_INTEGER;
  return {
    status: events.length ? "scheduled" : "blocked",
    message: events.length ? "" : expanderExclusionMessage(candidate, settings),
    batches: expanderBatchesNeeded(candidate, settings),
    fits: completion !== null && completion <= due,
    completion,
    expanders: [...new Set(events.map((event) => event.expanderId))],
    schedule
  };
}

export function upsizeExpanderCheck(orders, orderId, newQuantity, settings, loadedBatchIds = []) {
  const original = orders.find((order) => order.id === orderId);
  if (!original) return null;
  const oldBatches = expanderBatchesNeeded(original, settings);
  const result = checkExpanderFit(orders.filter((order) => order.id !== orderId), { ...original, quantity: Number(newQuantity), quantityBags: original.orderType === "bulk" ? undefined : Number(newQuantity) }, settings, loadedBatchIds);
  return { ...result, oldBatches, incrementalBatches: Math.max(0, result.batches - oldBatches) };
}

function findExpanderSize(settings, size) {
  return settings.sizes.find((row) => String(row.size).toUpperCase() === String(size).toUpperCase());
}

function buildExpanderBatches(orders, settings) {
  return [...orders].sort(batchSort).flatMap((order) => {
    const count = expanderBatchesNeeded(order, settings);
    return Array.from({ length: count }, (_, index) => ({
      id: `${order.id}-eb${index + 1}`,
      orderId: order.id,
      sequence: index + 1,
      customer: order.customer,
      company: order.company || order.customer,
      location: order.location || "",
      productCode: order.productCode,
      preferredExpander: order.preferredExpander || "",
      size: String(order.size).toUpperCase(),
      grade: order.grade || "standard",
      color: normalizeColor(order.color || "black"),
      orderType: order.orderType || "bag",
      dueDate: order.dueDate,
      minutes: plannedBatchMinutes(settings, order.size)
    }));
  });
}

function placeWhiteRun(state, whiteBatches, settings, loadedBatchIds, unscheduled) {
  const flip = Number(settings.colorFlipMinutes || 0);
  const runEvents = [
    { id: `white-run-in-${Date.now()}`, type: "color-flip", expanderId: state.expander.id, minutes: flip, color: "white", label: "black to white flip" },
    ...whiteBatches.map((batch) => ({ ...batch, type: "batch", expanderId: state.expander.id, status: loadedBatchIds.includes(batch.id) ? "loaded" : "needed" })),
    { id: `white-run-out-${Date.now()}`, type: "color-flip", expanderId: state.expander.id, minutes: flip, color: "black", label: "white to black flip" }
  ];
  const placed = placeEventSequence(runEvents, state, settings);
  if (placed) {
    state.events.push(...placed);
    state.currentColor = "black";
  } else {
    unscheduled.push(...whiteBatches);
  }
}

function placeExpanderCandidate(batch, state, settings, loadedBatchIds) {
  const events = [{ ...batch, type: "batch", expanderId: state.expander.id, status: loadedBatchIds.includes(batch.id) ? "loaded" : "needed" }];
  const placed = placeEventSequence(events, state, settings);
  if (!placed) return null;
  return { expanderId: state.expander.id, events: placed, batchEvent: placed[placed.length - 1], batch };
}

function placeEventSequence(events, state, settings) {
  const searchFrom = lastEventEnd(state.events);
  const totalMinutes = events.reduce((sum, event) => sum + Number(event.minutes || 0), 0);
  for (const window of state.windows) {
    const start = Math.max(searchFrom, window.start);
    if (start + totalMinutes > window.end) continue;
    let cursor = start;
    return events.map((event) => {
      const placed = { ...event, start: cursor, end: cursor + Number(event.minutes || 0) };
      cursor = placed.end;
      return placed;
    });
  }
  return null;
}

function commitExpanderPlacement(placement, state) {
  state.events.push(...placement.events);
  state.currentColor = placement.batch.color;
}

function expanderCanRun(expander, order, settings) {
  if (!expander.enabled) return false;
  if (order.preferredExpander && expander.id !== order.preferredExpander) return false;
  if (!expander.colors.includes(normalizeColor(order.color))) return false;
  return !isExpanderExcluded(expander.id, order, settings);
}

function isExpanderExcluded(expanderId, order, settings) {
  return matchingExpanderExclusions(order, settings).some((rule) => String(rule.expander || "").trim() === expanderId);
}

function matchingExpanderExclusions(order, settings) {
  return (settings.exclusions || []).filter((rule) => fieldMatches(rule.company || rule.customer, order.company || order.customer)
    && fieldMatches(rule.location, order.location)
    && fieldMatches(rule.size, order.size)
    && fieldMatches(rule.grade, order.grade || "standard")
    && fieldMatches(rule.color, normalizeColor(order.color)));
}

function expanderExclusionMessage(order, settings) {
  const matches = matchingExpanderExclusions(order, settings);
  if (!matches.length) return "";
  const barred = matches.map((rule) => rule.expander).join(", ");
  const fallback = settings.expanders
    .filter((expander) => expander.enabled && expander.colors.includes(normalizeColor(order.color)) && !matches.some((rule) => rule.expander === expander.id))
    .map((expander) => expander.id)
    .join(", ");
  return `${order.size} is barred from ${barred}${fallback ? `; route to ${fallback}` : ""}.`;
}

function summarizeExpanderSchedule(states, unscheduled, settings) {
  const expanders = Object.values(states).map((state) => {
    const availableMinutes = state.windows.reduce((sum, win) => sum + win.end - win.start, 0);
    const batchEvents = state.events.filter((event) => event.type === "batch");
    const flipEvents = state.events.filter((event) => event.type === "color-flip");
    const blackMinutes = batchEvents.filter((event) => event.color !== "white").reduce((sum, event) => sum + event.end - event.start, 0);
    const whiteMinutes = batchEvents.filter((event) => event.color === "white").reduce((sum, event) => sum + event.end - event.start, 0);
    const flipMinutes = flipEvents.reduce((sum, event) => sum + event.end - event.start, 0);
    return {
      id: state.expander.id,
      name: state.expander.name,
      windows: state.windows,
      events: state.events,
      availableMinutes,
      scheduledMinutes: blackMinutes + whiteMinutes,
      blackMinutes,
      whiteMinutes,
      flipMinutes,
      whiteRunCount: countWhiteRuns(flipEvents),
      utilization: availableMinutes ? (blackMinutes + whiteMinutes + flipMinutes) / availableMinutes : 0,
      headroomMinutes: Math.max(0, availableMinutes - blackMinutes - whiteMinutes - flipMinutes)
    };
  });
  const totalBatches = expanders.flatMap((expander) => expander.events).filter((event) => event.type === "batch").length;
  const e2 = expanders.find((expander) => expander.id === "E2");
  const whiteLoad = e2 ? e2.whiteMinutes + e2.flipMinutes : 0;
  return {
    expanders,
    events: expanders.flatMap((expander) => expander.events),
    unscheduled,
    totalMinutes: settings.daysPerWeek * settings.minutesPerDay,
    totalAvailableMinutes: expanders.reduce((sum, expander) => sum + expander.availableMinutes, 0),
    totalBatches,
    r3FeedBatches: totalBatches / Number(settings.r3FeedRatio || 2),
    whiteWarning: Boolean(e2 && whiteLoad > e2.availableMinutes * (Number(settings.whiteCapacityThreshold || 60) / 100))
  };
}

function countWhiteRuns(flipEvents) {
  return flipEvents.filter((event) => event.label === "black to white flip").length;
}

function expanderScore(candidate, batch) {
  if (batch.preferredExpander && candidate.expanderId === batch.preferredExpander) return -10000;
  if (candidate.expanderId === "E1") return -100;
  return 0;
}

function batchSort(a, b) {
  return dueValue(a) - dueValue(b) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

function dueValue(order) {
  return order.dueDate ? new Date(order.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
}

function fieldMatches(ruleValue, orderValue) {
  if (ruleValue === undefined || ruleValue === null || String(ruleValue).trim() === "") return true;
  return String(ruleValue).trim().toLowerCase() === String(orderValue || "").trim().toLowerCase();
}

function lastEventEnd(events) {
  return events.length ? events[events.length - 1].end : 0;
}

export { minutesToDate };
