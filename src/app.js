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
import {
  checkExpanderFit,
  expanderBatchesNeeded,
  minutesToDate as expanderMinutesToDate,
  scheduleExpanderOrders,
  upsizeExpanderCheck
} from "./expanderScheduler.js";

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
  expanderOrderForm: document.querySelector("#expanderOrderForm"),
  expanderUpsizeForm: document.querySelector("#expanderUpsizeForm"),
  expanderUpsizeOrder: document.querySelector("#expanderUpsizeOrder"),
  expanderFitResult: document.querySelector("#expanderFitResult"),
  expanderUpsizeResult: document.querySelector("#expanderUpsizeResult"),
  expanderReadout: document.querySelector("#expanderReadout"),
  expanderTimeline: document.querySelector("#expanderTimeline"),
  expanderOrdersTable: document.querySelector("#expanderOrdersTable"),
  expanderSettingsForm: document.querySelector("#expanderSettingsForm"),
  guideContent: document.querySelector("#guideContent"),
  exportBtn: document.querySelector("#exportBtn"),
  importFile: document.querySelector("#importFile")
};

setDefaultDueDate();
setDefaultExpanderDueDate();
syncOrderFormHints();
render();

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn === button));
    document.querySelectorAll(".app-view").forEach((view) => view.classList.toggle("active-view", view.id === button.dataset.view));
  });
});

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

els.expanderOrderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const order = readExpanderOrderForm();
  state.expanderOrders.push({ ...order, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  saveAndRender();
  els.expanderOrderForm.reset();
  setDefaultExpanderDueDate();
});

document.querySelector("#expanderCheckBtn").addEventListener("click", () => {
  const result = checkExpanderFit(state.expanderOrders, readExpanderOrderForm(), state.expanderSettings, state.loadedExpanderBatchIds);
  showExpanderFitResult(result, els.expanderFitResult);
});

els.expanderUpsizeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.expanderUpsizeForm);
  const result = upsizeExpanderCheck(state.expanderOrders, form.get("orderId"), Number(form.get("newQuantity")), state.expanderSettings, state.loadedExpanderBatchIds);
  if (!result) {
    els.expanderUpsizeResult.textContent = "Select an order first.";
    els.expanderUpsizeResult.className = "result warn";
    return;
  }
  els.expanderUpsizeResult.textContent = `Incremental batches: ${result.incrementalBatches}. ${expanderFitText(result)}`;
  els.expanderUpsizeResult.className = `result ${result.fits ? "ok" : "warn"}`;
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

els.expanderSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.expanderSettings = readExpanderSettingsForm();
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

els.expanderOrdersTable.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, orderId, batchId } = button.dataset;
  if (action === "delete-expander-order") {
    state.expanderOrders = state.expanderOrders.filter((order) => order.id !== orderId);
    state.loadedExpanderBatchIds = state.loadedExpanderBatchIds.filter((id) => !id.startsWith(`${orderId}-`));
  }
  if (action === "toggle-expander-loaded") {
    state.loadedExpanderBatchIds = state.loadedExpanderBatchIds.includes(batchId)
      ? state.loadedExpanderBatchIds.filter((id) => id !== batchId)
      : [...state.loadedExpanderBatchIds, batchId];
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

function readExpanderOrderForm() {
  const form = new FormData(els.expanderOrderForm);
  const orderType = form.get("orderType");
  const quantity = Number(form.get("quantity"));
  return {
    customer: form.get("customer") || "Candidate",
    productCode: form.get("productCode") || "",
    size: form.get("size"),
    color: form.get("color"),
    grade: form.get("grade") || "standard",
    orderType,
    quantity,
    quantityBags: orderType === "bag" ? quantity : quantity * Number(state.expanderSettings.truckBags),
    preferredExpander: form.get("preferredExpander"),
    dueDate: form.get("dueDate")
  };
}

function render() {
  const schedule = scheduleOrders(state.orders, state.settings, state.loadedBatchIds);
  const expanderSchedule = scheduleExpanderOrders(state.expanderOrders, state.expanderSettings, state.loadedExpanderBatchIds);
  renderReadout(schedule);
  renderTimeline(schedule);
  renderOrders(schedule);
  renderSettings();
  renderUpsizeOptions();
  renderExpanderReadout(expanderSchedule);
  renderExpanderTimeline(expanderSchedule);
  renderExpanderOrders(expanderSchedule);
  renderExpanderSettings();
  renderExpanderUpsizeOptions();
  renderGuide();
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

function renderExpanderReadout(schedule) {
  const warning = schedule.whiteWarning ? `<div class="metric"><strong>Warning</strong><span>White is approaching the limit of one expander - black output on E2 is being squeezed.</span></div>` : "";
  els.expanderReadout.innerHTML = schedule.expanders.map((expander) => `
    <div class="metric">
      <strong>${pct(expander.utilization)}</strong>
      <span>${expander.name}: ${Math.round(expander.blackMinutes)} black min, ${Math.round(expander.whiteMinutes)} white min, ${Math.round(expander.flipMinutes)} flip min, ${Math.round(expander.headroomMinutes)} headroom</span>
    </div>
  `).join("") + `
    <div class="metric">
      <strong>${Math.round(schedule.totalAvailableMinutes)}</strong>
      <span>total expander-min/week before changeovers</span>
    </div>
    <div class="metric">
      <strong>${Math.round(schedule.r3FeedBatches * 10) / 10}</strong>
      <span>R3 batches/week advisory to keep silos fed</span>
    </div>
    <div class="metric">
      <strong>${schedule.expanders.find((expander) => expander.id === "E2")?.whiteRunCount || 0}</strong>
      <span>E2 white run count; ${Math.round(schedule.expanders.find((expander) => expander.id === "E2")?.flipMinutes || 0)} min lost to flips</span>
    </div>
    ${warning}
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

function renderExpanderTimeline(schedule) {
  const total = schedule.totalMinutes;
  els.expanderTimeline.innerHTML = `
    <div class="axis"><div></div><div class="axis-line">${Array.from({ length: state.expanderSettings.daysPerWeek }, (_, i) => `<span>Day ${i + 1}</span>`).join("")}</div></div>
    ${schedule.expanders.map((expander) => `
      <div class="reactor-row">
        <div class="reactor-name">${expander.id}</div>
        <div class="track">
          ${expander.windows.map((win) => `<div class="window" style="left:${pos(win.start, total)}%;width:${width(win.start, win.end, total)}%"></div>`).join("")}
          ${expander.events.map((event) => expanderEventHtml(event, total)).join("")}
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

function expanderEventHtml(event, total) {
  const colorClass = event.type === "color-flip" ? "color-flip" : event.status === "loaded" ? "loaded" : event.color === "white" ? "white" : "needed";
  const label = event.type === "color-flip" ? event.label : `${event.customer || ""} ${event.size} ${event.color} b${event.sequence}`;
  return `<div class="event ${colorClass}" title="${escapeHtml(label)} ${formatExpanderRange(event)}" style="left:${pos(event.start, total)}%;width:${Math.max(0.7, width(event.start, event.end, total))}%">${escapeHtml(label)}</div>`;
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

function renderExpanderOrders(schedule) {
  const byOrder = new Map(schedule.events.filter((event) => event.type === "batch").map((event) => [event.orderId, []]));
  schedule.events.filter((event) => event.type === "batch").forEach((event) => byOrder.get(event.orderId).push(event));
  els.expanderOrdersTable.innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Spec</th><th>Qty</th><th>Batches</th><th>Completion</th><th>Loaded</th><th></th></tr></thead>
      <tbody>
        ${state.expanderOrders.map((order) => {
          const events = byOrder.get(order.id) || [];
          const completion = events.length ? fmt(expanderMinutesToDate(state.expanderSettings.weekStart, Math.max(...events.map((event) => event.end)))) : "not scheduled";
          return `<tr>
            <td>${escapeHtml(order.customer)}<br><span class="note">${escapeHtml(order.productCode || "")}</span></td>
            <td>${order.size} ${order.grade} ${order.color}${order.preferredExpander ? ` -> ${order.preferredExpander}` : ""}</td>
            <td>${order.quantity} ${order.orderType === "bulk" ? "truck(s)" : "bags"}</td>
            <td>${expanderBatchesNeeded(order, state.expanderSettings)}</td>
            <td>${completion}</td>
            <td>${events.map((event) => `<button class="secondary" data-action="toggle-expander-loaded" data-batch-id="${event.id}" type="button">${event.status === "loaded" ? "Loaded" : `B${event.sequence}`}</button>`).join(" ")}</td>
            <td><button class="danger" data-action="delete-expander-order" data-order-id="${order.id}" type="button">Delete</button></td>
          </tr>`;
        }).join("") || `<tr><td colspan="7">No committed expander orders yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderUpsizeOptions() {
  els.upsizeOrder.innerHTML = state.orders.map((order) => `<option value="${order.id}">${escapeHtml(order.customer)} - ${order.size} ${order.color}</option>`).join("");
}

function renderExpanderUpsizeOptions() {
  els.expanderUpsizeOrder.innerHTML = state.expanderOrders.map((order) => `<option value="${order.id}">${escapeHtml(order.customer)} - ${order.size} ${order.color}</option>`).join("");
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
      <h2>Reactor Exclusions</h2>
      <div class="note">Blank fields are wildcards. Each rule means the matching customer/product/spec may not run on the listed reactor.</div>
      <textarea name="exclusionsJson" rows="7">${escapeHtml(JSON.stringify(s.reactorExclusions || [], null, 2))}</textarea>
    </div>
    <div class="settings-block">
      <h2>Yield Table</h2>
      <div class="note">Edit JSON directly for add/remove. Store bagsPerBatch for every size. For truckFillable rows, batchesPerTruck can derive/update bagsPerBatch; bag-only HBR rows use bagsPerBatch directly. Expanded rows use expanded: true and expanderBaseSize: 22.</div>
      <textarea name="sizesJson" rows="9">${escapeHtml(JSON.stringify(s.sizes, null, 2))}</textarea>
    </div>
    <button type="submit">Save Settings</button>
  `;
}

function renderExpanderSettings() {
  const s = state.expanderSettings;
  els.expanderSettingsForm.innerHTML = `
    <div class="settings-row">
      <label>Week Start<input name="weekStart" type="date" value="${s.weekStart}"></label>
      <label>Days / Week<input name="daysPerWeek" type="number" value="${s.daysPerWeek}"></label>
      <label>Minutes / Day<input name="minutesPerDay" type="number" value="${s.minutesPerDay}"></label>
      <label>Shift Length<input name="shiftLength" type="number" value="${s.shiftLength}"></label>
      <label>Truck Bags<input name="truckBags" type="number" value="${s.truckBags}"></label>
      <label>Efficiency %<input name="efficiency" type="number" value="${s.efficiency.globalPercent}"></label>
      <label>Color Flip Min<input name="colorFlipMinutes" type="number" value="${s.colorFlipMinutes}"></label>
      <label>Size Changeover Min<input name="sizeChangeoverMinutes" type="number" value="${s.sizeChangeoverMinutes}"></label>
      <label>White Threshold %<input name="whiteCapacityThreshold" type="number" value="${s.whiteCapacityThreshold}"></label>
      <label>R3 Feed Ratio<input name="r3FeedRatio" type="number" step="0.1" value="${s.r3FeedRatio}"></label>
      <label>Base Input Kg<input name="baseInputKg" type="number" value="${s.baseInputKg}"></label>
    </div>
    <div class="settings-block">
      <h2>Expanders</h2>
      ${s.expanders.map((expander, index) => `
        <div class="settings-row">
          <label>Name<input name="expander-${index}-name" value="${escapeAttr(expander.name)}"></label>
          <label>Enabled<select name="expander-${index}-enabled"><option value="true" ${expander.enabled ? "selected" : ""}>true</option><option value="false" ${!expander.enabled ? "selected" : ""}>false</option></select></label>
          <label>Staffed Shifts<input name="expander-${index}-shifts" value="${expander.staffedShifts.join(",")}"></label>
          <label>Colors<input name="expander-${index}-colors" value="${expander.colors.join(",")}"></label>
        </div>
      `).join("")}
    </div>
    <div class="settings-block">
      <h2>Expander Exclusions</h2>
      <textarea name="exclusionsJson" rows="6">${escapeHtml(JSON.stringify(s.exclusions || [], null, 2))}</textarea>
    </div>
    <div class="settings-block">
      <h2>Expander Size Table</h2>
      <div class="note">Batch time is per output size. bagsPerBatch derives from truck bags / batchesPerTruck when needed. Base input kg is informational.</div>
      <textarea name="sizesJson" rows="9">${escapeHtml(JSON.stringify(s.sizes, null, 2))}</textarea>
    </div>
    <button type="submit">Save Expander Settings</button>
  `;
}

function renderGuide() {
  const reactor = state.settings;
  const expander = state.expanderSettings;
  const hbrBagOnly = reactor.sizes
    .filter((row) => row.truckFillable === false || row.truck_fillable === false)
    .map((row) => `${row.family} ${row.size}`)
    .join(", ") || "none configured";
  const expanderBatchRows = expander.sizes
    .map((row) => `<tr><td>${escapeHtml(row.size)}</td><td>${Math.round(Number(row.batchMinutes) * 10) / 10} min</td><td>${Number(row.batchesPerTruck || row.batches_per_truck || 0) || "-"}</td><td>${round(Number(row.bagsPerBatch || row.bags_per_batch || 0)) || "-"}</td></tr>`)
    .join("");
  const reactorExclusions = (reactor.reactorExclusions || [])
    .map((rule) => `${rule.customer || "any customer"} ${rule.size ? `size ${rule.size}` : "any size"} barred from ${rule.reactor}`)
    .join("; ") || "none configured";
  const expanderExclusions = (expander.exclusions || [])
    .map((rule) => `${rule.size || "any size"} barred from ${rule.expander}`)
    .join("; ") || "none configured";

  els.guideContent.innerHTML = `
    <details open>
      <summary>1. What This App Does</summary>
      <p>This app has two independent schedulers. The Reactor Scheduler plans R1 and R2, which make finished bead under size 30. The Expander Scheduler plans Expander 1 and Expander 2, which make X sizes from size-22 base. They run separately and do not wait on each other.</p>
      <p>Use it to answer three questions: does a new order fit, when will it finish, and how full is each machine this week.</p>
      <p>The schedule is a plan with buffer, not a guarantee. It stays useful only when Settings match the plant and the expander efficiency factor is tuned against real output. Current expander efficiency is <strong>${round(expander.efficiency.globalPercent)}%</strong>.</p>
    </details>

    <details>
      <summary>2. Entering An Order</summary>
      <p>Enter the customer, product code, size, color, quantity, order type, and due date. Use the preferred machine field only when you want to force a fit check or manual assignment.</p>
      <ul>
        <li><strong>Customer:</strong> used for labels and routing rules like Cambro size-20.</li>
        <li><strong>Product code:</strong> use X codes like 38X for expanded product.</li>
        <li><strong>Size:</strong> reactor sizes are direct bead sizes; expander sizes are X outputs.</li>
        <li><strong>Color:</strong> white or black. White is capacity-sensitive.</li>
        <li><strong>Quantity:</strong> one truck is currently <strong>${reactor.truckBags}</strong> bags on the reactor side and <strong>${expander.truckBags}</strong> bags on the expander side.</li>
        <li><strong>Order type:</strong> bag means loose bag count. Bulk / FTL means full truck with liner, bead blown in.</li>
        <li><strong>Due date:</strong> the fit checker compares projected completion against this date.</li>
      </ul>
      <p>Small HBR sizes are bag-only because they are too dense to fill a ${reactor.truckBags}-bag truck before hitting weight. Current bag-only size rows: <strong>${escapeHtml(hbrBagOnly)}</strong>. The app converts every order into batches using the yield table.</p>
    </details>

    <details>
      <summary>3. Reading The Schedule</summary>
      <p>Each machine has a weekly timeline. Green means needs to be made, yellow means white bead, and blue means loaded or complete.</p>
      <p>Gaps can be idle time, changeovers, color flips, or unstaffed time. R2 has a dark 2nd shift based on current staffing. Expander color-flip gaps show the time lost switching E2 into and out of white.</p>
      <p>Use the batch buttons in the backlog to mark loaded batches complete. Completed batches turn blue.</p>
    </details>

    <details>
      <summary>4. The "Will It Fit?" Checker</summary>
      <p>Fill out an order form and click Will It Fit before committing it. The result tells you whether it fits, the projected completion date, and which reactor or expander would run it.</p>
      <p>Use Upsize Check to test a larger bag or truck count for an existing order. It shows the incremental batches and whether the larger order still fits.</p>
    </details>

    <details open>
      <summary>5. Best Practices & Plant-Specific Notes</summary>
      <ul>
        <li><strong>Consolidate white runs.</strong> White only runs on Expander 2, and reactor white is handled by R2. Every expander white run costs a flip in and back out: <strong>${expander.colorFlipMinutes * 2}</strong> minutes, about <strong>${round((expander.colorFlipMinutes * 2) / 60)}</strong> hours. Batch all white orders into as few runs as possible.</li>
        <li><strong>Keep the efficiency factor honest.</strong> Start at 100%, then compare planned vs actual completions. If output runs slower, lower the factor, for example to 85%. Current setting: <strong>${round(expander.efficiency.globalPercent)}%</strong>.</li>
        <li><strong>Maintain the yield table.</strong> Bags per batch and batch times drive every estimate. Wrong yields mean wrong schedules.</li>
        <li><strong>Watch the white-capacity warning.</strong> Current warning threshold is <strong>${expander.whiteCapacityThreshold}%</strong> of E2 weekly capacity. When it fires, white is crowding out black output on E2.</li>
        <li><strong>Know the routing constraints.</strong> Reactor exclusions: ${escapeHtml(reactorExclusions)}. Expander exclusions: ${escapeHtml(expanderExclusions)}.</li>
        <li><strong>Expander feedstock:</strong> the expander pulls size-22 base from R3 silos. The advisory uses <strong>1 R3 batch per ${round(expander.r3FeedRatio)} expander batches</strong>. It does not track silo inventory.</li>
        <li><strong>Expanded X orders are not reactor orders.</strong> Anything marked expanded/X is flagged for the expander route and excluded from R1/R2 scheduling.</li>
      </ul>
    </details>

    <details>
      <summary>6. Maintaining Settings</summary>
      <p>Keep these settings current:</p>
      <ul>
        <li><strong>Machine staffing and shifts:</strong> controls when batches can be placed.</li>
        <li><strong>Days/week and minutes/day:</strong> controls weekly capacity. Current week: reactors ${reactor.daysPerWeek} days, expanders ${expander.daysPerWeek} days.</li>
        <li><strong>Batch times:</strong> reactor batch time is <strong>${reactor.batchMinutes}</strong> minutes. Expander batch times are size-specific.</li>
        <li><strong>Yield tables:</strong> reactor bags per batch and expander bags per batch convert orders into batches.</li>
        <li><strong>Truck bag count:</strong> reactor ${reactor.truckBags}; expander ${expander.truckBags}.</li>
        <li><strong>Efficiency %:</strong> current expander planning factor is ${round(expander.efficiency.globalPercent)}%.</li>
        <li><strong>Changeover penalties:</strong> reactor ESD clean ${reactor.changeovers.esdMinutes} min; reactor black/white ${reactor.changeovers.blackWhiteMinutes} min; expander color flip ${expander.colorFlipMinutes} min each way; expander size changeover ${expander.sizeChangeoverMinutes} min.</li>
        <li><strong>White-capacity threshold:</strong> ${expander.whiteCapacityThreshold}%.</li>
        <li><strong>Exclusion rules:</strong> routing rules for quality or machine limitations.</li>
        <li><strong>R3 feed ratio:</strong> ${round(expander.r3FeedRatio)} expander batches per R3 batch.</li>
      </ul>
      <p>JSON export is the backup. Export regularly because data is stored in this browser.</p>
      <table class="guide-table">
        <thead><tr><th>Expander Size</th><th>Batch Time</th><th>Batches / FTL</th><th>Bags / Batch</th></tr></thead>
        <tbody>${expanderBatchRows}</tbody>
      </table>
    </details>

    <details>
      <summary>7. Limitations</summary>
      <p>This is a planning aid, not a control system. It assumes machines run as configured and Settings are accurate.</p>
      <p>It does not track silo inventory, import orders automatically, or coordinate multiple users. It is designed for one user in one browser with JSON export as backup.</p>
    </details>
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
    reactorExclusions: normalizeExclusionRows(JSON.parse(form.get("exclusionsJson") || "[]")),
    sizes: normalizeSizeRows(JSON.parse(form.get("sizesJson")), Number(form.get("truckBags")))
  };
}

function readExpanderSettingsForm() {
  const form = new FormData(els.expanderSettingsForm);
  const truckBags = Number(form.get("truckBags"));
  const expanders = state.expanderSettings.expanders.map((expander, index) => ({
    ...expander,
    name: form.get(`expander-${index}-name`),
    enabled: form.get(`expander-${index}-enabled`) === "true",
    staffedShifts: csv(form.get(`expander-${index}-shifts`)).map(Number),
    colors: csv(form.get(`expander-${index}-colors`)).map((color) => color.toLowerCase())
  }));
  return {
    ...state.expanderSettings,
    weekStart: form.get("weekStart"),
    daysPerWeek: Number(form.get("daysPerWeek")),
    minutesPerDay: Number(form.get("minutesPerDay")),
    shiftLength: Number(form.get("shiftLength")),
    truckBags,
    efficiency: { ...state.expanderSettings.efficiency, globalPercent: Number(form.get("efficiency")) },
    colorFlipMinutes: Number(form.get("colorFlipMinutes")),
    sizeChangeoverMinutes: Number(form.get("sizeChangeoverMinutes")),
    whiteCapacityThreshold: Number(form.get("whiteCapacityThreshold")),
    r3FeedRatio: Number(form.get("r3FeedRatio")),
    baseInputKg: Number(form.get("baseInputKg")),
    expanders,
    exclusions: normalizeExpanderExclusionRows(JSON.parse(form.get("exclusionsJson") || "[]")),
    sizes: normalizeExpanderSizeRows(JSON.parse(form.get("sizesJson") || "[]"), truckBags)
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
  if (result.message) return `${result.fits ? "Fits" : "Does not fit"}: ${result.message}`;
  const completion = result.completion === null ? "not scheduled" : fmt(minutesToDate(state.settings.weekStart, result.completion));
  const reactors = result.reactors?.length ? result.reactors.join(", ") : "none";
  return `${result.fits ? "Fits" : "Does not fit"}: ${result.batches} batches, completion ${completion}, reactor(s) ${reactors}.`;
}

function showExpanderFitResult(result, el) {
  el.textContent = expanderFitText(result);
  el.className = `result ${result.fits ? "ok" : "warn"}`;
}

function expanderFitText(result) {
  if (result.message) return `${result.fits ? "Fits" : "Does not fit"}: ${result.message}`;
  const completion = result.completion === null ? "not scheduled" : fmt(expanderMinutesToDate(state.expanderSettings.weekStart, result.completion));
  const expanders = result.expanders?.length ? result.expanders.join(", ") : "none";
  return `${result.fits ? "Fits" : "Does not fit"}: ${result.batches} batches, completion ${completion}, expander(s) ${expanders}.`;
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

function formatExpanderRange(event) {
  return `${fmt(expanderMinutesToDate(state.expanderSettings.weekStart, event.start))} - ${fmt(expanderMinutesToDate(state.expanderSettings.weekStart, event.end))}`;
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

function setDefaultExpanderDueDate() {
  const input = els.expanderOrderForm.querySelector('[name="dueDate"]');
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
    const truckFillable = (row.truckFillable ?? row.truck_fillable) !== false;
    const batchesPerTruck = Number(row.batchesPerTruck ?? row.batches_per_truck) || null;
    const bagsPerBatch = Number(row.bagsPerBatch ?? row.bags_per_batch) || (truckFillable && batchesPerTruck ? truckBags / batchesPerTruck : null);
    return {
      ...row,
      truckFillable,
      truck_fillable: truckFillable,
      batchesPerTruck: truckFillable ? batchesPerTruck : null,
      batches_per_truck: truckFillable ? batchesPerTruck : null,
      bagsPerBatch,
      bags_per_batch: bagsPerBatch,
      expanded: Boolean(row.expanded),
      expanderBaseSize: Number(row.expanderBaseSize || 22)
    };
  });
}

function normalizeExclusionRows(rows) {
  return rows.map((row) => ({
    customer: row.customer || "",
    productCode: row.productCode || row.product || "",
    size: row.size === "" || row.size === undefined || row.size === null ? "" : Number(row.size),
    family: row.family || "",
    grade: row.grade || "",
    color: row.color || "",
    reactor: row.reactor || "",
    note: row.note || ""
  })).filter((row) => row.reactor);
}

function normalizeExpanderSizeRows(rows, truckBags) {
  return rows.map((row) => {
    const batchesPerTruck = Number(row.batchesPerTruck ?? row.batches_per_truck) || null;
    const bagsPerBatch = Number(row.bagsPerBatch ?? row.bags_per_batch) || (batchesPerTruck ? truckBags / batchesPerTruck : null);
    return {
      ...row,
      size: String(row.size).toUpperCase(),
      batchMinutes: Number(row.batchMinutes ?? row.batch_minutes ?? 0),
      batchesPerTruck,
      batches_per_truck: batchesPerTruck,
      bagsPerBatch,
      bags_per_batch: bagsPerBatch,
      baseInputKg: Number(row.baseInputKg ?? row.base_input_kg ?? 550)
    };
  });
}

function normalizeExpanderExclusionRows(rows) {
  return rows.map((row) => ({
    customer: row.customer || "",
    productCode: row.productCode || row.product || "",
    size: row.size ? String(row.size).toUpperCase() : "",
    grade: row.grade || "",
    color: row.color || "",
    expander: row.expander || "",
    note: row.note || ""
  })).filter((row) => row.expander);
}
