import { dataStore } from "./storage.js";
import { extractViaWorker, parseExtractedOrders, validateExtractedRow } from "./imageImport.js";
import {
  batchesNeeded,
  checkCandidateFit,
  defaultExpandedForOrder,
  isExpanderOrder,
  isTruckFillable,
  minutesToDate,
  produceByDate,
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
let pendingRestoreText = null;

function nextWeekStart(weekStart) {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function activeWeekStart() {
  return state.viewWeek === "next" ? nextWeekStart(state.settings.weekStart) : state.settings.weekStart;
}

function activeExpanderWeekStart() {
  return state.viewWeek === "next" ? nextWeekStart(state.expanderSettings.weekStart) : state.expanderSettings.weekStart;
}

function activeSettings() {
  const ws = activeWeekStart();
  return ws !== state.settings.weekStart ? { ...state.settings, weekStart: ws } : state.settings;
}

function activeExpanderSettings() {
  const ws = activeExpanderWeekStart();
  return ws !== state.expanderSettings.weekStart ? { ...state.expanderSettings, weekStart: ws } : state.expanderSettings;
}

function ordersForWeek(orders, week) {
  return orders.filter((order) => (order.week || "this") === week);
}

function expanderOrdersForWeek(orders, week) {
  return orders.filter((order) => (order.week || "this") === week);
}

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
  importFile: document.querySelector("#importFile"),
  backupStatus: document.querySelector("#backupStatus"),
  backupReminder: document.querySelector("#backupReminder"),
  dismissBackupReminder: document.querySelector("#dismissBackupReminder"),
  restoreDialog: document.querySelector("#restoreDialog"),
  cancelRestoreBtn: document.querySelector("#cancelRestoreBtn"),
  confirmRestoreBtn: document.querySelector("#confirmRestoreBtn")
};

const BACKUP_META_KEY = "bead-scheduler-backup-meta";
const BACKUP_REMINDER_DAYS = 7;
const ADD_COMPANY_VALUE = "__add_company__";
const ADD_LOCATION_VALUE = "__add_location__";

setDefaultDueDate();
setDefaultOrderForm();
setDefaultExpanderOrderForm();
setDefaultExpanderDueDate();
syncOrderFormHints();
render();
renderBackupStatus();

document.querySelectorAll(".tab-btn[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => btn.classList.toggle("active", btn === button));
    document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => btn.classList.toggle("secondary", btn !== button));
    document.querySelectorAll(".app-view").forEach((view) => view.classList.toggle("active-view", view.id === button.dataset.view));
  });
});

document.querySelector("#weekToggle").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-week]");
  if (!btn) return;
  state.viewWeek = btn.dataset.week;
  state = dataStore.save(state);
  render();
});

els.orderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateReactorOrderQuantity()) return;
  const order = readOrderForm();
  state.orders.push({ ...order, week: state.viewWeek || "this", id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  saveAndRender();
  els.orderForm.reset();
  setDefaultOrderForm();
  setDefaultDueDate();
  syncOrderFormHints();
});

document.querySelector("#checkBtn").addEventListener("click", () => {
  if (!validateCustomerSelection(els.orderForm, els.fitResult)) return;
  if (!validateReactorOrderQuantity()) return;
  const candidate = readOrderForm();
  const week = state.viewWeek || "this";
  const settings = activeSettings();
  const weekOrders = ordersForWeek(state.orders, week);
  const result = checkCandidateFit(weekOrders, candidate, settings, state.loadedBatchIds, state.skippedBatchIds);
  showFitResult(result, els.fitResult, settings);
});

els.upsizeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.upsizeForm);
  if (Number(form.get("newBags")) < 1) {
    showQuantityError(els.upsizeResult);
    return;
  }
  const settings = activeSettings();
  const weekOrders = ordersForWeek(state.orders, state.viewWeek || "this");
  const result = upsizeCheck(weekOrders, form.get("orderId"), Number(form.get("newBags")), settings, state.loadedBatchIds, state.skippedBatchIds);
  if (!result) {
    els.upsizeResult.textContent = "Select an order first.";
    els.upsizeResult.className = "result warn";
    return;
  }
  els.upsizeResult.textContent = `Incremental batches: ${result.incrementalBatches}. ${fitText(result, settings)}`;
  els.upsizeResult.className = `result ${result.fits ? "ok" : "warn"}`;
});

els.expanderOrderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateQuantity(els.expanderOrderForm, "quantity", els.expanderFitResult)) return;
  const order = readExpanderOrderForm();
  state.expanderOrders.push({ ...order, week: state.viewWeek || "this", id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  saveAndRender();
  els.expanderOrderForm.reset();
  setDefaultExpanderOrderForm();
  setDefaultExpanderDueDate();
});

document.querySelector("#expanderCheckBtn").addEventListener("click", () => {
  if (!validateCustomerSelection(els.expanderOrderForm, els.expanderFitResult)) return;
  if (!validateQuantity(els.expanderOrderForm, "quantity", els.expanderFitResult)) return;
  const week = state.viewWeek || "this";
  const expSettings = activeExpanderSettings();
  const weekExpanderOrders = expanderOrdersForWeek(state.expanderOrders, week);
  const result = checkExpanderFit(weekExpanderOrders, readExpanderOrderForm(), expSettings, state.loadedExpanderBatchIds, state.skippedExpanderBatchIds);
  showExpanderFitResult(result, els.expanderFitResult, expSettings);
});

els.expanderUpsizeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.expanderUpsizeForm);
  if (Number(form.get("newQuantity")) < 1) {
    showQuantityError(els.expanderUpsizeResult);
    return;
  }
  const expSettings = activeExpanderSettings();
  const weekExpanderOrders = expanderOrdersForWeek(state.expanderOrders, state.viewWeek || "this");
  const result = upsizeExpanderCheck(weekExpanderOrders, form.get("orderId"), Number(form.get("newQuantity")), expSettings, state.loadedExpanderBatchIds, state.skippedExpanderBatchIds);
  if (!result) {
    els.expanderUpsizeResult.textContent = "Select an order first.";
    els.expanderUpsizeResult.className = "result warn";
    return;
  }
  els.expanderUpsizeResult.textContent = `Incremental batches: ${result.incrementalBatches}. ${expanderFitText(result, expSettings)}`;
  els.expanderUpsizeResult.className = `result ${result.fits ? "ok" : "warn"}`;
});

const REACTOR_CSV_HEADERS = ["company", "location", "size", "family", "color", "grade", "order_type", "quantity", "due_date", "preferred_reactor"];

document.querySelector("#downloadReactorTemplate").addEventListener("click", () => {
  const example = [
    ["Ventek", "OH", "15", "HBS", "black", "standard", "bulk", "1", "2026-06-13T16:00", ""],
    ["Cambro", "", "20", "HBS", "black", "standard", "bag", "52", "2026-06-14T12:00", "R1"]
  ];
  const rows = [REACTOR_CSV_HEADERS, ...example].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "reactor-order-template.csv";
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector("#importReactorCsv").addEventListener("change", async () => {
  const file = document.querySelector("#importReactorCsv").files[0];
  const resultEl = document.querySelector("#csvImportResult");
  if (!file) return;
  try {
    const text = await file.text();
    const { orders: parsed, errors } = parseReactorCsv(text);
    document.querySelector("#importReactorCsv").value = "";
    if (errors.length) {
      resultEl.textContent = `Import stopped: ${errors.join(" | ")}`;
      resultEl.className = "result warn";
      return;
    }
    if (!parsed.length) {
      resultEl.textContent = "No data rows found in the file.";
      resultEl.className = "result warn";
      return;
    }
    const week = state.viewWeek || "this";
    const newOrders = parsed.map((order) => ({ ...order, week, id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
    state.orders = [...state.orders, ...newOrders];
    saveAndRender();
    resultEl.textContent = `Imported ${newOrders.length} order(s) for ${week === "next" ? "next" : "this"} week.`;
    resultEl.className = "result ok";
  } catch (err) {
    resultEl.textContent = `Could not read file: ${err.message}`;
    resultEl.className = "result warn";
  }
});

function parseReactorCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (lines.length < 2) return { orders: [], errors: ["File has no data rows (need a header row + at least one order row)."] };
  const headers = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = (name) => headers.indexOf(name);
  const required = ["company", "size", "color", "order_type", "quantity", "due_date"];
  const missing = required.filter((h) => idx(h) === -1);
  if (missing.length) return { orders: [], errors: [`Missing required columns: ${missing.join(", ")}. Download the template to see the expected format.`] };
  const orders = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const get = (name) => (cols[idx(name)] || "").trim();
    const rowNum = i + 1;
    const company = get("company");
    const size = Number(get("size"));
    const color = get("color").toLowerCase();
    const orderType = get("order_type").toLowerCase() === "bag" ? "bag" : "bulk";
    const quantityRaw = get("quantity");
    const quantity = Number(quantityRaw);
    const dueDate = get("due_date");
    const family = get("family") || (size >= 30 ? "HBS" : size > 0 ? "HBS" : "HBS");
    const grade = get("grade") || "standard";
    const preferredReactor = get("preferred_reactor") || "";
    const location = get("location") || "";
    if (!company) { errors.push(`Row ${rowNum}: company is required.`); continue; }
    if (!size || isNaN(size)) { errors.push(`Row ${rowNum}: size must be a number (got "${get("size")}").`); continue; }
    if (!color) { errors.push(`Row ${rowNum}: color is required.`); continue; }
    if (!quantityRaw || quantityRaw === "") { errors.push(`Row ${rowNum}: quantity is required — enter a number, never leave it blank.`); continue; }
    if (isNaN(quantity) || quantity < 1) { errors.push(`Row ${rowNum}: quantity must be a whole number ≥ 1 (got "${quantityRaw}").`); continue; }
    if (!dueDate) { errors.push(`Row ${rowNum}: due_date is required (use format 2026-06-13T16:00).`); continue; }
    const truckFillable = isTruckFillable(state.settings, size, family);
    const bags = truckFillable && orderType === "bulk" ? quantity * Number(state.settings.truckBags) : quantity;
    const customerName = customerLabel(company, location) || company;
    orders.push({
      company,
      location,
      customer: customerName,
      productCode: "",
      family,
      size,
      quantityBags: bags,
      grade,
      color,
      preferredReactor,
      expanded: false,
      dueDate
    });
  }
  return { orders, errors };
}

function parseCsvRow(line) {
  const cols = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ",") {
      cols.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

// ── Screenshot import ─────────────────────────────────────────────────────────

const screenshotState = { dataUrl: null, base64: null, mediaType: null };

function screenshotWorkerUrl() {
  return (state.settings.screenshotWorkerUrl || "").trim();
}

function updateScreenshotAvailability() {
  const hasUrl = Boolean(screenshotWorkerUrl());
  const section = document.querySelector("#screenshotImportSection");
  const wrap = document.querySelector("#screenshotPreviewWrap");
  const noUrlNote = document.querySelector("#screenshotNoUrlNote");
  if (!section) return;
  if (!hasUrl) {
    if (wrap) wrap.classList.add("hidden");
    if (noUrlNote) noUrlNote.classList.remove("hidden");
  } else {
    if (noUrlNote) noUrlNote.classList.add("hidden");
  }
}

function setScreenshotImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    setScreenshotStatus("That file doesn't look like an image (PNG, JPG, or WebP expected).", "warn");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const comma = dataUrl.indexOf(",");
    screenshotState.base64 = dataUrl.slice(comma + 1);
    screenshotState.mediaType = file.type;
    screenshotState.dataUrl = dataUrl;
    document.querySelector("#screenshotPreviewThumb").src = dataUrl;
    document.querySelector("#screenshotPreviewWrap").classList.remove("hidden");
    setScreenshotStatus("", "");
  };
  reader.readAsDataURL(file);
}

document.querySelector("#screenshotFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) setScreenshotImage(file);
});

document.querySelector("#screenshotImportSection").addEventListener("paste", (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      setScreenshotImage(item.getAsFile());
      break;
    }
  }
});

document.querySelector("#screenshotClearBtn").addEventListener("click", () => {
  screenshotState.dataUrl = null;
  screenshotState.base64 = null;
  screenshotState.mediaType = null;
  document.querySelector("#screenshotPreviewThumb").src = "";
  document.querySelector("#screenshotPreviewWrap").classList.add("hidden");
  setScreenshotStatus("", "");
});

document.querySelector("#screenshotExtractBtn").addEventListener("click", async () => {
  if (!screenshotState.base64) {
    setScreenshotStatus("No image loaded — upload or paste an image first.", "warn");
    return;
  }
  const workerUrl = screenshotWorkerUrl();
  if (!workerUrl) {
    setScreenshotStatus(
      "Screenshot import service address is not set. " +
      "Go to Settings and paste the Worker URL into the \"Screenshot import service address\" field. " +
      "You can still use the spreadsheet import or enter orders manually.",
      "warn",
    );
    return;
  }
  const btn = document.querySelector("#screenshotExtractBtn");
  btn.disabled = true;
  btn.textContent = "Extracting…";
  setScreenshotStatus("Sending image to the extraction service — this takes a few seconds…", "");
  try {
    const rawText = await extractViaWorker(screenshotState.base64, screenshotState.mediaType, workerUrl);
    const { rows, parseError } = parseExtractedOrders(rawText);
    if (parseError) {
      setScreenshotStatus(parseError, "warn");
      return;
    }
    openReviewModal(rows, screenshotState.dataUrl);
    setScreenshotStatus("", "");
  } catch (err) {
    setScreenshotStatus(err.message, "warn");
  } finally {
    btn.disabled = false;
    btn.textContent = "Extract Orders from Image";
  }
});

function setScreenshotStatus(msg, type) {
  const el = document.querySelector("#screenshotStatus");
  el.textContent = msg;
  el.className = type ? `result ${type}` : "result";
}

// ── Review modal ──────────────────────────────────────────────────────────────

let reviewRows = [];

function openReviewModal(extractedRows, imageDataUrl) {
  reviewRows = extractedRows.map((raw) => {
    const { fields } = validateExtractedRow(raw);
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value]));
  });
  if (reviewRows.length === 0) {
    reviewRows = [emptyReviewRow()];
  }
  document.querySelector("#screenshotReviewImg").src = imageDataUrl;
  document.querySelector("#screenshotReviewModal").classList.remove("hidden");
  renderReviewTable();
}

function emptyReviewRow() {
  return { company: "", location: "", size: "", family: "HBS", color: "black", grade: "standard", order_type: "bulk", quantity: "", due_date: "" };
}

function renderReviewTable() {
  const total = reviewRows.length;
  const validCount = reviewRows.filter((row) => validateExtractedRow(rawValuesToExtracted(row)).valid).length;
  document.querySelector("#screenshotReviewSummary").textContent =
    `${total} order${total === 1 ? "" : "s"} read — review each row, correct anything flagged in yellow, then click Confirm. Nothing is added until you confirm.`;

  const flaggedCount = total - validCount;
  if (flaggedCount > 0) {
    document.querySelector("#screenshotReviewSummary").textContent +=
      ` (${flaggedCount} row${flaggedCount === 1 ? " needs" : "s need"} attention — fields highlighted in yellow couldn't be read clearly.)`;
  }

  const tbody = reviewRows.map((row, i) => {
    const { fields, errors } = validateExtractedRow(rawValuesToExtracted(row));
    const rowClass = errors.length ? "review-row-invalid" : "review-row-valid";
    const cell = (name, type, opts = "") => {
      const f = fields[name];
      const val = escapeAttr(row[name] ?? "");
      const flagClass = f.flagged ? "flagged-field" : "";
      const title = f.flagged ? `couldn't read — please check` : "";
      if (type === "select") {
        const options = opts.map((o) => `<option value="${o}" ${row[name] === o ? "selected" : ""}>${o}</option>`).join("");
        return `<td class="${flagClass}"><select data-row="${i}" data-field="${name}" title="${escapeAttr(title)}">${options}</select></td>`;
      }
      return `<td class="${flagClass}"><input type="${type}" data-row="${i}" data-field="${name}" value="${val}" placeholder="${escapeAttr(title || name)}" title="${escapeAttr(title)}"></td>`;
    };
    const errorHtml = errors.length
      ? `<tr class="review-row-errors"><td colspan="10"><span class="row-error-list">${errors.map(escapeHtml).join(" · ")}</span></td></tr>`
      : "";
    return `<tr class="${rowClass}">
      ${cell("company", "text")}
      ${cell("location", "text")}
      ${cell("size", "number")}
      ${cell("family", "select", ["HBS", "HBR"])}
      ${cell("color", "select", ["black", "white", "green", "yellow"])}
      ${cell("grade", "select", ["standard", "ESD"])}
      ${cell("order_type", "select", ["bulk", "bag"])}
      ${cell("quantity", "number")}
      ${cell("due_date", "text")}
      <td><button class="danger review-delete-btn" data-row="${i}" type="button" title="Remove this row">✕</button></td>
    </tr>${errorHtml}`;
  }).join("");

  document.querySelector("#screenshotReviewTable").innerHTML = `
    <table class="review-table">
      <thead>
        <tr>
          <th>Company</th><th>Location</th><th>Size</th><th>Family</th>
          <th>Color</th><th>Grade</th><th>Type</th><th>Qty</th><th>Due date</th><th></th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

function rawValuesToExtracted(row) {
  return {
    company: row.company || null,
    location: row.location || null,
    size: row.size !== "" && row.size !== undefined ? Number(row.size) : null,
    family: row.family || null,
    color: row.color || null,
    grade: row.grade || null,
    order_type: row.order_type || null,
    quantity: row.quantity !== "" && row.quantity !== undefined ? Number(row.quantity) : null,
    due_date: row.due_date || null
  };
}

document.querySelector("#screenshotReviewTable").addEventListener("input", (e) => {
  const { row, field } = e.target.dataset;
  if (row === undefined || !field) return;
  reviewRows[Number(row)][field] = e.target.value;
  // Re-render validation state without disturbing focused input — just update classes
  updateReviewRowState(Number(row));
});

document.querySelector("#screenshotReviewTable").addEventListener("change", (e) => {
  const { row, field } = e.target.dataset;
  if (row === undefined || !field) return;
  reviewRows[Number(row)][field] = e.target.value;
  updateReviewRowState(Number(row));
});

document.querySelector("#screenshotReviewTable").addEventListener("click", (e) => {
  const btn = e.target.closest(".review-delete-btn");
  if (!btn) return;
  const i = Number(btn.dataset.row);
  reviewRows.splice(i, 1);
  renderReviewTable();
});

function updateReviewRowState(rowIndex) {
  const { errors, fields } = validateExtractedRow(rawValuesToExtracted(reviewRows[rowIndex]));
  const table = document.querySelector("#screenshotReviewTable table");
  if (!table) return;
  const rows = table.querySelectorAll("tbody tr");
  // Find the main row (not error sub-row) for this index
  let mainRow = null;
  let count = 0;
  for (const tr of rows) {
    if (!tr.classList.contains("review-row-errors")) {
      if (count === rowIndex) { mainRow = tr; break; }
      count++;
    }
  }
  if (!mainRow) return;
  mainRow.className = errors.length ? "review-row-invalid" : "review-row-valid";
  // Update per-cell flag classes
  mainRow.querySelectorAll("[data-field]").forEach((input) => {
    const f = fields[input.dataset.field];
    if (f) input.closest("td").className = f.flagged ? "flagged-field" : "";
  });
  // Update or remove error sub-row
  const nextRow = mainRow.nextElementSibling;
  const hasErrorRow = nextRow && nextRow.classList.contains("review-row-errors");
  if (errors.length) {
    const errorHtml = `<span class="row-error-list">${errors.map(escapeHtml).join(" · ")}</span>`;
    if (hasErrorRow) {
      nextRow.querySelector("td").innerHTML = errorHtml;
    } else {
      const errTr = document.createElement("tr");
      errTr.className = "review-row-errors";
      errTr.innerHTML = `<td colspan="10">${errorHtml}</td>`;
      mainRow.insertAdjacentElement("afterend", errTr);
    }
  } else if (hasErrorRow) {
    nextRow.remove();
  }
}

document.querySelector("#addScreenshotRow").addEventListener("click", () => {
  reviewRows.push(emptyReviewRow());
  renderReviewTable();
  // Focus first cell of new row
  const inputs = document.querySelectorAll("#screenshotReviewTable [data-row]");
  const lastRowInputs = [...inputs].filter((el) => Number(el.dataset.row) === reviewRows.length - 1);
  if (lastRowInputs[0]) lastRowInputs[0].focus();
});

document.querySelector("#cancelScreenshotReview").addEventListener("click", () => {
  document.querySelector("#screenshotReviewModal").classList.add("hidden");
  document.querySelector("#screenshotReviewErrors").classList.add("hidden");
});

document.querySelector("#confirmScreenshotReview").addEventListener("click", () => {
  const errorsEl = document.querySelector("#screenshotReviewErrors");
  const allErrors = [];
  const validOrders = [];

  reviewRows.forEach((row, i) => {
    const result = validateExtractedRow(rawValuesToExtracted(row));
    if (!result.valid) {
      allErrors.push(`Row ${i + 1} (${row.company || "no company"}): ${result.errors.join("; ")}`);
    } else {
      const size = Number(row.size);
      const family = row.family || "HBS";
      const orderType = row.order_type;
      const quantity = Number(row.quantity);
      const truckFillable = isTruckFillable(state.settings, size, family);
      const bags = truckFillable && orderType === "bulk" ? quantity * Number(state.settings.truckBags) : quantity;
      validOrders.push({
        company: row.company.trim(),
        location: (row.location || "").trim(),
        customer: customerLabel(row.company.trim(), (row.location || "").trim()) || row.company.trim(),
        productCode: "",
        family,
        size,
        quantityBags: bags,
        grade: row.grade || "standard",
        color: row.color,
        preferredReactor: "",
        expanded: false,
        dueDate: row.due_date,
        week: state.viewWeek || "this"
      });
    }
  });

  if (allErrors.length) {
    errorsEl.textContent = `Please fix these issues before confirming: ${allErrors.join(" | ")}`;
    errorsEl.classList.remove("hidden");
    return;
  }

  errorsEl.classList.add("hidden");
  const week = state.viewWeek || "this";
  const newOrders = validOrders.map((o) => ({ ...o, id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
  state.orders = [...state.orders, ...newOrders];
  saveAndRender();
  document.querySelector("#screenshotReviewModal").classList.add("hidden");
  setScreenshotStatus(`${newOrders.length} order${newOrders.length === 1 ? "" : "s"} added to ${week === "next" ? "next" : "this"} week's schedule.`, "ok");
});

els.exportBtn.addEventListener("click", () => {
  const blob = new Blob([dataStore.export(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Bead Scheduler Backup ${new Date().toISOString().slice(0, 10)}.backup`;
  link.click();
  URL.revokeObjectURL(url);
  saveBackupMeta({ lastBackupAt: new Date().toISOString(), reminderDismissedAt: null });
  renderBackupStatus();
});

els.importFile.addEventListener("change", async () => {
  const file = els.importFile.files[0];
  if (!file) return;
  pendingRestoreText = await file.text();
  els.restoreDialog.classList.remove("hidden");
});

els.cancelRestoreBtn.addEventListener("click", () => {
  pendingRestoreText = null;
  els.restoreDialog.classList.add("hidden");
  els.importFile.value = "";
});

els.confirmRestoreBtn.addEventListener("click", () => {
  if (!pendingRestoreText) return;
  state = dataStore.import(pendingRestoreText);
  pendingRestoreText = null;
  els.restoreDialog.classList.add("hidden");
  els.importFile.value = "";
  render();
});

els.dismissBackupReminder.addEventListener("click", () => {
  saveBackupMeta({ ...loadBackupMeta(), reminderDismissedAt: new Date().toISOString() });
  renderBackupStatus();
});

els.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applyCustomerSettings();
  state.settings = readSettingsForm();
  saveAndRender();
});

els.settingsForm.addEventListener("click", (event) => {
  handleSettingsButton(event, "reactor");
});

els.settingsForm.addEventListener("input", () => updateRulePreviews("reactor"));

els.expanderSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.expanderSettings = readExpanderSettingsForm();
  saveAndRender();
});

els.expanderSettingsForm.addEventListener("click", (event) => {
  handleSettingsButton(event, "expander");
});

els.expanderSettingsForm.addEventListener("input", () => updateRulePreviews("expander"));

els.timeline.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='delete-batch']");
  if (!button) return;
  event.stopPropagation();
  const { batchId } = button.dataset;
  if (!confirm("Delete this batch from the committed schedule?")) return;
  state.skippedBatchIds = [...new Set([...(state.skippedBatchIds || []), batchId])];
  state.loadedBatchIds = state.loadedBatchIds.filter((id) => id !== batchId);
  saveAndRender();
});

els.expanderTimeline.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='delete-expander-batch']");
  if (!button) return;
  event.stopPropagation();
  const { batchId } = button.dataset;
  if (!confirm("Delete this batch from the committed schedule?")) return;
  state.skippedExpanderBatchIds = [...new Set([...(state.skippedExpanderBatchIds || []), batchId])];
  state.loadedExpanderBatchIds = state.loadedExpanderBatchIds.filter((id) => id !== batchId);
  saveAndRender();
});

els.orderForm.addEventListener("input", (event) => {
  if (["family", "size", "orderType"].includes(event.target.name)) syncOrderFormHints();
});

els.orderForm.addEventListener("change", (event) => {
  if (["company", "location"].includes(event.target.name)) handleCompanyLocationSelect(event.target);
});

els.expanderOrderForm.addEventListener("change", (event) => {
  if (["company", "location"].includes(event.target.name)) handleCompanyLocationSelect(event.target);
});

els.ordersTable.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, orderId, batchId } = button.dataset;
  if (action === "delete-order") {
    state.orders = state.orders.filter((order) => order.id !== orderId);
    state.loadedBatchIds = state.loadedBatchIds.filter((id) => !id.startsWith(`${orderId}-`));
    state.skippedBatchIds = (state.skippedBatchIds || []).filter((id) => !id.startsWith(`${orderId}-`));
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
    state.skippedExpanderBatchIds = (state.skippedExpanderBatchIds || []).filter((id) => !id.startsWith(`${orderId}-`));
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
  const orderType = form.get("orderType");
  const truckFillable = isTruckFillable(state.settings, size, family);
  const trucks = truckFillable && orderType === "bulk" ? Number(form.get("trucks") || 0) : 0;
  const bags = trucks > 0 ? trucks * Number(state.settings.truckBags) : Number(form.get("quantityBags"));
  const company = form.get("company") || "";
  const location = form.get("location") || "";
  return {
    company,
    location,
    customer: customerLabel(company, location) || "Candidate",
    productCode: "",
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
  const company = form.get("company") || "";
  const location = form.get("location") || "";
  return {
    company,
    location,
    customer: customerLabel(company, location) || "Candidate",
    productCode: "",
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
  const week = state.viewWeek || "this";
  const settings = activeSettings();
  const expanderSettings = activeExpanderSettings();
  const weekOrders = ordersForWeek(state.orders, week);
  const weekExpanderOrders = expanderOrdersForWeek(state.expanderOrders, week);
  const weekLoaded = state.loadedBatchIds.filter((id) => weekOrders.some((o) => id.startsWith(`${o.id}-`)));
  const weekSkipped = (state.skippedBatchIds || []).filter((id) => weekOrders.some((o) => id.startsWith(`${o.id}-`)));
  const weekExpanderLoaded = state.loadedExpanderBatchIds.filter((id) => weekExpanderOrders.some((o) => id.startsWith(`${o.id}-`)));
  const weekExpanderSkipped = (state.skippedExpanderBatchIds || []).filter((id) => weekExpanderOrders.some((o) => id.startsWith(`${o.id}-`)));
  const schedule = scheduleOrders(weekOrders, settings, weekLoaded, weekSkipped);
  const expanderSchedule = scheduleExpanderOrders(weekExpanderOrders, expanderSettings, weekExpanderLoaded, weekExpanderSkipped);
  renderCompanyLocationSelects();
  renderWeekToggle();
  updateScreenshotAvailability();
  renderReadout(schedule);
  renderTimeline(schedule, settings);
  renderOrders(schedule, settings);
  renderSettings();
  renderUpsizeOptions();
  renderExpanderReadout(expanderSchedule);
  renderExpanderTimeline(expanderSchedule, expanderSettings);
  renderExpanderOrders(expanderSchedule, expanderSettings);
  renderExpanderSettings();
  renderExpanderUpsizeOptions();
  renderGuide();
}

function renderWeekToggle() {
  const week = state.viewWeek || "this";
  document.querySelectorAll("#weekToggle .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.week === week);
    btn.classList.toggle("secondary", btn.dataset.week !== week);
  });
}

function renderCompanyLocationSelects(selected = {}, formId = "") {
  [els.orderForm, els.expanderOrderForm].forEach((form) => {
    const companySelect = form.querySelector('[name="company"]');
    const locationSelect = form.querySelector('[name="location"]');
    if (!companySelect || !locationSelect) return;
    const currentCompany = form.id === formId && selected.company ? selected.company : companySelect.value;
    const company = customerCompany(currentCompany);
    const currentLocation = form.id === formId && selected.location !== undefined ? selected.location : locationSelect.value;
    companySelect.innerHTML = `
      ${option("", state.customers.length ? "Select company" : "Add a company first", !currentCompany)}
      ${state.customers.map((entry) => option(entry.company, entry.company, currentCompany === entry.company)).join("")}
      ${option(ADD_COMPANY_VALUE, "+ Add new company", false)}
    `;
    locationSelect.innerHTML = `
      ${option("", company ? "Any / no location" : "Select company first", !currentLocation)}
      ${(company?.locations || []).map((location) => option(location, location, currentLocation === location)).join("")}
      ${company ? option(ADD_LOCATION_VALUE, "+ Add new location", false) : ""}
    `;
    locationSelect.disabled = !company;
  });
}

function handleCompanyLocationSelect(select) {
  const form = select.closest("form");
  const formId = form?.id || "";
  const companySelect = form?.querySelector('[name="company"]');
  const locationSelect = form?.querySelector('[name="location"]');
  if (select.name === "company" && select.value === ADD_COMPANY_VALUE) {
    const company = addCompanyName(prompt("Company name"));
    renderCompanyLocationSelects({ company, location: "" }, formId);
    return;
  }
  if (select.name === "company") {
    renderCompanyLocationSelects({ company: select.value, location: "" }, formId);
    return;
  }
  if (select.name === "location" && select.value === ADD_LOCATION_VALUE) {
    const location = addLocationName(companySelect.value, prompt("Location / state"));
    renderCompanyLocationSelects({ company: companySelect.value, location }, formId);
    return;
  }
  if (locationSelect) locationSelect.setCustomValidity("");
}

function addCompanyName(value) {
  const company = String(value || "").trim();
  if (!company) return "";
  state.customers = normalizeCustomerList([...state.customers, { company, locations: [] }]);
  state = dataStore.save(state);
  render();
  return company;
}

function addLocationName(company, value) {
  const location = String(value || "").trim().toUpperCase();
  if (!company || !location) return "";
  state.customers = normalizeCustomerList(state.customers.map((entry) => entry.company === company
    ? { ...entry, locations: [...entry.locations, location] }
    : entry));
  state = dataStore.save(state);
  render();
  return location;
}

function renderBackupStatus() {
  const meta = loadBackupMeta();
  els.backupStatus.textContent = meta.lastBackupAt
    ? `Last backup: ${new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(meta.lastBackupAt))}`
    : "No backup saved yet";
  els.backupReminder.classList.toggle("hidden", !shouldShowBackupReminder(meta));
}

function shouldShowBackupReminder(meta) {
  if (!meta.lastBackupAt) return !meta.reminderDismissedAt;
  const lastBackupAge = Date.now() - new Date(meta.lastBackupAt).getTime();
  const dismissedAfterBackup = meta.reminderDismissedAt && new Date(meta.reminderDismissedAt).getTime() > new Date(meta.lastBackupAt).getTime();
  return lastBackupAge > BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1000 && !dismissedAfterBackup;
}

function loadBackupMeta() {
  try {
    return JSON.parse(localStorage.getItem(BACKUP_META_KEY)) || {};
  } catch {
    return {};
  }
}

function saveBackupMeta(meta) {
  localStorage.setItem(BACKUP_META_KEY, JSON.stringify(meta));
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

function renderTimeline(schedule, settings = state.settings) {
  const total = schedule.totalMinutes;
  els.timeline.innerHTML = `
    <div class="timeline-scroll">
      <div class="timeline-inner" style="min-width:${settings.daysPerWeek * 960}px">
        <div class="axis"><div></div><div class="axis-line" style="grid-template-columns:repeat(${settings.daysPerWeek}, 1fr)">${dateAxisLabels(settings.weekStart, settings.daysPerWeek, settings.dayStartTime)}</div></div>
        ${schedule.reactors.map((reactor) => `
          <div class="reactor-row">
            <div class="reactor-name">${reactor.name}</div>
            <div class="track">
              ${reactor.windows.map((win) => `<div class="window" style="left:${pos(win.start, total)}%;width:${width(win.start, win.end, total)}%"></div>`).join("")}
              ${reactor.events.map((event) => eventHtml(event, total, settings)).join("")}
            </div>
          </div>
        `).join("")}
        </div>
      </div>
  `;
}

function renderExpanderTimeline(schedule, settings = state.expanderSettings) {
  const total = schedule.totalMinutes;
  els.expanderTimeline.innerHTML = `
    <div class="timeline-scroll">
      <div class="timeline-inner" style="min-width:${settings.daysPerWeek * 960}px">
        <div class="axis"><div></div><div class="axis-line" style="grid-template-columns:repeat(${settings.daysPerWeek}, 1fr)">${dateAxisLabels(settings.weekStart, settings.daysPerWeek, settings.dayStartTime)}</div></div>
        ${schedule.expanders.map((expander) => `
          <div class="reactor-row">
            <div class="reactor-name">${expander.id}</div>
            <div class="track">
              ${expander.windows.map((win) => `<div class="window" style="left:${pos(win.start, total)}%;width:${width(win.start, win.end, total)}%"></div>`).join("")}
              ${expander.events.map((event) => expanderEventHtml(event, total, settings)).join("")}
            </div>
          </div>
        `).join("")}
        </div>
      </div>
  `;
}

function eventHtml(event, total, settings = state.settings) {
  if (event.type === "water-batch") {
    return `<div class="event water-batch" title="${escapeAttr(`${event.label} — non-production warm-up ${formatRange(event, settings)}`)}" style="left:${pos(event.start, total)}%;width:${Math.max(2.2, width(event.start, event.end, total))}%"><span>${escapeHtml(event.label)}</span></div>`;
  }
  const colorClass = event.type === "changeover" ? "changeover" : event.status === "loaded" ? "loaded" : event.color === "white" ? "white" : "needed";
  const fullLabel = event.type === "changeover"
    ? event.label
    : `${event.customer || ""} ${event.size} ${event.color} b${event.sequence}`;
  const label = event.type === "changeover" ? event.label : abbreviatedEventLabel(event);
  const title = event.type === "changeover" ? `${fullLabel} ${formatRange(event, settings)}` : `${fullLabel} ${formatRange(event, settings)}. Deliver ${formatDateValue(event.dueDate)}. Produce by ${formatDateValue(event.produceByDate)}.`;
  const deleteButton = event.type === "batch"
    ? `<button class="event-delete" data-action="delete-batch" data-batch-id="${escapeAttr(event.id)}" type="button" title="Delete this batch">&times;</button>`
    : "";
  return `<div class="event ${colorClass}" title="${escapeAttr(title)}" style="left:${pos(event.start, total)}%;width:${Math.max(2.2, width(event.start, event.end, total))}%"><span>${escapeHtml(label)}</span>${deleteButton}</div>`;
}

function expanderEventHtml(event, total, settings = state.expanderSettings) {
  const colorClass = event.type === "color-flip" ? "color-flip" : event.status === "loaded" ? "loaded" : event.color === "white" ? "white" : "needed";
  const fullLabel = event.type === "color-flip" ? event.label : `${event.customer || ""} ${event.size} ${event.color} b${event.sequence}`;
  const label = event.type === "color-flip" ? event.label : abbreviatedEventLabel(event);
  const title = event.type === "color-flip" ? `${fullLabel} ${formatExpanderRange(event, settings)}` : `${fullLabel} ${formatExpanderRange(event, settings)}. Deliver ${formatDateValue(event.dueDate)}. Produce by ${formatDateValue(event.produceByDate)}.`;
  const deleteButton = event.type === "batch"
    ? `<button class="event-delete" data-action="delete-expander-batch" data-batch-id="${escapeAttr(event.id)}" type="button" title="Delete this batch">&times;</button>`
    : "";
  return `<div class="event ${colorClass}" title="${escapeAttr(title)}" style="left:${pos(event.start, total)}%;width:${Math.max(2.2, width(event.start, event.end, total))}%"><span>${escapeHtml(label)}</span>${deleteButton}</div>`;
}

function renderOrders(schedule, settings = state.settings) {
  const week = state.viewWeek || "this";
  const weekOrders = ordersForWeek(state.orders, week);
  const byOrder = new Map(schedule.events.filter((event) => event.type === "batch").map((event) => [event.orderId, []]));
  schedule.events.filter((event) => event.type === "batch").forEach((event) => byOrder.get(event.orderId).push(event));
  els.ordersTable.innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Spec</th><th>Bags</th><th>Batches</th><th>Completion</th><th>Loaded</th><th></th></tr></thead>
      <tbody>
        ${weekOrders.map((order) => {
          const events = byOrder.get(order.id) || [];
          const expander = isExpanderOrder(order, settings);
          const completion = events.length ? fmt(minutesToDate(settings.weekStart, Math.max(...events.map((event) => event.end)), settings)) : expander ? "expanded route" : "not scheduled";
          const produceBy = produceByDate(order.dueDate, settings);
          return `<tr>
            <td>${escapeHtml(order.customer)}</td>
            <td>${order.family} ${order.size}${order.expanded ? "X" : ""} ${order.grade} ${order.color}${order.preferredReactor ? ` -> ${order.preferredReactor}` : ""}</td>
            <td>${order.quantityBags}</td>
            <td>${batchesNeeded(order, settings)}</td>
            <td>${completion}<div class="table-note">Produce by ${escapeHtml(formatDateValue(produceBy))}<br>Deliver ${escapeHtml(formatDateValue(order.dueDate))}</div></td>
            <td>${events.map((event) => `<button class="secondary" data-action="toggle-loaded" data-batch-id="${event.id}" type="button">${event.status === "loaded" ? "Loaded" : `B${event.sequence}`}</button>`).join(" ")}</td>
            <td><button class="danger" data-action="delete-order" data-order-id="${order.id}" type="button">Delete</button></td>
          </tr>`;
        }).join("") || `<tr><td colspan="7">No committed orders for ${week === "next" ? "next" : "this"} week yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderExpanderOrders(schedule, settings = state.expanderSettings) {
  const week = state.viewWeek || "this";
  const weekOrders = expanderOrdersForWeek(state.expanderOrders, week);
  const byOrder = new Map(schedule.events.filter((event) => event.type === "batch").map((event) => [event.orderId, []]));
  schedule.events.filter((event) => event.type === "batch").forEach((event) => byOrder.get(event.orderId).push(event));
  els.expanderOrdersTable.innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Spec</th><th>Qty</th><th>Batches</th><th>Completion</th><th>Loaded</th><th></th></tr></thead>
      <tbody>
        ${weekOrders.map((order) => {
          const events = byOrder.get(order.id) || [];
          const completion = events.length ? fmt(expanderMinutesToDate(settings.weekStart, Math.max(...events.map((event) => event.end)), settings)) : "not scheduled";
          const produceBy = produceByDate(order.dueDate, settings);
          return `<tr>
            <td>${escapeHtml(order.customer)}</td>
            <td>${order.size} ${order.grade} ${order.color}${order.preferredExpander ? ` -> ${order.preferredExpander}` : ""}</td>
            <td>${order.quantity} ${order.orderType === "bulk" ? "truck(s)" : "bags"}</td>
            <td>${expanderBatchesNeeded(order, settings)}</td>
            <td>${completion}<div class="table-note">Produce by ${escapeHtml(formatDateValue(produceBy))}<br>Deliver ${escapeHtml(formatDateValue(order.dueDate))}</div></td>
            <td>${events.map((event) => `<button class="secondary" data-action="toggle-expander-loaded" data-batch-id="${event.id}" type="button">${event.status === "loaded" ? "Loaded" : `B${event.sequence}`}</button>`).join(" ")}</td>
            <td><button class="danger" data-action="delete-expander-order" data-order-id="${order.id}" type="button">Delete</button></td>
          </tr>`;
        }).join("") || `<tr><td colspan="7">No committed expander orders for ${week === "next" ? "next" : "this"} week yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderUpsizeOptions() {
  const week = state.viewWeek || "this";
  const weekOrders = ordersForWeek(state.orders, week);
  els.upsizeOrder.innerHTML = weekOrders.map((order) => `<option value="${order.id}">${escapeHtml(order.customer)} - ${order.size} ${order.color}</option>`).join("");
}

function renderExpanderUpsizeOptions() {
  const week = state.viewWeek || "this";
  const weekExpanderOrders = expanderOrdersForWeek(state.expanderOrders, week);
  els.expanderUpsizeOrder.innerHTML = weekExpanderOrders.map((order) => `<option value="${order.id}">${escapeHtml(order.customer)} - ${order.size} ${order.color}</option>`).join("");
}

function renderSettings() {
  const s = state.settings;
  els.settingsForm.innerHTML = `
    <div class="settings-row">
      ${settingField("Week start", "weekStart", "date", s.weekStart, "First day shown on the weekly schedule.")}
      ${settingField("Day start time", "dayStartTime", "time", s.dayStartTime || "07:10", "Wall-clock time that schedule minute zero maps to (e.g. 07:10 = 7:10 AM Monday).")}
      ${settingField("Realistic batches per day", "realisticBatchesPerDay", "number", s.realisticBatchesPerDay ?? 7.5, "Used to compute batch time: minutes per day ÷ this = batch minutes (1440 ÷ 7.5 = 192 min).", "0.1")}
      ${settingField("Batch time (minutes)", "batchMinutes", "number", s.batchMinutes, "How long one reactor batch takes. Set automatically from realistic batches per day.")}
      <label>Monday water batch (warm-up)
        <select name="waterBatch"><option value="true" ${s.waterBatch !== false ? "selected" : ""}>Enabled</option><option value="false" ${s.waterBatch === false ? "selected" : ""}>Disabled</option></select>
        <span class="field-help">Blocks the first stretch of Monday for all reactors — produces nothing, shown as a non-production block.</span>
      </label>
      ${settingField("Water batch duration (minutes)", "waterBatchMinutes", "number", s.waterBatchMinutes ?? 120, "How long the Monday warm-up blocks on each reactor.")}
      <label>Days per week
        <select name="daysPerWeek">${[4,5,6,7].map((d) => `<option value="${d}" ${Number(s.daysPerWeek) === d ? "selected" : ""}>${d} days</option>`).join("")}</select>
        <span class="field-help">Production days available this week. 5 = Mon–Fri, 6 = Mon–Sat, 7 = full week.</span>
      </label>
      ${settingField("Shift length (minutes)", "shiftLength", "number", s.shiftLength, "Length of one staffed shift.")}
      ${settingField("Minutes per day", "minutesPerDay", "number", s.minutesPerDay, "Total wall-clock minutes in a production day.")}
      ${settingField("Bags per truck", "truckBags", "number", s.truckBags, "Used only for sizes measured by full truckloads.")}
      ${settingField("Production lead time (work days)", "productionLeadDays", "number", s.productionLeadDays ?? 1, "Batches must finish this many production days before delivery. Skips non-production days.")}
      ${settingField("Screenshot import service address", "screenshotWorkerUrl", "url", s.screenshotWorkerUrl || "", "Paste the Cloudflare Worker URL here to enable screenshot import. Leave blank to hide the feature. The key stays on the server — never in this app.")}
      ${settingField("Auto-mark expanded size", "expanderThreshold", "number", s.expanderThreshold, "Fallback only: sizes at or above this are suggested as expanded unless the X setting says otherwise.")}
      <label>Combine matching orders
        <select name="combineSameSpec"><option value="false" ${!s.combineSameSpec ? "selected" : ""}>No</option><option value="true" ${s.combineSameSpec ? "selected" : ""}>Yes</option></select>
        <span class="field-help">Future option for sharing batches across matching orders.</span>
      </label>
      <label>Prefer white to R2 / black to R1
        <select name="autoColorAllocation"><option value="true" ${s.autoColorAllocation ? "selected" : ""}>Yes</option><option value="false" ${!s.autoColorAllocation ? "selected" : ""}>No</option></select>
        <span class="field-help">Guides automatic placement while still respecting manual machine choices.</span>
      </label>
      ${settingField("ESD clean time (minutes)", "esdMinutes", "number", s.changeovers.esdMinutes, "Added when the grade changes between batches.")}
      ${settingField("Black / white switch time (minutes)", "blackWhiteMinutes", "number", s.changeovers.blackWhiteMinutes, "Added only when R2 switches between black and white.")}
    </div>
    <div class="settings-block">
      <h2>Customers</h2>
      <div class="note">Customer names are the buyer/location labels used on order forms and schedule blocks.</div>
      ${renderCustomerEditor()}
    </div>
    <div class="settings-block">
      <h2>Reactors</h2>
      ${s.reactors.map((reactor, index) => `
        <div class="settings-row">
          <label>Name<input name="reactor-${index}-name" value="${escapeAttr(reactor.name)}"></label>
          <label>Enabled<select name="reactor-${index}-enabled"><option value="true" ${reactor.enabled ? "selected" : ""}>true</option><option value="false" ${!reactor.enabled ? "selected" : ""}>false</option></select></label>
          <label>Staffed Shifts<input name="reactor-${index}-shifts" value="${reactor.staffedShifts.join(",")}"></label>
          <label>Colors<input name="reactor-${index}-colors" value="${reactor.id === "R3" ? "black" : escapeAttr(reactor.colors.join(","))}" ${reactor.id === "R3" ? "readonly" : ""}></label>
          <label>Grades<input name="reactor-${index}-grades" value="${reactor.grades.join(",")}"></label>
          <label>Sizes<input name="reactor-${index}-sizes" value="${reactor.sizes.join(",")}"></label>
        </div>
      `).join("")}
    </div>
    <div class="settings-block">
      <h2>Reactor Exclusion Rules</h2>
      <div class="note">Use these when a customer, size, color, or grade is not allowed on a reactor. "Any" means the rule applies broadly.</div>
      ${renderExclusionEditor(s.reactorExclusions || [], s.reactors.filter((reactor) => reactor.id !== "R3"), "reactor")}
    </div>
    <div class="settings-block">
      <h2>Yield Table</h2>
      <div class="note">Standard sizes are measured by batches per truck. Small-batch sizes are measured directly by bags per batch.</div>
      ${renderYieldTable(s.sizes || [], s.truckBags)}
    </div>
    <button type="submit">Save Settings</button>
  `;
}

function renderExpanderSettings() {
  const s = state.expanderSettings;
  els.expanderSettingsForm.innerHTML = `
    <div class="settings-row">
      ${settingField("Week start", "weekStart", "date", s.weekStart, "First day shown on the expander schedule.")}
      ${settingField("Day start time", "dayStartTime", "time", s.dayStartTime || "07:10", "Wall-clock time that schedule minute zero maps to.")}
      <label>Days per week
        <select name="daysPerWeek">${[4,5,6,7].map((d) => `<option value="${d}" ${Number(s.daysPerWeek) === d ? "selected" : ""}>${d} days</option>`).join("")}</select>
        <span class="field-help">Production days available this week.</span>
      </label>
      ${settingField("Minutes per day", "minutesPerDay", "number", s.minutesPerDay, "Total wall-clock minutes in a production day.")}
      ${settingField("Shift length (minutes)", "shiftLength", "number", s.shiftLength, "Length of one staffed shift.")}
      ${settingField("Bags per truck", "truckBags", "number", s.truckBags, "Used to convert bulk / FTL orders into bag-equivalent quantities.")}
      ${settingField("Production lead time (days)", "productionLeadDays", "number", s.productionLeadDays ?? 2, "Batches must finish this many days before delivery.")}
      ${settingField("Efficiency %", "efficiency", "number", s.efficiency.globalPercent, "Lowers or raises planned batch times to match real output.")}
      ${settingField("Color flip time (minutes)", "colorFlipMinutes", "number", s.colorFlipMinutes, "How long Expander 2 loses when switching between black and white.")}
      ${settingField("Size changeover time (minutes)", "sizeChangeoverMinutes", "number", s.sizeChangeoverMinutes, "Optional time added when output size changes.")}
      ${settingField("White warning threshold %", "whiteCapacityThreshold", "number", s.whiteCapacityThreshold, "Warns when white demand consumes this share of Expander 2 capacity.")}
      ${settingField("R3 feed ratio", "r3FeedRatio", "number", s.r3FeedRatio, "Expander batches supported by one R3 batch.", "0.1")}
      ${settingField("Base input kg", "baseInputKg", "number", s.baseInputKg, "Size-22 base loaded into one expander batch. Informational only.")}
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
      <h2>Expander Exclusion Rules</h2>
      <div class="note">Use these when a size, customer, color, or grade is not allowed on an expander. "Any" means the rule applies broadly.</div>
      ${renderExclusionEditor(s.exclusions || [], s.expanders, "expander")}
    </div>
    <div class="settings-block">
      <h2>Expander Size Table</h2>
      <div class="note">Batch time is per output size. Bags per batch is shown from the current truckload yield.</div>
      ${renderExpanderSizeTable(s.sizes || [], s.truckBags)}
    </div>
    <button type="submit">Save Expander Settings</button>
  `;
}

function settingField(label, name, type, value, help, step = "1") {
  return `<label>${label}<input name="${name}" type="${type}" ${type === "number" ? `step="${step}"` : ""} value="${escapeAttr(value)}"><span class="field-help">${help}</span></label>`;
}

function renderCustomerEditor() {
  return `
    <div class="friendly-table-wrap">
      <table class="friendly-table">
        <thead><tr><th>Company</th><th>Locations</th><th></th></tr></thead>
        <tbody>
          ${state.customers.map((entry, index) => `
            <tr>
              <td><input name="customer-${index}-company" value="${escapeAttr(entry.company)}"></td>
              <td><input name="customer-${index}-locations" value="${escapeAttr(entry.locations.join(", "))}" placeholder="OH, MI, KY"></td>
              <td><button class="danger" data-action="remove-customer" data-index="${index}" type="button">Remove Company</button></td>
            </tr>
          `).join("") || `<tr><td colspan="3">No companies yet. Add one from an order form or below.</td></tr>`}
        </tbody>
      </table>
    </div>
    <details class="add-form">
      <summary>Add Company</summary>
      <div class="settings-row">
        <label>Company<input name="newCustomerCompany" placeholder="Ventek"></label>
        <label>Locations<input name="newCustomerLocations" placeholder="OH, MI, KY"></label>
      </div>
      <button class="secondary" data-action="add-customer" type="button">Add Company</button>
    </details>
  `;
}

function renderYieldTable(rows, truckBags) {
  return `
    <div class="friendly-table-wrap">
      <table class="friendly-table">
        <thead><tr><th>Size</th><th>Type</th><th>Color options</th><th>How it's measured</th><th>Number</th><th>Bags per batch</th><th></th></tr></thead>
        <tbody>
          ${rows.map((row, index) => {
            const truckFillable = (row.truckFillable ?? row.truck_fillable) !== false;
            const number = truckFillable ? Number(row.batchesPerTruck ?? row.batches_per_truck ?? "") : Number(row.bagsPerBatch ?? row.bags_per_batch ?? "");
            const derived = truckFillable && number > 0 ? `≈ ${round(Number(truckBags) / number)} bags per batch` : truckFillable ? "Enter batches per truck" : "Used directly";
            return `<tr>
              <td><input name="size-${index}-size" type="number" step="0.1" value="${escapeAttr(row.size)}"></td>
              <td><select name="size-${index}-type"><option value="standard" ${truckFillable ? "selected" : ""}>Standard</option><option value="small" ${!truckFillable ? "selected" : ""}>Small-batch</option></select></td>
              <td><input name="size-${index}-colors" value="${escapeAttr((row.colors || []).join(", "))}" placeholder="black, white"></td>
              <td>${truckFillable ? "Batches per truck" : "Bags per batch"}</td>
              <td><input name="size-${index}-number" type="number" min="0" step="0.01" value="${number || ""}" placeholder="Enter a number greater than 0"></td>
              <td><span class="helper-pill">${escapeHtml(derived)}</span></td>
              <td><button class="danger" data-action="remove-size" data-index="${index}" type="button">Remove</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <details class="add-form">
      <summary>Add Size</summary>
      <div class="settings-row">
        <label>Size<input name="newSizeSize" type="number" step="0.1"></label>
        <label>Type<select name="newSizeType"><option value="standard">Standard</option><option value="small">Small-batch</option></select></label>
        <label>Number<input name="newSizeNumber" type="number" min="0" step="0.01" placeholder="Enter a number greater than 0"></label>
        <label>Color options<input name="newSizeColors" placeholder="black, white"></label>
      </div>
      <button class="secondary" data-action="add-size" type="button">Add Size</button>
    </details>
  `;
}

function renderExpanderSizeTable(rows, truckBags) {
  return `
    <div class="friendly-table-wrap">
      <table class="friendly-table">
        <thead><tr><th>Size</th><th>Batch time</th><th>Batches per truck</th><th>Bags per batch</th><th>Base input</th><th></th></tr></thead>
        <tbody>
          ${rows.map((row, index) => {
            const batchesPerTruck = Number(row.batchesPerTruck ?? row.batches_per_truck ?? "");
            const bags = Number(row.bagsPerBatch ?? row.bags_per_batch) || (batchesPerTruck ? Number(truckBags) / batchesPerTruck : 0);
            return `<tr>
              <td><input name="exp-size-${index}-size" value="${escapeAttr(row.size)}"></td>
              <td><input name="exp-size-${index}-batchMinutes" type="number" min="0" step="0.1" value="${escapeAttr(row.batchMinutes)}"></td>
              <td><input name="exp-size-${index}-batchesPerTruck" type="number" min="0" step="0.01" value="${batchesPerTruck || ""}"></td>
              <td><span class="helper-pill">≈ ${round(bags)} bags per batch</span></td>
              <td><input name="exp-size-${index}-baseInputKg" type="number" min="0" step="1" value="${escapeAttr(row.baseInputKg || 550)}"></td>
              <td><button class="danger" data-action="remove-expander-size" data-index="${index}" type="button">Remove</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <details class="add-form">
      <summary>Add Expander Size</summary>
      <div class="settings-row">
        <label>Size<input name="newExpanderSize" placeholder="60X"></label>
        <label>Batch time<input name="newExpanderBatchMinutes" type="number" min="0" step="0.1"></label>
        <label>Batches per truck<input name="newExpanderBatchesPerTruck" type="number" min="0" step="0.01"></label>
        <label>Base input kg<input name="newExpanderBaseInputKg" type="number" min="0" step="1" value="550"></label>
      </div>
      <button class="secondary" data-action="add-expander-size" type="button">Add Expander Size</button>
    </details>
  `;
}

function renderExclusionEditor(rows, machines, kind) {
  return `
    <div class="rule-list">
      ${rows.map((row, index) => `
        <details class="rule-card">
          <summary>
            <span>${escapeHtml(exclusionSentence(row, kind))}</span>
            <span class="rule-actions"><button class="secondary" type="button">Edit</button><button class="danger" data-action="remove-${kind}-exclusion" data-index="${index}" type="button">Remove</button></span>
          </summary>
          <div class="settings-row">
            ${exclusionControls(row, machines, kind, index)}
          </div>
        </details>
      `).join("") || `<p class="empty-note">No rules yet.</p>`}
    </div>
    <details class="add-form">
      <summary>Add Rule</summary>
      <div class="settings-row">
        ${exclusionControls({}, machines, kind, "new")}
      </div>
      <p class="note">This will block: <span data-preview="${kind}">${escapeHtml(exclusionSentence({ [kind]: machines[0]?.id || "" }, kind))}</span></p>
      <button class="secondary" data-action="add-${kind}-exclusion" type="button">Add Rule</button>
    </details>
  `;
}

function exclusionControls(row, machines, kind, index) {
  const prefix = `${kind}-rule-${index}`;
  const machineValue = row[kind] || machines[0]?.id || "";
  const company = row.company || row.customer || "";
  return `
    <label>Company<select name="${prefix}-company">${option("", "Any", !company)}${companyOptions(company)}</select></label>
    <label>Location<select name="${prefix}-location">${option("", "Any", !row.location)}${locationOptions(company, row.location)}</select></label>
    <label>Size<select name="${prefix}-size">${option("", "Any", !row.size)}${sizeOptions(kind, row.size)}</select></label>
    <label>Color<select name="${prefix}-color">${option("", "Any", !row.color)}${["black", "white", "green", "yellow"].map((color) => option(color, title(color), row.color === color)).join("")}</select></label>
    <label>Grade<input name="${prefix}-grade" value="${escapeAttr(row.grade || "")}" placeholder="Any"></label>
    <label>Cannot run on<select name="${prefix}-machine">${machines.map((machine) => option(machine.id, machine.name || machine.id, machineValue === machine.id)).join("")}</select></label>
  `;
}

function option(value, label, selected = false) {
  return `<option value="${escapeAttr(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function knownOptions(field, selectedValue = "") {
  const values = new Set();
  if (field === "customer") state.customers.forEach((customer) => values.add(customer));
  else [...state.orders, ...state.expanderOrders].forEach((order) => {
    if (order[field]) values.add(String(order[field]));
  });
  [...(state.settings.reactorExclusions || []), ...(state.expanderSettings.exclusions || [])].forEach((rule) => {
    if (rule[field]) values.add(String(rule[field]));
  });
  if (selectedValue) values.add(String(selectedValue));
  return [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => option(value, value, String(selectedValue || "") === value))
    .join("");
}

function companyOptions(selectedValue = "") {
  return state.customers
    .map((entry) => option(entry.company, entry.company, String(selectedValue || "") === entry.company))
    .join("");
}

function locationOptions(company, selectedValue = "") {
  const entry = customerCompany(company);
  const values = new Set(company ? entry?.locations || [] : state.customers.flatMap((customer) => customer.locations));
  if (selectedValue) values.add(String(selectedValue));
  return [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((location) => option(location, location, String(selectedValue || "") === location))
    .join("");
}

function sizeOptions(kind, selectedValue = "") {
  const rows = kind === "reactor" ? state.settings.sizes : state.expanderSettings.sizes;
  const values = new Set(rows.map((row) => String(row.size)));
  if (selectedValue) values.add(String(selectedValue));
  return [...values]
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((value) => option(value, value, String(selectedValue || "") === value))
    .join("");
}

function exclusionSentence(row, kind) {
  const pieces = [];
  const company = row.company || row.customer || "";
  if (company) pieces.push(customerLabel(company, row.location));
  if (row.size) pieces.push(`size-${row.size}`);
  if (row.color) pieces.push(title(row.color));
  if (row.grade) pieces.push(`${row.grade} grade`);
  const subject = pieces.length ? pieces.join(" ") : "Any matching order";
  return `${subject} cannot run on ${machineLabel(row[kind], kind)}`;
}

function machineLabel(id, kind) {
  const machines = kind === "reactor" ? state.settings.reactors : state.expanderSettings.expanders;
  const found = machines.find((machine) => machine.id === id);
  return found?.name || id || "the selected machine";
}

function title(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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
      <p>Enter the customer, size, color, quantity, order type, and due date. Use the preferred machine field only when you want to force a fit check or manual assignment.</p>
      <ul>
        <li><strong>Customer:</strong> used for labels and routing rules like Cambro size-20.</li>
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
      <p>Save a backup regularly because data is stored in this browser. The backup file is how you restore the app if browser data is cleared.</p>
      <table class="guide-table">
        <thead><tr><th>Expander Size</th><th>Batch Time</th><th>Batches / FTL</th><th>Bags / Batch</th></tr></thead>
        <tbody>${expanderBatchRows}</tbody>
      </table>
    </details>

    <details>
      <summary>7. Limitations</summary>
      <p>This is a planning aid, not a control system. It assumes machines run as configured and Settings are accurate.</p>
      <p>It does not track silo inventory, import orders automatically, or coordinate multiple users. It is designed for one user in one browser with backup files for protection.</p>
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
    colors: reactor.id === "R3" ? ["black"] : csv(form.get(`reactor-${index}-colors`)),
    grades: csv(form.get(`reactor-${index}-grades`)),
    sizes: csv(form.get(`reactor-${index}-sizes`)).map((value) => value === "*" ? value : Number(value))
  }));
  const sizes = state.settings.sizes.map((row, index) => {
    const truckFillable = form.get(`size-${index}-type`) === "standard";
    const number = Number(form.get(`size-${index}-number`));
    const bagsPerBatch = truckFillable ? (number > 0 ? Number(form.get("truckBags")) / number : null) : (number > 0 ? number : null);
    return {
      ...row,
      size: Number(form.get(`size-${index}-size`)),
      family: truckFillable ? "HBS" : "HBR",
      colors: csv(form.get(`size-${index}-colors`)),
      truckFillable,
      truck_fillable: truckFillable,
      batchesPerTruck: truckFillable && number > 0 ? number : null,
      batches_per_truck: truckFillable && number > 0 ? number : null,
      bagsPerBatch,
      bags_per_batch: bagsPerBatch
    };
  });
  const reactorExclusions = state.settings.reactorExclusions.map((_, index) => readRule(form, "reactor", index));
  return {
    ...state.settings,
    weekStart: form.get("weekStart"),
    dayStartTime: form.get("dayStartTime") || "07:10",
    batchMinutes: Number(form.get("batchMinutes")),
    realisticBatchesPerDay: Number(form.get("realisticBatchesPerDay") || 7.5),
    waterBatch: form.get("waterBatch") === "true",
    waterBatchMinutes: Number(form.get("waterBatchMinutes") || 120),
    daysPerWeek: Number(form.get("daysPerWeek")),
    minutesPerDay: Number(form.get("minutesPerDay")),
    shiftLength: Number(form.get("shiftLength")),
    truckBags: Number(form.get("truckBags")),
    productionLeadDays: Number(form.get("productionLeadDays") || 1),
    screenshotWorkerUrl: (form.get("screenshotWorkerUrl") || "").trim(),
    expanderThreshold: Number(form.get("expanderThreshold")),
    combineSameSpec: form.get("combineSameSpec") === "true",
    autoColorAllocation: form.get("autoColorAllocation") === "true",
    changeovers: {
      esdMinutes: Number(form.get("esdMinutes")),
      blackWhiteMinutes: Number(form.get("blackWhiteMinutes"))
    },
    reactors,
    reactorExclusions: normalizeExclusionRows(reactorExclusions),
    sizes: normalizeSizeRows(sizes, Number(form.get("truckBags")))
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
  const sizes = state.expanderSettings.sizes.map((row, index) => {
    const batchesPerTruck = Number(form.get(`exp-size-${index}-batchesPerTruck`));
    const bagsPerBatch = batchesPerTruck > 0 ? truckBags / batchesPerTruck : null;
    return {
      ...row,
      size: form.get(`exp-size-${index}-size`),
      batchMinutes: Number(form.get(`exp-size-${index}-batchMinutes`)),
      batchesPerTruck: batchesPerTruck > 0 ? batchesPerTruck : null,
      bagsPerBatch,
      bags_per_batch: bagsPerBatch,
      baseInputKg: Number(form.get(`exp-size-${index}-baseInputKg`))
    };
  });
  const exclusions = state.expanderSettings.exclusions.map((_, index) => readRule(form, "expander", index));
  return {
    ...state.expanderSettings,
    weekStart: form.get("weekStart"),
    dayStartTime: form.get("dayStartTime") || "07:10",
    daysPerWeek: Number(form.get("daysPerWeek")),
    minutesPerDay: Number(form.get("minutesPerDay")),
    shiftLength: Number(form.get("shiftLength")),
    truckBags,
    productionLeadDays: Number(form.get("productionLeadDays") || 1),
    efficiency: { ...state.expanderSettings.efficiency, globalPercent: Number(form.get("efficiency")) },
    colorFlipMinutes: Number(form.get("colorFlipMinutes")),
    sizeChangeoverMinutes: Number(form.get("sizeChangeoverMinutes")),
    whiteCapacityThreshold: Number(form.get("whiteCapacityThreshold")),
    r3FeedRatio: Number(form.get("r3FeedRatio")),
    baseInputKg: Number(form.get("baseInputKg")),
    expanders,
    exclusions: normalizeExpanderExclusionRows(exclusions),
    sizes: normalizeExpanderSizeRows(sizes, truckBags)
  };
}

function applyCustomerSettings() {
  const form = new FormData(els.settingsForm);
  const previous = structuredClone(state.customers);
  const next = normalizeCustomerList(previous.map((entry, index) => ({
    company: form.get(`customer-${index}-company`),
    locations: csv(form.get(`customer-${index}-locations`)).map((location) => location.toUpperCase())
  })));
  previous.forEach((oldEntry, index) => {
    const newEntry = next[index];
    if (!newEntry) return;
    if (newEntry.company !== oldEntry.company) renameCompany(oldEntry.company, newEntry.company);
    oldEntry.locations.forEach((oldLocation, locationIndex) => {
      const newLocation = newEntry.locations[locationIndex];
      if (newLocation && newLocation !== oldLocation) renameLocation(newEntry.company, oldLocation, newLocation);
    });
  });
  state.customers = next;
}

function readCustomerSettingsForm() {
  const form = new FormData(els.settingsForm);
  return normalizeCustomerList(state.customers.map((_, index) => ({
    company: form.get(`customer-${index}-company`),
    locations: csv(form.get(`customer-${index}-locations`)).map((location) => location.toUpperCase())
  })));
}

function renameCompany(oldCompany, newCompany) {
  const updateOrder = (order) => order.company === oldCompany
    ? { ...order, company: newCompany, customer: customerLabel(newCompany, order.location) }
    : order;
  state.orders = state.orders.map(updateOrder);
  state.expanderOrders = state.expanderOrders.map(updateOrder);
  state.settings.reactorExclusions = state.settings.reactorExclusions.map((rule) => (rule.company || rule.customer) === oldCompany
    ? { ...rule, company: newCompany, customer: newCompany }
    : rule);
  state.expanderSettings.exclusions = state.expanderSettings.exclusions.map((rule) => (rule.company || rule.customer) === oldCompany
    ? { ...rule, company: newCompany, customer: newCompany }
    : rule);
}

function renameLocation(company, oldLocation, newLocation) {
  const updateOrder = (order) => order.company === company && order.location === oldLocation
    ? { ...order, location: newLocation, customer: customerLabel(company, newLocation) }
    : order;
  state.orders = state.orders.map(updateOrder);
  state.expanderOrders = state.expanderOrders.map(updateOrder);
  state.settings.reactorExclusions = state.settings.reactorExclusions.map((rule) => (rule.company || rule.customer) === company && rule.location === oldLocation
    ? { ...rule, location: newLocation }
    : rule);
  state.expanderSettings.exclusions = state.expanderSettings.exclusions.map((rule) => (rule.company || rule.customer) === company && rule.location === oldLocation
    ? { ...rule, location: newLocation }
    : rule);
}

function handleSettingsButton(event, kind) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, index } = button.dataset;
  if (kind === "reactor") {
    if (action === "remove-customer") {
      if (!confirm("Remove this customer from the dropdown list? Existing orders will keep their customer name.")) return;
      applyCustomerSettings();
      state.customers.splice(Number(index), 1);
      saveAndRender();
    }
    if (action === "add-customer") {
      const form = new FormData(els.settingsForm);
      const company = String(form.get("newCustomerCompany") || "").trim();
      if (!company) {
        alert("Enter a company name.");
        return;
      }
      applyCustomerSettings();
      state.customers = normalizeCustomerList([...state.customers, {
        company,
        locations: csv(form.get("newCustomerLocations")).map((location) => location.toUpperCase())
      }]);
      saveAndRender();
    }
    if (action === "remove-size") {
      if (!confirm("Remove this size from the yield table?")) return;
      state.settings = readSettingsForm();
      state.settings.sizes.splice(Number(index), 1);
      saveAndRender();
    }
    if (action === "add-size") {
      const form = new FormData(els.settingsForm);
      const size = Number(form.get("newSizeSize"));
      const number = Number(form.get("newSizeNumber"));
      if (!size || number <= 0) {
        alert("Enter a size and a number greater than 0.");
        return;
      }
      state.settings = readSettingsForm();
      const truckFillable = form.get("newSizeType") === "standard";
      state.settings.sizes.push(newYieldRow(size, truckFillable, number, csv(form.get("newSizeColors")), state.settings.truckBags));
      saveAndRender();
    }
    if (action === "remove-reactor-exclusion") {
      if (!confirm("Remove this rule?")) return;
      state.settings = readSettingsForm();
      state.settings.reactorExclusions.splice(Number(index), 1);
      saveAndRender();
    }
    if (action === "add-reactor-exclusion") {
      state.settings = readSettingsForm();
      state.settings.reactorExclusions.push(readRule(new FormData(els.settingsForm), "reactor", "new"));
      saveAndRender();
    }
  }
  if (kind === "expander") {
    if (action === "remove-expander-size") {
      if (!confirm("Remove this expander size?")) return;
      state.expanderSettings = readExpanderSettingsForm();
      state.expanderSettings.sizes.splice(Number(index), 1);
      saveAndRender();
    }
    if (action === "add-expander-size") {
      const form = new FormData(els.expanderSettingsForm);
      const size = String(form.get("newExpanderSize") || "").trim().toUpperCase();
      const batchMinutes = Number(form.get("newExpanderBatchMinutes"));
      const batchesPerTruck = Number(form.get("newExpanderBatchesPerTruck"));
      if (!size || batchMinutes <= 0 || batchesPerTruck <= 0) {
        alert("Enter a size, batch time, and batches per truck greater than 0.");
        return;
      }
      state.expanderSettings = readExpanderSettingsForm();
      state.expanderSettings.sizes.push({
        id: size,
        size,
        batchMinutes,
        batchesPerTruck,
        bagsPerBatch: state.expanderSettings.truckBags / batchesPerTruck,
        baseInputKg: Number(form.get("newExpanderBaseInputKg")) || 550
      });
      saveAndRender();
    }
    if (action === "remove-expander-exclusion") {
      if (!confirm("Remove this rule?")) return;
      state.expanderSettings = readExpanderSettingsForm();
      state.expanderSettings.exclusions.splice(Number(index), 1);
      saveAndRender();
    }
    if (action === "add-expander-exclusion") {
      state.expanderSettings = readExpanderSettingsForm();
      state.expanderSettings.exclusions.push(readRule(new FormData(els.expanderSettingsForm), "expander", "new"));
      saveAndRender();
    }
  }
}

function newYieldRow(size, truckFillable, number, colors, truckBags) {
  const bagsPerBatch = truckFillable ? truckBags / number : number;
  const family = truckFillable ? "HBS" : "HBR";
  return {
    id: `${size}-${family}`,
    size,
    family,
    colors,
    truckFillable,
    truck_fillable: truckFillable,
    batchesPerTruck: truckFillable ? number : null,
    batches_per_truck: truckFillable ? number : null,
    bagsPerBatch,
    bags_per_batch: bagsPerBatch,
    expanded: false,
    expanderBaseSize: 22
  };
}

function readRule(form, kind, index) {
  const prefix = `${kind}-rule-${index}`;
  const machine = form.get(`${prefix}-machine`);
  const company = form.get(`${prefix}-company`) || "";
  const location = form.get(`${prefix}-location`) || "";
  return {
    company,
    location,
    customer: company,
    productCode: "",
    size: form.get(`${prefix}-size`) || "",
    grade: form.get(`${prefix}-grade`) || "",
    color: form.get(`${prefix}-color`) || "",
    [kind]: machine || "",
    note: ""
  };
}

function updateRulePreviews(kind) {
  const formEl = kind === "reactor" ? els.settingsForm : els.expanderSettingsForm;
  const preview = formEl.querySelector(`[data-preview="${kind}"]`);
  if (!preview) return;
  preview.textContent = exclusionSentence(readRule(new FormData(formEl), kind, "new"), kind);
}

function showFitResult(result, el, settings = state.settings) {
  if (result.status === "expander") {
    el.textContent = result.message;
    el.className = "result warn";
    return;
  }
  el.textContent = fitText(result, settings);
  el.className = `result ${result.fits ? "ok" : "warn"}`;
}

function fitText(result, settings = state.settings) {
  if (result.message) return `${result.fits ? "Fits" : "Does not fit"}: ${result.message}`;
  const completion = result.completion === null ? "not scheduled" : fmt(minutesToDate(settings.weekStart, result.completion, settings));
  const reactors = result.reactors?.length ? result.reactors.join(", ") : "none";
  let text = `${result.fits ? "Fits" : "Does not fit"}: ${result.batches} batches, completion ${completion}, produce by ${formatDateValue(result.produceByDate)}, deliver ${formatDateValue(result.deliveryDate)}, reactor(s) ${reactors}.`;
  if (result.displaced?.length) {
    const names = [...new Set(result.displaced.map((b) => b.customer || b.orderId))].join(", ");
    text += ` Adding this would displace: ${names}.`;
  }
  if (result.overcommittedDays?.length) {
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const days = result.overcommittedDays.map((d) => `${dayNames[d.day] || `Day ${d.day + 1}`} (${d.reactorId}: ${d.batchesInDay}/${d.capacity} batches)`).join(", ");
    text += ` Overcommitted: ${days}.`;
  }
  return text;
}

function showExpanderFitResult(result, el, settings = state.expanderSettings) {
  el.textContent = expanderFitText(result, settings);
  el.className = `result ${result.fits ? "ok" : "warn"}`;
}

function expanderFitText(result, settings = state.expanderSettings) {
  if (result.message) return `${result.fits ? "Fits" : "Does not fit"}: ${result.message}`;
  const completion = result.completion === null ? "not scheduled" : fmt(expanderMinutesToDate(settings.weekStart, result.completion, settings));
  const expanders = result.expanders?.length ? result.expanders.join(", ") : "none";
  return `${result.fits ? "Fits" : "Does not fit"}: ${result.batches} batches, completion ${completion}, produce by ${formatDateValue(result.produceByDate)}, deliver ${formatDateValue(result.deliveryDate)}, expander(s) ${expanders}.`;
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

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function abbreviatedEventLabel(event) {
  const customer = customerLabel(event.company, event.location) || abbreviateCustomer(event.customer);
  const size = String(event.size || "").toUpperCase();
  const color = normalizeLabelColor(event.color);
  return [size, customer, color].filter(Boolean).join(" ");
}

function abbreviateCustomer(value) {
  const text = String(value || "").trim();
  if (!text) return "Order";
  return text;
}

function normalizeLabelColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (color === "black") return "BK";
  if (color === "white") return "WH";
  return color ? color.slice(0, 3).toUpperCase() : "";
}

function fmt(date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatDateValue(value) {
  if (!value) return "not set";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatDayLabel(value) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(value);
}

function dateAxisLabels(weekStart, days, dayStartTime = "00:00") {
  const [h, m] = String(dayStartTime || "00:00").split(":").map(Number);
  const base = new Date(`${weekStart}T00:00:00`);
  base.setHours(h, m, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(base);
    date.setDate(base.getDate() + index);
    return `<span>${escapeHtml(formatDayLabel(date))}</span>`;
  }).join("");
}

function formatRange(event, settings = state.settings) {
  return `${fmt(minutesToDate(settings.weekStart, event.start, settings))} - ${fmt(minutesToDate(settings.weekStart, event.end, settings))}`;
}

function formatExpanderRange(event, settings = state.expanderSettings) {
  return `${fmt(expanderMinutesToDate(settings.weekStart, event.start, settings))} - ${fmt(expanderMinutesToDate(settings.weekStart, event.end, settings))}`;
}

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeCustomerList(entries) {
  const byCompany = new Map();
  entries.forEach((entry) => {
    const company = String(entry.company || "").trim();
    if (!company) return;
    if (!byCompany.has(company)) byCompany.set(company, new Set());
    (entry.locations || []).forEach((location) => {
      const value = String(location || "").trim().toUpperCase();
      if (value) byCompany.get(company).add(value);
    });
  });
  return [...byCompany.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([company, locations]) => ({
      company,
      locations: [...locations].sort((a, b) => a.localeCompare(b))
    }));
}

function customerCompany(company) {
  return state.customers.find((entry) => entry.company === company);
}

function customerLabel(company, location) {
  return [company, location].filter(Boolean).join(" ");
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
  input.value = localDateTimeValue(due);
}

function setDefaultExpanderDueDate() {
  const input = els.expanderOrderForm.querySelector('[name="dueDate"]');
  const due = new Date();
  due.setDate(due.getDate() + 2);
  due.setHours(16, 0, 0, 0);
  input.value = localDateTimeValue(due);
}

function localDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setDefaultOrderForm() {
  els.orderForm.querySelector('[name="orderType"]').value = "bulk";
  els.orderForm.querySelector('[name="color"]').value = "black";
  els.orderForm.querySelector('[name="trucks"]').value = "1";
  els.orderForm.querySelector('[name="quantityBags"]').value = "1";
}

function setDefaultExpanderOrderForm() {
  els.expanderOrderForm.querySelector('[name="orderType"]').value = "bulk";
  els.expanderOrderForm.querySelector('[name="quantity"]').value = "1";
  els.expanderOrderForm.querySelector('[name="color"]').value = "black";
}

function syncOrderFormHints() {
  const form = new FormData(els.orderForm);
  const order = {
    productCode: "",
    family: form.get("family"),
    size: Number(form.get("size")),
    expanded: undefined
  };
  const expandedInput = els.orderForm.querySelector('[name="expanded"]');
  const truckInput = els.orderForm.querySelector('[name="trucks"]');
  const bagInput = els.orderForm.querySelector('[name="quantityBags"]');
  const orderTypeInput = els.orderForm.querySelector('[name="orderType"]');
  const bulkOption = orderTypeInput.querySelector('option[value="bulk"]');
  const trucksField = document.querySelector("#trucksField");
  const bagQuantityField = document.querySelector("#bagQuantityField");
  expandedInput.checked = defaultExpandedForOrder(order, state.settings);
  const truckFillable = isTruckFillable(state.settings, order.size, order.family);
  if (!truckFillable && orderTypeInput.value === "bulk") orderTypeInput.value = "bag";
  bulkOption.disabled = !truckFillable;
  const isBulk = truckFillable && orderTypeInput.value === "bulk";
  trucksField.classList.toggle("hidden", !isBulk);
  bagQuantityField.classList.toggle("hidden", isBulk);
  truckInput.disabled = !isBulk;
  bagInput.disabled = isBulk;
  truckInput.required = isBulk;
  bagInput.required = !isBulk;
  if (!truckFillable) truckInput.value = "";
}

function validateReactorOrderQuantity() {
  syncOrderFormHints();
  const form = new FormData(els.orderForm);
  const orderType = form.get("orderType");
  const field = orderType === "bulk" ? "trucks" : "quantityBags";
  return validateQuantity(els.orderForm, field, els.fitResult);
}

function validateCustomerSelection(formEl, resultEl) {
  const input = formEl.querySelector('[name="company"]');
  if (!input || (input.value && input.value !== ADD_COMPANY_VALUE)) return true;
  input.setCustomValidity("Select a customer");
  input.reportValidity();
  input.setCustomValidity("");
  resultEl.textContent = "Select a customer";
  resultEl.className = "result warn";
  return false;
}

function validateQuantity(formEl, name, resultEl) {
  const input = formEl.querySelector(`[name="${name}"]`);
  if (!input || input.disabled) return true;
  if (Number(input.value) >= 1) return true;
  input.setCustomValidity("Quantity must be at least 1");
  input.reportValidity();
  input.setCustomValidity("");
  showQuantityError(resultEl);
  return false;
}

function showQuantityError(resultEl) {
  resultEl.textContent = "Quantity must be at least 1";
  resultEl.className = "result warn";
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
    company: row.company || row.customer || "",
    location: row.location || "",
    customer: row.company || row.customer || "",
    productCode: "",
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
    company: row.company || row.customer || "",
    location: row.location || "",
    customer: row.company || row.customer || "",
    productCode: "",
    size: row.size ? String(row.size).toUpperCase() : "",
    grade: row.grade || "",
    color: row.color || "",
    expander: row.expander || "",
    note: row.note || ""
  })).filter((row) => row.expander);
}
