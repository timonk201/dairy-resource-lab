const DATASET_SIZE = 5000;
const SEED = 20251111;
const STEP_MINUTES = 5;

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

export function makeDataset() {
  const random = createRandom(SEED);
  const start = Date.UTC(2025, 0, 1, 0, 0);
  const records = [];

  for (let index = 0; index < DATASET_SIZE; index += 1) {
    const cycle = index % 120;
    const mode = cycle < 102 ? "production" : cycle < 110 ? "standby" : "washing";
    const dailyCycle = Math.sin((index / 288) * Math.PI * 2);
    const ambientTemperature = 19 + 5 * dailyCycle + (random() - 0.5) * 2;
    const inletTemperature = 5 + random() * 2;
    const processTemperature = mode === "production"
      ? 72 + (random() - 0.5) * 1.6
      : mode === "washing" ? 65 + random() * 7 : 22 + random() * 8;
    const pressure = mode === "production" ? 2.3 + random() * 0.5 : 0.2 + random() * 0.7;
    const equipmentLoad = mode === "production" ? 66 + random() * 22 : mode === "washing" ? 25 + random() * 18 : random() * 8;
    const milkFlow = mode === "production" ? 7200 + random() * 1800 : 0;
    const output = mode === "production" ? milkFlow * STEP_MINUTES / 60 * (0.975 + random() * 0.02) : 0;
    const electricityBase = mode === "production"
      ? 5.2 + equipmentLoad * 0.053 + milkFlow * 0.00022 + (processTemperature - 72) * 0.08
      : mode === "washing" ? 5.6 + equipmentLoad * 0.055 : 1.1 + equipmentLoad * 0.08;
    const waterBase = mode === "production" ? 65 + milkFlow * 0.007 : mode === "washing" ? 290 + random() * 100 : 3;
    const deviation = index >= 4600 && index < 4608;
    const electricity = Math.max(0.1, electricityBase + (random() - 0.5) * 1.1 + (deviation ? 20 : 0));
    const water = Math.max(0, waterBase + (random() - 0.5) * (mode === "washing" ? 50 : 14));

    records.push({
      timestamp: new Date(start + index * STEP_MINUTES * 60_000).toISOString(),
      batch_id: `B-${String(Math.floor(index / 120) + 1).padStart(3, "0")}`,
      product_type: "pasteurized_milk",
      milk_flow: round(milkFlow, 1),
      inlet_temperature: round(inletTemperature, 1),
      process_temperature: round(processTemperature, 1),
      pressure: round(pressure, 2),
      equipment_load: round(equipmentLoad, 1),
      ambient_temperature: round(ambientTemperature, 1),
      operating_mode: mode,
      electricity_kwh: round(electricity, 2),
      water_l: round(water, 1),
      output_l: round(output, 1),
      downtime_min: mode === "standby" && cycle === 102 ? 5 : 0,
      anomaly: deviation
    });
  }

  return records;
}

export function featureVector(record) {
  return [
    record.milk_flow / 10_000,
    record.inlet_temperature / 10,
    record.process_temperature / 100,
    record.pressure / 5,
    record.equipment_load / 100,
    record.ambient_temperature / 50,
    record.operating_mode === "production" ? 1 : record.operating_mode === "washing" ? -1 : 0,
    record.electricity_kwh / 20,
    record.water_l / 500,
    record.output_l / 800,
    record.downtime_min / 5
  ];
}

export function temporalVector(record) {
  return [
    record.electricity_kwh / 20,
    record.water_l / 500,
    record.equipment_load / 100,
    record.process_temperature / 100
  ];
}

const requiredFields = [
  "timestamp",
  "batch_id",
  "product_type",
  "milk_flow",
  "inlet_temperature",
  "process_temperature",
  "pressure",
  "equipment_load",
  "ambient_temperature",
  "operating_mode",
  "electricity_kwh",
  "water_l",
  "output_l",
  "downtime_min",
  "anomaly"
];
const numericFields = [
  "milk_flow",
  "inlet_temperature",
  "process_temperature",
  "pressure",
  "equipment_load",
  "ambient_temperature",
  "electricity_kwh",
  "water_l",
  "output_l",
  "downtime_min"
];

export function validateDataset(records) {
  let missingValues = 0;
  let invalidTimestamps = 0;
  let duplicateTimestamps = 0;
  let outOfOrderTimestamps = 0;
  let intervalGaps = 0;
  const timestamps = new Set();
  let previousTimestamp = null;

  records.forEach((record) => {
    if (!record || typeof record !== "object") {
      missingValues += requiredFields.length;
      invalidTimestamps += 1;
      return;
    }

    for (const field of requiredFields) {
      const value = record[field];
      if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
        missingValues += 1;
      } else if (numericFields.includes(field) && !Number.isFinite(value)) {
        missingValues += 1;
      }
    }

    const timestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      invalidTimestamps += 1;
      return;
    }
    if (timestamps.has(timestamp)) duplicateTimestamps += 1;
    timestamps.add(timestamp);
    if (previousTimestamp !== null) {
      const interval = timestamp - previousTimestamp;
      if (interval <= 0) outOfOrderTimestamps += 1;
      if (interval !== STEP_MINUTES * 60_000) intervalGaps += 1;
    }
    previousTimestamp = timestamp;
  });

  return {
    valid: missingValues === 0
      && invalidTimestamps === 0
      && duplicateTimestamps === 0
      && outOfOrderTimestamps === 0
      && intervalGaps === 0,
    records: records.length,
    missingValues,
    invalidTimestamps,
    duplicateTimestamps,
    outOfOrderTimestamps,
    intervalGaps
  };
}

export const datasetInfo = {
  records: DATASET_SIZE,
  seed: SEED,
  stepMinutes: STEP_MINUTES,
  trainEnd: 3500,
  validationEnd: 4250
};
