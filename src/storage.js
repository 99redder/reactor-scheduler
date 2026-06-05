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
  const settings = {
    ...base.settings,
    ...(incoming.settings || {}),
    changeovers: {
      ...base.settings.changeovers,
      ...((incoming.settings && incoming.settings.changeovers) || {})
    },
    reactors: normalizeReactors(incoming.settings?.reactors || base.settings.reactors),
    reactorExclusions: incoming.settings?.reactorExclusions || base.settings.reactorExclusions,
    sizes: normalizeSizeRows(incoming.settings?.sizes || base.settings.sizes, incoming.settings?.truckBags || base.settings.truckBags)
  };
  const expanderSettings = {
    ...base.expanderSettings,
    ...(incoming.expanderSettings || {}),
    efficiency: {
      ...base.expanderSettings.efficiency,
      ...((incoming.expanderSettings && incoming.expanderSettings.efficiency) || {})
    },
    expanders: incoming.expanderSettings?.expanders || base.expanderSettings.expanders,
    sizes: normalizeExpanderSizeRows(incoming.expanderSettings?.sizes || base.expanderSettings.sizes, incoming.expanderSettings?.truckBags || base.expanderSettings.truckBags),
    exclusions: incoming.expanderSettings?.exclusions || base.expanderSettings.exclusions
  };
  const orders = normalizeOrders(incoming.orders || base.orders);
  const expanderOrders = normalizeOrders(incoming.expanderOrders || base.expanderOrders);
  const customers = normalizeCustomers(incoming.customers, orders, expanderOrders);
  return {
    ...base,
    ...incoming,
    settings,
    expanderSettings,
    orders,
    customers,
    loadedBatchIds: incoming.loadedBatchIds || base.loadedBatchIds,
    expanderOrders,
    loadedExpanderBatchIds: incoming.loadedExpanderBatchIds || base.loadedExpanderBatchIds
  };
}

function normalizeReactors(reactors) {
  return reactors.map((reactor) => reactor.id === "R3" ? { ...reactor, colors: ["black"] } : reactor);
}

function normalizeOrders(orders) {
  return orders.map((order) => {
    const { productCode, product, ...rest } = order;
    return { ...rest, productCode: "" };
  });
}

function normalizeCustomers(customers, orders, expanderOrders) {
  const values = new Set();
  if (Array.isArray(customers)) {
    customers.forEach((customer) => addCustomer(values, customer));
  } else {
    [...orders, ...expanderOrders].forEach((order) => addCustomer(values, order.customer));
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

function addCustomer(values, customer) {
  const name = String(customer || "").trim();
  if (name) values.add(name);
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
