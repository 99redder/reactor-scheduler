export const STORAGE_KEY = "reactor-scheduler-v1";

export function defaultSettings() {
  return {
    weekStart: defaultWeekStart(),
    batchMinutes: 180,
    daysPerWeek: 6,
    minutesPerDay: 1440,
    shiftLength: 480,
    truckBags: 52,
    expanderThreshold: 30,
    combineSameSpec: false,
    autoColorAllocation: true,
    changeovers: {
      esdMinutes: 45,
      blackWhiteMinutes: 540
    },
    reactorExclusions: [
      { customer: "Cambro", productCode: "", size: 20, family: "", grade: "", color: "", reactor: "R2", note: "Cambro size-20 barred from R2" }
    ],
    sizes: [
      { id: "13.5-HBS", size: 13.5, family: "HBS", truckFillable: true, truck_fillable: true, batchesPerTruck: 9, batches_per_truck: 9, bagsPerBatch: 52 / 9, bags_per_batch: 52 / 9, expanded: false, expanderBaseSize: 22 },
      { id: "15-HBS", size: 15, family: "HBS", truckFillable: true, truck_fillable: true, batchesPerTruck: 8, batches_per_truck: 8, bagsPerBatch: 52 / 8, bags_per_batch: 52 / 8, expanded: false, expanderBaseSize: 22 },
      { id: "20-HBS", size: 20, family: "HBS", truckFillable: true, truck_fillable: true, batchesPerTruck: 6, batches_per_truck: 6, bagsPerBatch: 52 / 6, bags_per_batch: 52 / 6, expanded: false, expanderBaseSize: 22 },
      { id: "24-HBS", size: 24, family: "HBS", truckFillable: true, truck_fillable: true, batchesPerTruck: 5, batches_per_truck: 5, bagsPerBatch: 52 / 5, bags_per_batch: 52 / 5, expanded: false, expanderBaseSize: 22 },
      { id: "5-HBR", size: 5, family: "HBR", truckFillable: false, truck_fillable: false, bagsPerBatch: null, bags_per_batch: null, expanded: false, expanderBaseSize: 22 },
      { id: "6-HBR", size: 6, family: "HBR", truckFillable: false, truck_fillable: false, bagsPerBatch: null, bags_per_batch: null, expanded: false, expanderBaseSize: 22 },
      { id: "9-HBR", size: 9, family: "HBR", truckFillable: false, truck_fillable: false, bagsPerBatch: null, bags_per_batch: null, expanded: false, expanderBaseSize: 22 },
      { id: "11-HBR", size: 11, family: "HBR", truckFillable: false, truck_fillable: false, bagsPerBatch: null, bags_per_batch: null, expanded: false, expanderBaseSize: 22 },
      { id: "38X-HBS", size: 38, family: "HBS", truckFillable: true, truck_fillable: true, batchesPerTruck: 5, batches_per_truck: 5, bagsPerBatch: 52 / 5, bags_per_batch: 52 / 5, expanded: true, expanderBaseSize: 22 }
    ],
    reactors: [
      {
        id: "R1",
        name: "R1",
        enabled: true,
        batchKg: 750,
        staffedShifts: [0, 1, 2],
        mergeAdjacentWindows: true,
        sizes: ["*"],
        grades: ["standard", "ESD"],
        colors: ["black"]
      },
      {
        id: "R2",
        name: "R2",
        enabled: true,
        batchKg: 750,
        staffedShifts: [0, 2],
        mergeAdjacentWindows: true,
        sizes: ["*"],
        grades: ["standard", "ESD"],
        colors: ["white", "black"]
      },
      {
        id: "R3",
        name: "R3",
        enabled: false,
        batchKg: 1000,
        staffedShifts: [0, 1, 2],
        mergeAdjacentWindows: true,
        sizes: [22],
        grades: ["standard"],
        colors: ["black"]
      }
    ]
  };
}

function defaultWeekStart() {
  const date = new Date();
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export function defaultData() {
  return {
    settings: defaultSettings(),
    orders: [],
    customers: [],
    loadedBatchIds: [],
    expanderSettings: defaultExpanderSettings(),
    expanderOrders: [],
    loadedExpanderBatchIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function defaultExpanderSettings() {
  return {
    weekStart: defaultWeekStart(),
    daysPerWeek: 6,
    minutesPerDay: 1440,
    shiftLength: 480,
    truckBags: 52,
    efficiency: { globalPercent: 100, byShift: {} },
    colorFlipMinutes: 420,
    sizeChangeoverMinutes: 0,
    whiteCapacityThreshold: 60,
    r3FeedRatio: 2,
    baseInputKg: 550,
    expanders: [
      {
        id: "E1",
        name: "Expander 1",
        enabled: true,
        staffedShifts: [0, 1, 2],
        mergeAdjacentWindows: true,
        colors: ["black"],
        defaultColor: "black"
      },
      {
        id: "E2",
        name: "Expander 2",
        enabled: true,
        staffedShifts: [0, 1, 2],
        mergeAdjacentWindows: true,
        colors: ["black", "white"],
        defaultColor: "black"
      }
    ],
    sizes: [
      { id: "30X", size: "30X", batchMinutes: 90, batchesPerTruck: 6, bagsPerBatch: 52 / 6, baseInputKg: 550 },
      { id: "35X", size: "35X", batchMinutes: 90, batchesPerTruck: 5.5, bagsPerBatch: 52 / 5.5, baseInputKg: 550 },
      { id: "38X", size: "38X", batchMinutes: 110, batchesPerTruck: 5, bagsPerBatch: 52 / 5, baseInputKg: 550 },
      { id: "45X", size: "45X", batchMinutes: 130, batchesPerTruck: 3.5, bagsPerBatch: 52 / 3.5, baseInputKg: 550 },
      { id: "52X", size: "52X", batchMinutes: 160, batchesPerTruck: 3, bagsPerBatch: 52 / 3, baseInputKg: 550 }
    ],
    exclusions: [
      { size: "45X", color: "", customer: "", productCode: "", grade: "", expander: "E1", note: "45X cannot run on Expander 1" },
      { size: "52X", color: "", customer: "", productCode: "", grade: "", expander: "E1", note: "52X cannot run on Expander 1" }
    ]
  };
}
