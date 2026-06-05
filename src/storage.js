import { STORAGE_KEY, defaultData } from "./defaults.js";

export const dataStore = {
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    try {
      return mergeData(defaultData(), JSON.parse(raw));
    } catch {
      return defaultData();
    }
  },

  save(data) {
    const next = { ...data, updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  },

  export(data) {
    return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
  },

  import(raw) {
    const parsed = JSON.parse(raw);
    return this.save(mergeData(defaultData(), parsed));
  }
};

function mergeData(base, incoming) {
  const inSettings = incoming.settings || {};
  const settings = {
    ...base.settings,
    ...inSettings,
    dayStartTime: inSettings.dayStartTime ?? base.settings.dayStartTime,
    realisticBatchesPerDay: inSettings.realisticBatchesPerDay ?? base.settings.realisticBatchesPerDay,
    waterBatch: inSettings.waterBatch ?? base.settings.waterBatch,
    waterBatchMinutes: inSettings.waterBatchMinutes ?? base.settings.waterBatchMinutes,
    productionLeadDays: inSettings.productionLeadDays ?? base.settings.productionLeadDays,
    screenshotWorkerUrl: inSettings.screenshotWorkerUrl ?? base.settings.screenshotWorkerUrl,
    changeovers: {
      ...base.settings.changeovers,
      ...((incoming.settings && incoming.settings.changeovers) || {})
    },
    reactors: normalizeReactors(inSettings.reactors || base.settings.reactors),
    reactorExclusions: inSettings.reactorExclusions || base.settings.reactorExclusions,
    sizes: normalizeSizeRows(inSettings.sizes || base.settings.sizes, inSettings.truckBags || base.settings.truckBags)
  };
  const inExpSettings = incoming.expanderSettings || {};
  const expanderSettings = {
    ...base.expanderSettings,
    ...inExpSettings,
    dayStartTime: inExpSettings.dayStartTime ?? base.expanderSettings.dayStartTime,
    productionLeadDays: inExpSettings.productionLeadDays ?? base.expanderSettings.productionLeadDays,
    efficiency: {
      ...base.expanderSettings.efficiency,
      ...((incoming.expanderSettings && incoming.expanderSettings.efficiency) || {})
    },
    expanders: inExpSettings.expanders || base.expanderSettings.expanders,
    sizes: normalizeExpanderSizeRows(inExpSettings.sizes || base.expanderSettings.sizes, inExpSettings.truckBags || base.expanderSettings.truckBags),
    exclusions: inExpSettings.exclusions || base.expanderSettings.exclusions
  };
  const orders = normalizeOrders(incoming.orders || base.orders);
  const expanderOrders = normalizeOrders(incoming.expanderOrders || base.expanderOrders);
  const customers = normalizeCustomers(incoming.customers, orders, expanderOrders);
  return {
    ...base,
    ...incoming,
    viewWeek: incoming.viewWeek || base.viewWeek || "this",
    settings,
    expanderSettings,
    orders,
    customers,
    loadedBatchIds: incoming.loadedBatchIds || base.loadedBatchIds,
    skippedBatchIds: incoming.skippedBatchIds || base.skippedBatchIds,
    expanderOrders,
    loadedExpanderBatchIds: incoming.loadedExpanderBatchIds || base.loadedExpanderBatchIds,
    skippedExpanderBatchIds: incoming.skippedExpanderBatchIds || base.skippedExpanderBatchIds
  };
}

function normalizeReactors(reactors) {
  return reactors.map((reactor) => reactor.id === "R3" ? { ...reactor, colors: ["black"] } : reactor);
}

function normalizeOrders(orders) {
  return orders.map((order) => {
    const { productCode, product, ...rest } = order;
    const company = String(order.company || "").trim();
    const location = String(order.location || "").trim();
    const parsed = company ? { company, location } : parseCustomerName(order.customer);
    return {
      ...rest,
      company: parsed.company,
      location: parsed.location,
      customer: customerLabel(parsed.company, parsed.location),
      dueDate: rest.dueDate || defaultDueDate(),
      productCode: ""
    };
  });
}

function normalizeCustomers(customers, orders, expanderOrders) {
  const byCompany = new Map();
  if (Array.isArray(customers)) {
    customers.forEach((entry) => addCustomerEntry(byCompany, entry));
  } else {
    [...orders, ...expanderOrders].forEach((order) => addCustomerEntry(byCompany, order));
  }
  [...orders, ...expanderOrders].forEach((order) => addCustomerEntry(byCompany, order));
  return [...byCompany.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([company, locations]) => ({
      company,
      locations: [...locations].sort((a, b) => a.localeCompare(b))
    }));
}

function addCustomerEntry(byCompany, entry) {
  if (typeof entry === "string") entry = parseCustomerName(entry);
  const parsed = entry.company ? entry : parseCustomerName(entry.customer);
  const company = String(parsed.company || "").trim();
  const location = String(parsed.location || "").trim();
  if (!company) return;
  if (!byCompany.has(company)) byCompany.set(company, new Set());
  (parsed.locations || []).forEach((value) => {
    const item = String(value || "").trim();
    if (item) byCompany.get(company).add(item);
  });
  if (location) byCompany.get(company).add(location);
}

function parseCustomerName(value = "") {
  const text = String(value || "").trim();
  if (!text) return { company: "", location: "" };
  const parts = text.split(/\s+/);
  const last = parts[parts.length - 1] || "";
  if (/^[A-Z]{2}$/.test(last) && parts.length > 1) {
    return { company: parts.slice(0, -1).join(" "), location: last };
  }
  return { company: text, location: "" };
}

function customerLabel(company, location) {
  return [company, location].filter(Boolean).join(" ");
}

function defaultDueDate() {
  const due = new Date();
  due.setDate(due.getDate() + 2);
  due.setHours(16, 0, 0, 0);
  const pad = (value) => String(value).padStart(2, "0");
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}

function normalizeSizeRows(rows, truckBags) {
  return rows.map((row) => {
    const truckFillable = (row.truckFillable ?? row.truck_fillable) !== false;
    const batchesPerTruck = Number(row.batchesPerTruck ?? row.batches_per_truck) || null;
    const bagsPerBatch = Number(row.bagsPerBatch ?? row.bags_per_batch) || (truckFillable && batchesPerTruck ? Number(truckBags) / batchesPerTruck : null);
    return {
      ...row,
      truckFillable,
      truck_fillable: truckFillable,
      batchesPerTruck: truckFillable ? batchesPerTruck : null,
      batches_per_truck: truckFillable ? batchesPerTruck : null,
      bagsPerBatch,
      bags_per_batch: bagsPerBatch,
      expanded: Boolean(row.expanded ?? row.expanderRoute),
      expanderBaseSize: Number(row.expanderBaseSize || 22)
    };
  });
}

function normalizeExpanderSizeRows(rows, truckBags) {
  return rows.map((row) => {
    const batchesPerTruck = Number(row.batchesPerTruck ?? row.batches_per_truck) || null;
    const bagsPerBatch = Number(row.bagsPerBatch ?? row.bags_per_batch) || (batchesPerTruck ? Number(truckBags) / batchesPerTruck : null);
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
