export function sizeKey(size, family) {
  return `${Number(size)}-${family || ""}`;
}

export function normalizeColor(color = "") {
  return String(color || "").trim().toLowerCase();
}

export function findYield(settings, size, family) {
  const numeric = Number(size);
  return settings.sizes.find((row) => Number(row.size) === numeric && row.family === family)
    || settings.sizes.find((row) => Number(row.size) === numeric);
}

export function isExpanderOrder(order, settings) {
  const row = findYield(settings, order.size, order.family);
  if (typeof order.expanded === "boolean") return order.expanded;
  if (typeof row?.expanded === "boolean") return row.expanded;
  if (typeof row?.expanderRoute === "boolean") return row.expanderRoute;
  return Number(order.size) >= Number(settings.expanderThreshold);
}

export function hasExpandedSuffix(productCode = "") {
  return /(?:^|[^a-z0-9])\d+(?:\.\d+)?x$/i.test(String(productCode).trim())
    || /\d+(?:\.\d+)?x$/i.test(String(productCode).trim());
}

export function defaultExpandedForOrder(order, settings) {
  if (typeof order.expanded === "boolean") return order.expanded;
  const row = findYield(settings, order.size, order.family);
  if (typeof row?.expanded === "boolean") return row.expanded;
  return Number(order.size) >= Number(settings.expanderThreshold);
}

export function bagsPerBatch(settings, size, family) {
  const row = findYield(settings, size, family);
  if (!row) return null;
  if (Number(row.bagsPerBatch ?? row.bags_per_batch)) return Number(row.bagsPerBatch ?? row.bags_per_batch);
  if (rowIsTruckFillable(row) && Number(row.batchesPerTruck ?? row.batches_per_truck)) {
    return Number(settings.truckBags) / Number(row.batchesPerTruck ?? row.batches_per_truck);
  }
  return null;
}

function rowIsTruckFillable(row) {
  return (row.truckFillable ?? row.truck_fillable) !== false;
}

export function batchesPerTruck(settings, size, family) {
  const row = findYield(settings, size, family);
  if (!row || !rowIsTruckFillable(row)) return null;
  if (Number(row.batchesPerTruck ?? row.batches_per_truck)) return Number(row.batchesPerTruck ?? row.batches_per_truck);
  if (Number(row.bagsPerBatch ?? row.bags_per_batch)) {
    return Number(settings.truckBags) / Number(row.bagsPerBatch ?? row.bags_per_batch);
  }
  return null;
}

export function isTruckFillable(settings, size, family) {
  const row = findYield(settings, size, family);
  return row ? rowIsTruckFillable(row) : true;
}

export function visibleYieldFields(settings, size, family) {
  const truckFillable = isTruckFillable(settings, size, family);
  return {
    bagsPerBatch: bagsPerBatch(settings, size, family),
    truckFillable,
    batchesPerTruck: truckFillable ? batchesPerTruck(settings, size, family) : null
  };
}

export function batchesNeeded(order, settings) {
  if (isExpanderOrder(order, settings)) return 0;
  const bags = Number(order.quantityBags || 0);
  const perBatch = bagsPerBatch(settings, order.size, order.family);
  if (!perBatch || bags <= 0) return 0;
  return Math.ceil(bags / perBatch);
}

export function generateStaffedWindows(reactor, settings) {
  const windows = [];
  const shiftsPerDay = Math.floor(settings.minutesPerDay / settings.shiftLength);
  const total = settings.daysPerWeek * settings.minutesPerDay;
  for (let day = 0; day < settings.daysPerWeek; day += 1) {
    for (let shift = 0; shift < shiftsPerDay; shift += 1) {
      if (!reactor.staffedShifts.includes(shift)) continue;
      const start = day * settings.minutesPerDay + shift * settings.shiftLength;
      const end = Math.min(start + settings.shiftLength, total);
      windows.push({ start, end, reactorId: reactor.id });
    }
  }
  const merged = !reactor.mergeAdjacentWindows ? windows : windows.reduce((acc, window) => {
    const prior = acc[acc.length - 1];
    if (prior && prior.end === window.start) {
      prior.end = window.end;
    } else {
      acc.push({ ...window });
    }
    return acc;
  }, []);
  if (settings.waterBatch) {
    const offset = Number(settings.waterBatchMinutes || 0);
    if (merged[0] && merged[0].start === 0) {
      if (merged[0].end <= offset) {
        merged.shift();
      } else {
        merged[0] = { ...merged[0], start: offset };
      }
    }
  }
  return merged;
}

export function reactorCanRun(reactor, order, settings) {
  if (!reactor.enabled) return false;
  if (order.preferredReactor && reactor.id !== order.preferredReactor) return false;
  if (isReactorExcluded(reactor.id, order, settings)) return false;
  const size = Number(order.size);
  const color = normalizeColor(order.color);
  const grade = order.grade || "standard";
  return listAllows(reactor.sizes, size)
    && listAllows(reactor.colors, color)
    && listAllows(reactor.grades, grade);
}

export function isReactorExcluded(reactorId, order, settings) {
  return matchingExclusions(order, settings).some((rule) => String(rule.reactor || "").trim() === reactorId);
}

export function matchingExclusions(order, settings) {
  return (settings.reactorExclusions || []).filter((rule) => exclusionMatches(rule, order));
}

export function exclusionMessage(order, settings) {
  const matches = matchingExclusions(order, settings);
  if (!matches.length) return "";
  const barred = matches.map((rule) => rule.reactor).filter(Boolean).join(", ");
  const fallback = eligibleReactorNames(order, settings, { ignoreExclusions: true, ignorePreferred: true })
    .filter((id) => !matches.some((rule) => rule.reactor === id))
    .join(", ");
  const spec = [order.customer, `size-${order.size}`].filter(Boolean).join(" ");
  return `${spec || "This order"} is barred from ${barred}${fallback ? `; must schedule on ${fallback}` : ""}.`;
}

function eligibleReactorNames(order, settings, options = {}) {
  return settings.reactors
    .filter((reactor) => reactor.enabled && reactor.id !== "R3")
    .filter((reactor) => {
      if (!options.ignorePreferred && order.preferredReactor && reactor.id !== order.preferredReactor) return false;
      if (!options.ignoreExclusions && isReactorExcluded(reactor.id, order, settings)) return false;
      const size = Number(order.size);
      const color = normalizeColor(order.color);
      const grade = order.grade || "standard";
      return listAllows(reactor.sizes, size)
        && listAllows(reactor.colors, color)
        && listAllows(reactor.grades, grade);
    })
    .map((reactor) => reactor.id);
}

function exclusionMatches(rule, order) {
  return fieldMatches(rule.company || rule.customer, order.company || order.customer)
    && fieldMatches(rule.location, order.location)
    && fieldMatches(rule.size, order.size, true)
    && fieldMatches(rule.family, order.family)
    && fieldMatches(rule.grade, order.grade || "standard")
    && fieldMatches(rule.color, normalizeColor(order.color));
}

function fieldMatches(ruleValue, orderValue, numeric = false) {
  if (ruleValue === undefined || ruleValue === null || String(ruleValue).trim() === "") return true;
  if (numeric) return Number(ruleValue) === Number(orderValue);
  return String(ruleValue).trim().toLowerCase() === String(orderValue || "").trim().toLowerCase();
}

function listAllows(list = [], value) {
  return list.includes("*") || list.map(String).includes(String(value));
}

export function changeoverMinutes(previous, next, reactor, settings) {
  if (!previous) return 0;
  let minutes = 0;
  const previousColor = normalizeColor(previous.color);
  const nextColor = normalizeColor(next.color);
  const isBlackWhite = (previousColor === "black" && nextColor === "white")
    || (previousColor === "white" && nextColor === "black");
  if (reactor.id === "R2" && isBlackWhite) {
    minutes += Number(settings.changeovers.blackWhiteMinutes || 0);
  }
  if ((previous.grade || "standard") !== (next.grade || "standard")) {
    minutes += Number(settings.changeovers.esdMinutes || 0);
  }
  return minutes;
}

export function buildBatches(orders, settings) {
  const sorted = [...orders]
    .filter((order) => !isExpanderOrder(order, settings))
    .sort((a, b) => scheduleDateValue(a, settings) - scheduleDateValue(b, settings) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return sorted.flatMap((order) => {
    const count = batchesNeeded(order, settings);
    const produceBy = produceByDate(order.dueDate, settings);
    return Array.from({ length: count }, (_, index) => ({
      id: `${order.id}-b${index + 1}`,
      orderId: order.id,
      sequence: index + 1,
      customer: order.customer,
      company: order.company || order.customer,
      location: order.location || "",
      productCode: order.productCode,
      preferredReactor: order.preferredReactor || "",
      size: Number(order.size),
      family: order.family,
      grade: order.grade || "standard",
      color: normalizeColor(order.color || "green"),
      dueDate: order.dueDate,
      produceByDate: produceBy,
      minutes: Number(settings.batchMinutes)
    }));
  });
}

export function scheduleOrders(orders, settings, loadedBatchIds = [], skippedBatchIds = []) {
  const reactors = settings.reactors.filter((reactor) => reactor.enabled && reactor.id !== "R3");
  const reactorStates = Object.fromEntries(reactors.map((reactor) => [reactor.id, {
    reactor,
    windows: generateStaffedWindows(reactor, settings),
    events: [],
    priorBatch: null
  }]));
  if (settings.waterBatch) {
    const waterMin = Number(settings.waterBatchMinutes || 0);
    for (const state of Object.values(reactorStates)) {
      state.events.push({
        id: `water-batch-${state.reactor.id}`,
        type: "water-batch",
        reactorId: state.reactor.id,
        start: 0,
        end: waterMin,
        label: "Water Batch (warm-up)"
      });
    }
  }
  const unscheduled = [];
  const skipped = new Set(skippedBatchIds);
  const batches = orderBatchesForScheduling(buildBatches(orders, settings).filter((batch) => !skipped.has(batch.id)), settings);
  for (const batch of batches) {
    const candidates = reactors
      .filter((reactor) => reactorCanRun(reactor, batch, settings))
      .map((reactor) => placeBatchCandidate(batch, reactorStates[reactor.id], settings))
      .filter(Boolean)
      .sort((a, b) => candidateScore(a, batch, settings) - candidateScore(b, batch, settings)
        || a.batchEvent.end - b.batchEvent.end
        || a.batchEvent.start - b.batchEvent.start);
    if (!candidates.length) {
      unscheduled.push(batch);
      continue;
    }
    commitPlacement(candidates[0], reactorStates[candidates[0].reactorId], loadedBatchIds);
  }
  return summarizeSchedule(reactorStates, unscheduled, settings);
}

export function checkCandidateFit(orders, candidateOrder, settings, loadedBatchIds = [], skippedBatchIds = []) {
  if (isExpanderOrder(candidateOrder, settings)) {
    return {
      status: "expander",
      message: "Expanded (X) product - requires size-22 base on R3 + expander pass. Out of v1 scope.",
      batches: 0,
      fits: false
    };
  }
  const candidate = { ...candidateOrder, id: candidateOrder.id || `candidate-${Date.now()}`, createdAt: new Date().toISOString() };
  const schedule = scheduleOrders([...orders, candidate], settings, loadedBatchIds, skippedBatchIds);
  const candidateEvents = schedule.events.filter((event) => event.orderId === candidate.id && event.type === "batch");
  const completion = candidateEvents.length ? Math.max(...candidateEvents.map((event) => event.end)) : null;
  const produceBy = produceByDate(candidate.dueDate, settings);
  const due = produceBy ? dateToScheduleMinute(settings.weekStart, produceBy, settings) : Number.MAX_SAFE_INTEGER;
  const displaced = schedule.unscheduled.filter((b) => b.orderId !== candidate.id);
  const overcommittedDays = getOvercommittedDays(schedule, settings);
  return {
    status: candidateEvents.length ? "scheduled" : "blocked",
    message: candidateEvents.length ? "" : exclusionMessage(candidate, settings),
    batches: batchesNeeded(candidate, settings),
    minutes: batchesNeeded(candidate, settings) * Number(settings.batchMinutes),
    fits: completion !== null && completion <= due,
    completion,
    deliveryDate: candidate.dueDate || "",
    produceByDate: produceBy || "",
    reactors: [...new Set(candidateEvents.map((event) => event.reactorId))],
    displaced,
    overcommittedDays,
    schedule
  };
}

function getOvercommittedDays(schedule, settings) {
  const days = [];
  for (let day = 0; day < settings.daysPerWeek; day++) {
    const dayStart = day * settings.minutesPerDay;
    const dayEnd = dayStart + settings.minutesPerDay;
    for (const reactor of schedule.reactors) {
      const batchesInDay = reactor.events.filter((e) => e.type === "batch" && e.start >= dayStart && e.start < dayEnd).length;
      const windowMinutes = reactor.windows
        .filter((w) => w.start < dayEnd && w.end > dayStart)
        .reduce((sum, w) => sum + Math.min(w.end, dayEnd) - Math.max(w.start, dayStart), 0);
      const capacity = Math.floor(windowMinutes / settings.batchMinutes);
      if (batchesInDay > capacity) {
        days.push({ day, reactorId: reactor.id, batchesInDay, capacity });
      }
    }
  }
  return days;
}

function orderBatchesForScheduling(batches, settings) {
  if (!settings.autoColorAllocation) return batches;
  return [...batches].sort((a, b) => {
    const dueCompare = dueValue(a) - dueValue(b);
    if (dueCompare !== 0) return dueCompare;
    return colorPriority(a.color) - colorPriority(b.color)
      || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}

function colorPriority(color) {
  const normalized = normalizeColor(color);
  if (normalized === "white") return 0;
  if (normalized === "black") return 1;
  return 2;
}

function candidateScore(candidate, batch, settings) {
  if (batch.preferredReactor && candidate.reactorId === batch.preferredReactor) return -100000;
  if (batch.preferredReactor && candidate.reactorId !== batch.preferredReactor) return 100000;
  if (!settings.autoColorAllocation) return 0;
  const color = normalizeColor(batch.color);
  if (color === "white" && candidate.reactorId === "R2") return -1000;
  if (color === "black" && candidate.reactorId === "R1") return -1000;
  if (color === "black" && candidate.reactorId === "R2") return 1000;
  return 0;
}

export function upsizeCheck(orders, orderId, newBagCount, settings, loadedBatchIds = [], skippedBatchIds = []) {
  const original = orders.find((order) => order.id === orderId);
  if (!original) return null;
  const oldBatches = batchesNeeded(original, settings);
  const candidate = { ...original, quantityBags: Number(newBagCount) };
  const result = checkCandidateFit(orders.filter((order) => order.id !== orderId), candidate, settings, loadedBatchIds, skippedBatchIds);
  return { ...result, oldBatches, incrementalBatches: Math.max(0, batchesNeeded(candidate, settings) - oldBatches) };
}

function placeBatchCandidate(batch, state, settings) {
  let prior = state.priorBatch;
  let searchFrom = lastEventEnd(state.events);
  for (const window of state.windows) {
    let start = Math.max(searchFrom, window.start);
    const penalty = changeoverMinutes(prior, batch, state.reactor, settings);
    const changeStart = start;
    start += penalty;
    const end = start + batch.minutes;
    if (end <= window.end) {
      const events = [];
      if (penalty > 0) {
        events.push({
          id: `${batch.id}-changeover`,
          type: "changeover",
          reactorId: state.reactor.id,
          start: changeStart,
          end: start,
          minutes: penalty,
          label: changeoverLabel(prior, batch, state.reactor)
        });
      }
      events.push({
        ...batch,
        type: "batch",
        reactorId: state.reactor.id,
        start,
        end
      });
      return { reactorId: state.reactor.id, events, batchEvent: events[events.length - 1], batch };
    }
    if (searchFrom < window.end) searchFrom = window.end;
  }
  return null;
}

function commitPlacement(placement, state, loadedBatchIds) {
  for (const event of placement.events) {
    state.events.push(event.type === "batch" ? { ...event, status: loadedBatchIds.includes(event.id) ? "loaded" : "needed" } : event);
  }
  state.priorBatch = placement.batch;
}

function summarizeSchedule(reactorStates, unscheduled, settings) {
  const reactorSummaries = Object.values(reactorStates).map((state) => {
    const availableMinutes = state.windows.reduce((sum, win) => sum + win.end - win.start, 0);
    const scheduledMinutes = state.events.filter((event) => event.type === "batch").reduce((sum, event) => sum + event.end - event.start, 0);
    const changeoverMinutesTotal = state.events.filter((event) => event.type === "changeover").reduce((sum, event) => sum + event.end - event.start, 0);
    const theoreticalBatches = Math.floor(availableMinutes / settings.batchMinutes);
    const packedCapacity = packCapacity(state.windows, settings.batchMinutes);
    return {
      id: state.reactor.id,
      name: state.reactor.name,
      windows: state.windows,
      events: state.events,
      availableMinutes,
      scheduledMinutes,
      changeoverMinutes: changeoverMinutesTotal,
      utilization: availableMinutes ? scheduledMinutes / availableMinutes : 0,
      theoreticalBatches,
      packedCapacity,
      scheduledBatches: state.events.filter((event) => event.type === "batch").length,
      headroomBatches: Math.max(0, packedCapacity - state.events.filter((event) => event.type === "batch").length),
      strandedMinutes: state.windows.reduce((sum, win) => sum + ((win.end - win.start) % settings.batchMinutes), 0)
    };
  });
  return {
    reactors: reactorSummaries,
    events: reactorSummaries.flatMap((reactor) => reactor.events),
    unscheduled,
    totalMinutes: settings.daysPerWeek * settings.minutesPerDay
  };
}

function packCapacity(windows, batchMinutes) {
  return windows.reduce((sum, win) => sum + Math.floor((win.end - win.start) / batchMinutes), 0);
}

function changeoverLabel(previous, next, reactor) {
  const labels = [];
  if ((previous?.grade || "standard") !== (next.grade || "standard")) labels.push("grade clean");
  const a = normalizeColor(previous?.color);
  const b = normalizeColor(next.color);
  if (reactor.id === "R2" && ((a === "black" && b === "white") || (a === "white" && b === "black"))) labels.push("black/white clean");
  return labels.join(" + ") || "changeover";
}

function lastEventEnd(events) {
  return events.length ? events[events.length - 1].end : 0;
}

function dueValue(order) {
  const date = order.produceByDate || order.dueDate;
  return date ? new Date(date).getTime() : Number.MAX_SAFE_INTEGER;
}

function scheduleDateValue(order, settings) {
  const date = produceByDate(order.dueDate, settings) || order.produceByDate || order.dueDate;
  return date ? new Date(date).getTime() : Number.MAX_SAFE_INTEGER;
}

export function parseDayStartMinutes(dayStartTime = "00:00") {
  const parts = String(dayStartTime || "00:00").split(":");
  return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

export function minutesToDate(weekStart, minutes, settings = {}) {
  const offset = parseDayStartMinutes(settings.dayStartTime);
  return new Date(localDateOnly(weekStart).getTime() + (offset + minutes) * 60000);
}

export function dateToScheduleMinute(weekStart, dateValue, settings = {}) {
  const offset = parseDayStartMinutes(settings.dayStartTime);
  return Math.max(0, Math.round((new Date(dateValue).getTime() - localDateOnly(weekStart).getTime()) / 60000 - offset));
}

function isWorkDay(date, settings) {
  const dow = date.getDay();
  const prodDayIndex = (dow + 6) % 7;
  return prodDayIndex < Number(settings.daysPerWeek || 6);
}

export function produceByDate(dueDate, settings = {}) {
  if (!dueDate) return "";
  const date = new Date(dueDate);
  let daysLeft = Number(settings.productionLeadDays ?? 1);
  while (daysLeft > 0) {
    date.setDate(date.getDate() - 1);
    if (isWorkDay(date, settings)) daysLeft--;
  }
  return localDateTimeValue(date);
}

function localDateOnly(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function localDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
