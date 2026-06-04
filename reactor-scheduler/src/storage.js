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
    reactors: incoming.settings?.reactors || base.settings.reactors,
    reactorExclusions: incoming.settings?.reactorExclusions || base.settings.reactorExclusions,
    sizes: normalizeSizeRows(incoming.settings?.sizes || base.settings.sizes, incoming.settings?.truckBags || base.settings.truckBags)
  };
  return {
    ...base,
    ...incoming,
    settings,
    orders: incoming.orders || base.orders,
    loadedBatchIds: incoming.loadedBatchIds || base.loadedBatchIds
  };
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
