import { dataStore } from "./storage.js";
import {
  batchesNeeded,
  checkCandidateFit,
  defaultExpandedForOrder,
  isExpanderOrder,
  isTruckFillable,
  minutesToDate,
  scheduleOrders,
  upsizeCheck
} from "./scheduler.js";

let state = dataStore.load();

const els = {
  orderForm: document.querySelector("#orderForm"),
  upsizeForm: document.querySelector("#upsizeForm"),
  upsizeOrder: document.querySelector("#upsizeOrder"),
  fitResult: document.querySelector("#fitResult"),
  upsizeResult: document.querySelector("#upsizeResult"),
  readout: document.querySelector("#readout"),
  timeline: document.querySelector("#timeline"),
  ordersTable: document.querySelector("#ordersTable"),
  settingsForm: document.querySelector("#settingsForm"),
  exportBtn: document.querySelector("#exportBtn"),
  importFile: document.querySelector("#importFile")
};

setDefaultDueDate();
syncOrderFormHints();
render();

els.orderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const order = readOrderForm();
  state.orders.push({ ...order, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  saveAndRender();
  els.orderForm.reset();
  setDefaultDueDate();
  syncOrderFormHints();
});

document.querySelector("#checkBtn").addEventListener("click", () => {
  const candidate = readOrderForm();
  const result = checkCandidateFit(state.orders, candidate, state.settings, state.loadedBatchIds);
  showFitResult(result, els.fitResult);
});

els.upsizeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.upsizeForm);
  const result = upsizeCheck(state.orders, form.get("orderId"), Number(form.get("newBags")), state.settings, state.loadedBatchIds);
  if (!result) {
    els.upsizeResult.textContent = "Select an order first.";
    els.upsizeResult.className = "result warn";
    return;
  }
  els.upsizeResult.textContent = `Incremental batches: ${result.incrementalBatches}. ${fitText(result)}`;
  els.upsizeResult.className = `result ${result.fits ? "ok" : "warn"}`;
});

els.exportBtn.addEventListener("click", () => {
  const blob = new Blob([dataStore.export(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reactor-scheduler-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files[0];
  if (!file) return;
  state = dataStore.import(await file.text());
  render();
  els.importFile.value = "";
});

els.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.settings = readSettingsForm();
  saveAndRender();
});

els.orderForm.addEventListener("input", (event) => {
  if (["productCode", "family", "size"].includes(event.target.name)) syncOrderFormHints();
});

els.ordersTable.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, orderId, batchId } = button.dataset;
  if (action === "delete-order") {
    state.orders = state.orders.filter((order) => order.id !== orderId);
    state.loadedBatchIds = state.loadedBatchIds.filter((id) => !id.startsWith(`${orderId}-`));
  }
  if (action === "toggle-loaded") {
    state.loadedBatchIds = state.loadedBatchIds.includes(batchId)
      ? state.loadedBatchIds.filter((id) => id !== batchId)
      : [...state.loadedBatchIds, batchId];
  }
  saveAndRender();
});

function readOrderForm() {
  const form = new FormData(els.orderForm);
  const size = Number(form.get("size"));
  const family = form.get("family");
  const truckFillable = isTruckFillable(state.settings, size, family);
  const trucks = truckFillable ? Number(form.get("trucks") || 0) : 0;
  const bags = trucks > 0 ? trucks * Number(state.settings.truckBags) : Number(form.get("quantityBags"));
  return {
    customer: form.get("customer") || "Candidate",
    productCode: form.get("productCode") || "",
    family,
    size,
    quantityBags: bags,
    grade: form.get("grade"),
    color: form.get("color"),
    preferredReactor: form.get("preferredReactor"),
    expanded: form.get("expanded") === "on",
    dueDate: form.get("dueDate")
  };
}

function render() {
  const schedule = scheduleOrders(state.orders, state.settings, state.loadedBatchIds);
  renderReadout(schedule);
  renderTimeline(schedule);
  renderOrders(schedule);
  renderSettings();
  renderUpsizeOptions();
}

function renderReadout(schedule) {
  els.readout.innerHTML = schedule.reactors.map((reactor) => `
    <div class="metric">
      <strong>${reactor.scheduledBatches}/${reactor.packedCapacity}</strong>
      <span>${reactor.name} batches, ${pct(reactor.utilization)} util, ${Math.round(reactor.strandedMinutes)} stranded min</span>
    </div>
  `).join("") + `
    <div class="metric">
      <strong>${schedule.unscheduled.length}</strong>
      <span>unscheduled batches</span>
    </div>
  `;
}

function renderTimeline(schedule) {
  const total = schedule.totalMinutes;
  els.timeline.innerHTML = `
    <div class="axis"><div></div><div class="axis-line">${Array.from({ length: state.settings.daysPerWeek }, (_, i) => `<span>Day ${i + 1}</span>`).join("")}</div></div>
    ${schedule.reactors.map((reactor) => `
      <div class="reactor-row">
        <div class="reactor-name">${reactor.name}</div>
        <div class="track">
          ${reactor.windows.map((win) => `<div class="window" style="left:${pos(win.start, total)}%;width:${width(win.start, win.end, total)}%"></div>`).join("")}
          ${reactor.events.map((event) => eventHtml(event, total)).join("")}
        </div>
      </div>
    `).join("")}
  `;
}

function eventHtml(event, total) {
  const colorClass = event.type === "changeover" ? "changeover" : event.status === "loaded" ? "loaded" : event.color === "white" ? "white" : "needed";
  const label = event.type === "changeover"
    ? event.label
    : `${event.customer || ""} ${event.size} ${event.color} b${event.sequence}`;
  return `<div class="event ${colorClass}" title="${escapeHtml(label)} ${formatRange(event)}" style="left:${pos(event.start, total)}%;width:${Math.max(0.7, width(event.start, event.end, total))}%">${escapeHtml(label)}</div>`;
}

function renderOrders(schedule) {
  const byOrder = new Map(schedule.events.filter((event) => event.type === "batch").map((event) => [event.orderId, []]));
  schedule.events.filter((event) => event.type === "batch").forEach((event) => byOrder.get(event.orderId).push(event));
  els.ordersTable.innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Spec</th><th>Bags</th><th>Batches</th><th>Completion</th><th>Loaded</th><th></th></tr></thead>
      <tbody>
        ${state.orders.map((order) => {
          const events = byOrder.get(order.id) || [];
          const expander = isExpanderOrder(order, state.settings);
          const completion = events.length ? fmt(minutesToDate(state.settings.weekStart, Math.max(...events.map((event) => event.end)))) : expander ? "expanded route" : "not scheduled";
          return `<tr>
            <td>${escapeHtml(order.customer)}<br><span class="note">${escapeHtml(order.productCode || "")}</span></td>
            <td>${order.family} ${order.size}${order.expanded ? "X" : ""} ${order.grade} ${order.color}${order.preferredReactor ? ` -> ${order.preferredReactor}` : ""}</td>
            <td>${order.quantityBags}</td>
            <td>${batchesNeeded(order, state.settings)}</td>
            <td>${completion}</td>
            <td>${events.map((event) => `<button class="secondary" data-action="toggle-loaded" data-batch-id="${event.id}" type="button">${event.status === "loaded" ? "Loaded" : `B${event.sequence}`}</button>`).join(" ")}</td>
            <td><button class="danger" data-action="delete-order" data-order-id="${order.id}" type="button">Delete</button></td>
          </tr>`;
        }).join("") || `<tr><td colspan="7">No committed orders yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderUpsizeOptions() {
  els.upsizeOrder.innerHTML = state.orders.map((order) => `<option value="${order.id}">${escapeHtml(order.customer)} - ${order.size} ${order.color}</option>`).join("");
}

function renderSettings() {
  const s = state.settings;
  els.settingsForm.innerHTML = `
    <div class="settings-row">
      <label>Week Start<input name="weekStart" type="date" value="${s.weekStart}"></label>
      <label>Batch Minutes<input name="batchMinutes" type="number" value="${s.batchMinutes}"></label>
      <label>Days / Week<input name="daysPerWeek" type="number" value="${s.daysPerWeek}"></label>
      <label>Shift Length<input name="shiftLength" type="number" value="${s.shiftLength}"></label>
      <label>Minutes / Day<input name="minutesPerDay" type="number" value="${s.minutesPerDay}"></label>
      <label>Truck Bags<input name="truckBags" type="number" value="${s.truckBags}"></label>
      <label>Expander >= Size<input name="expanderThreshold" type="number" value="${s.expanderThreshold}"></label>
      <label>Combine Same Spec<select name="combineSameSpec"><option value="false" ${!s.combineSameSpec ? "selected" : ""}>false</option><option value="true" ${s.combineSameSpec ? "selected" : ""}>true</option></select></label>
      <label>Auto Color Allocation<select name="autoColorAllocation"><option value="true" ${s.autoColorAllocation ? "selected" : ""}>true</option><option value="false" ${!s.autoColorAllocation ? "selected" : ""}>false</option></select></label>
      <label>ESD Clean Min<input name="esdMinutes" type="number" value="${s.changeovers.esdMinutes}"></label>
      <label>Black/White Min<input name="blackWhiteMinutes" type="number" value="${s.changeovers.blackWhiteMinutes}"></label>
    </div>
    <div class="settings-block">
      <h2>Reactors</h2>
      ${s.reactors.map((reactor, index) => `
        <div class="settings-row">
          <label>Name<input name="reactor-${index}-name" value="${escapeAttr(reactor.name)}"></label>
          <label>Enabled<select name="reactor-${index}-enabled"><option value="true" ${reactor.enabled ? "selected" : ""}>true</option><option value="false" ${!reactor.enabled ? "selected" : ""}>false</option></select></label>
          <label>Staffed Shifts<input name="reactor-${index}-shifts" value="${reactor.staffedShifts.join(",")}"></label>
          <label>Colors<input name="reactor-${index}-colors" value="${reactor.colors.join(",")}"></label>
          <label>Grades<input name="reactor-${index}-grades" value="${reactor.grades.join(",")}"></label>
          <label>Sizes<input name="reactor-${index}-sizes" value="${reactor.sizes.join(",")}"></label>
        </div>
      `).join("")}
    </div>
    <div class="settings-block">
      <h2>Yield Table</h2>
      <div class="note">Edit JSON directly for add/remove. Store bagsPerBatch for every size. For truckFillable rows, batchesPerTruck can derive/update bagsPerBatch; bag-only HBR rows use bagsPerBatch directly. Expanded rows use expanded: true and expanderBaseSize: 22.</div>
      <textarea name="sizesJson" rows="9">${escapeHtml(JSON.stringify(s.sizes, null, 2))}</textarea>
    </div>
    <button type="submit">Save Settings</button>
  `;
}

function readSettingsForm() {
  const form = new FormData(els.settingsForm);
  const reactors = state.settings.reactors.map((reactor, index) => ({
    ...reactor,
    name: form.get(`reactor-${index}-name`),
    enabled: form.get(`reactor-${index}-enabled`) === "true",
    staffedShifts: csv(form.get(`reactor-${index}-shifts`)).map(Number),
    colors: csv(form.get(`reactor-${index}-colors`)),
    grades: csv(form.get(`reactor-${index}-grades`)),
    sizes: csv(form.get(`reactor-${index}-sizes`)).map((value) => value === "*" ? value : Number(value))
  }));
  return {
    ...state.settings,
    weekStart: form.get("weekStart"),
    batchMinutes: Number(form.get("batchMinutes")),
    daysPerWeek: Number(form.get("daysPerWeek")),
    minutesPerDay: Number(form.get("minutesPerDay")),
    shiftLength: Number(form.get("shiftLength")),
    truckBags: Number(form.get("truckBags")),
    expanderThreshold: Number(form.get("expanderThreshold")),
    combineSameSpec: form.get("combineSameSpec") === "true",
    autoColorAllocation: form.get("autoColorAllocation") === "true",
    changeovers: {
      esdMinutes: Number(form.get("esdMinutes")),
      blackWhiteMinutes: Number(form.get("blackWhiteMinutes"))
    },
    reactors,
    sizes: normalizeSizeRows(JSON.parse(form.get("sizesJson")), Number(form.get("truckBags")))
  };
}

function showFitResult(result, el) {
  if (result.status === "expander") {
    el.textContent = result.message;
    el.className = "result warn";
    return;
  }
  el.textContent = fitText(result);
  el.className = `result ${result.fits ? "ok" : "warn"}`;
}

function fitText(result) {
  const completion = result.completion === null ? "not scheduled" : fmt(minutesToDate(state.settings.weekStart, result.completion));
  const reactors = result.reactors?.length ? result.reactors.join(", ") : "none";
  return `${result.fits ? "Fits" : "Does not fit"}: ${result.batches} batches, completion ${completion}, reactor(s) ${reactors}.`;
}

function readNumber(name) {
  return Number(document.querySelector(`[name="${name}"]`)?.value || 0);
}

function pos(minutes, total) {
  return (minutes / total) * 100;
}

function width(start, end, total) {
  return ((end - start) / total) * 100;
}

function pct(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function fmt(date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatRange(event) {
  return `${fmt(minutesToDate(state.settings.weekStart, event.start))} - ${fmt(minutesToDate(state.settings.weekStart, event.end))}`;
}

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function saveAndRender() {
  state = dataStore.save(state);
  render();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function setDefaultDueDate() {
  const input = els.orderForm.querySelector('[name="dueDate"]');
  const due = new Date();
  due.setDate(due.getDate() + 2);
  due.setHours(16, 0, 0, 0);
  input.value = due.toISOString().slice(0, 16);
}

function syncOrderFormHints() {
  const form = new FormData(els.orderForm);
  const order = {
    productCode: form.get("productCode") || "",
    family: form.get("family"),
    size: Number(form.get("size")),
    expanded: undefined
  };
  const expandedInput = els.orderForm.querySelector('[name="expanded"]');
  const truckInput = els.orderForm.querySelector('[name="trucks"]');
  const trucksField = document.querySelector("#trucksField");
  expandedInput.checked = defaultExpandedForOrder(order, state.settings);
  const truckFillable = isTruckFillable(state.settings, order.size, order.family);
  trucksField.classList.toggle("hidden", !truckFillable);
  truckInput.disabled = !truckFillable;
  if (!truckFillable) truckInput.value = "";
}

function normalizeSizeRows(rows, truckBags) {
  return rows.map((row) => {
    const truckFillable = row.truckFillable !== false;
    const batchesPerTruck = Number(row.batchesPerTruck) || null;
    const bagsPerBatch = Number(row.bagsPerBatch) || (truckFillable && batchesPerTruck ? truckBags / batchesPerTruck : null);
    return {
      ...row,
      truckFillable,
      batchesPerTruck: truckFillable ? batchesPerTruck : null,
      bagsPerBatch,
      expanded: Boolean(row.expanded),
      expanderBaseSize: Number(row.expanderBaseSize || 22)
    };
  });
}
