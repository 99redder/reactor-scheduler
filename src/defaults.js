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
    changeovers: {
      esdMinutes: 45,
      blackWhiteMinutes: 540
    },
    sizes: [
      { id: "13.5-HBS", size: 13.5, family: "HBS", batchesPerTruck: 9, expanderRoute: false },
      { id: "15-HBS", size: 15, family: "HBS", batchesPerTruck: 8, expanderRoute: false },
      { id: "20-HBS", size: 20, family: "HBS", batchesPerTruck: 6, expanderRoute: false },
      { id: "24-HBS", size: 24, family: "HBS", batchesPerTruck: 5, expanderRoute: false },
      { id: "5-HBR", size: 5, family: "HBR", batchesPerTruck: null, expanderRoute: false },
      { id: "6-HBR", size: 6, family: "HBR", batchesPerTruck: null, expanderRoute: false },
      { id: "38-HBS", size: 38, family: "HBS", batchesPerTruck: null, expanderRoute: true }
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
        colors: ["white"]
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
        colors: ["white", "black", "green", "yellow"]
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
        colors: ["white"]
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
    loadedBatchIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
