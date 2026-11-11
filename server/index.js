import { createServer } from "node:http";
import { datasetInfo, makeDataset, validateDataset } from "./simulator.js";
import { trainModels } from "./models.js";

const PORT = Number(process.env.PORT ?? 3001);
const records = makeDataset();
const datasetQuality = validateDataset(records);
if (!datasetQuality.valid) throw new Error(`Проверка датасета не пройдена: ${JSON.stringify(datasetQuality)}`);
const split = { trainEnd: datasetInfo.trainEnd, validationEnd: datasetInfo.validationEnd };
const trained = trainModels(records, split);

function sum(rows, property) {
  return rows.reduce((total, row) => total + row[property], 0);
}

function metricRows(targetField, predict) {
  const testRecords = records.slice(split.validationEnd);
  return testRecords.map((record, offset) => ({
    timestamp: record.timestamp,
    actual: record[targetField],
    predicted: Number(predict(split.validationEnd + offset).toFixed(2)),
    anomaly: record.anomaly
  }));
}

const electricityTestSeries = metricRows("electricity_kwh", trained.predictByName.forest);
const waterTestSeries = metricRows("water_l", trained.waterPredictByName.forest);

function recentEvents() {
  const events = [];
  let runStart = -1;
  for (let index = 0; index <= records.length; index += 1) {
    if (index < records.length && records[index].anomaly && runStart < 0) runStart = index;
    if ((index === records.length || !records[index].anomaly) && runStart >= 0) {
      events.push({
        from: records[runStart].timestamp,
        to: records[index - 1].timestamp,
        count: index - runStart
      });
      runStart = -1;
    }
  }
  return events;
}

function scenarioOptions(key) {
  const calibration = records.slice(0, datasetInfo.trainEnd);
  const productionRows = calibration.filter((row) => row.operating_mode === "production" && row.output_l > 0);
  const totalOutput = sum(productionRows, "output_l");
  const energyPerLiter = sum(productionRows, "electricity_kwh") / Math.max(totalOutput, 1);
  const waterPerLiter = sum(productionRows, "water_l") / Math.max(totalOutput, 1);
  const requestedOutput = 12_000 * (key === "demand" ? 1.5 : 1);
  const availableMilk = key === "limited-supply" ? 8_000 : 18_000;
  const capacityPerLine = key === "line-down" ? 10_000 : 16_000;
  const availableLines = key === "line-down" ? 1 : 2;
  const lineCapacity = capacityPerLine * availableLines;
  const sourceOutput = Math.min(requestedOutput, availableMilk, capacityPerLine);
  const feasibleOutput = Math.min(requestedOutput, availableMilk, lineCapacity);
  const energyPrice = 30;
  const waterPricePerLiter = 0.02;
  const sourceStart = productionRows[0];
  const sourceTime = sourceStart.timestamp.slice(11, 16);
  const sourceMinute = Number(sourceTime.slice(0, 2)) * 60 + Number(sourceTime.slice(3));

  function makeSchedule(output, energy, water, lines, startAt, shiftMinutes, intervals) {
    return {
      output: Math.round(output),
      energy: Number(energy.toFixed(1)),
      water: Number(water.toFixed(1)),
      energyPerLiter: Number((energy / Math.max(output, 1)).toFixed(4)),
      waterPerLiter: Number((water / Math.max(output, 1)).toFixed(3)),
      cost: Number((energy * energyPrice + water * waterPricePerLiter).toFixed(2)),
      constraintsMet: output >= requestedOutput && output <= availableMilk && output <= lineCapacity,
      lines,
      startAt,
      shiftMinutes,
      intervals
    };
  }

  const source = makeSchedule(
    sourceOutput,
    sourceOutput * energyPerLiter,
    sourceOutput * waterPerLiter,
    1,
    sourceTime,
    0,
    Math.ceil(sourceOutput / (totalOutput / productionRows.length))
  );

  let recommended = null;
  const lineCounts = availableLines === 1 ? [1] : [1, 2];
  for (const lines of lineCounts) {
    if (feasibleOutput > capacityPerLine * lines) continue;
    for (let startIndex = 0; startIndex < calibration.length; startIndex += 1) {
      if (calibration[startIndex].operating_mode !== "production") continue;
      let output = 0;
      let energy = 0;
      let water = 0;
      let intervals = 0;
      for (let index = startIndex; index < calibration.length && output < feasibleOutput; index += 1) {
        const row = calibration[index];
        if (row.operating_mode !== "production") break;
        const intervalCapacity = row.output_l * lines;
        const intervalOutput = Math.min(intervalCapacity, feasibleOutput - output);
        const fractionPerLine = intervalOutput / intervalCapacity;
        output += intervalOutput;
        energy += row.electricity_kwh * fractionPerLine * lines;
        water += row.water_l * fractionPerLine * lines;
        intervals += 1;
      }
      if (output < feasibleOutput) continue;

      const startAt = calibration[startIndex].timestamp.slice(11, 16);
      const startMinute = Number(startAt.slice(0, 2)) * 60 + Number(startAt.slice(3));
      const rawShift = (startMinute - sourceMinute + 1440) % 1440;
      const shiftMinutes = rawShift > 720 ? rawShift - 1440 : rawShift;
      const candidate = makeSchedule(feasibleOutput, energy, water, lines, startAt, shiftMinutes, intervals);
      if (!recommended
        || candidate.cost < recommended.cost
        || (candidate.cost === recommended.cost && candidate.lines < recommended.lines)
        || (candidate.cost === recommended.cost && candidate.lines === recommended.lines && candidate.intervals < recommended.intervals)) {
        recommended = candidate;
      }
    }
  }
  if (!recommended) throw new Error(`Не удалось построить допустимый исторический план для сценария "${key}".`);

  return {
    target: requestedOutput,
    availableMilk,
    lineCapacity,
    source,
    recommended,
    feasible: requestedOutput <= availableMilk && requestedOutput <= lineCapacity,
    recommendationMethod: "Поиск наименее затратного исторического окна в обучающей части; двухлинейный вариант масштабирует наблюдённый профиль одной линии без предположения о снижении удельного расхода."
  };
}

function makeOverview(url) {
  const scenario = url.searchParams.get("scenario") ?? "base";
  const schedule = url.searchParams.get("schedule") ?? "recommended";
  const plan = scenarioOptions(scenario);
  const last = records.at(-1);
  const recent = records.slice(-4).map((record) => ({ ...record }));
  if (scenario === "overconsumption") {
    recent.forEach((record) => { record.electricity_kwh = Number((record.electricity_kwh + 25).toFixed(2)); });
  }
  let consecutiveErrors = 0;
  for (let index = 0; index < recent.length; index += 1) {
    const previous = index > 0 ? recent[index - 1] : records[records.length - recent.length - 1];
    const predicted = trained.predictRecord.forest(previous);
    const error = Math.abs(recent[index].electricity_kwh - predicted);
    consecutiveErrors = error > trained.anomalyThreshold ? consecutiveErrors + 1 : 0;
  }
  const activeWarning = consecutiveErrors >= 3;
  const currentPrediction = trained.predictRecord.forest(recent.at(-1));
  const displayedValue = recent.at(-1).electricity_kwh;
  const chartStride = Math.max(1, Math.floor(electricityTestSeries.length / 160));
  const chart = electricityTestSeries.filter((_, index) => index % chartStride === 0);
  const waterChart = waterTestSeries.filter((_, index) => index % chartStride === 0);
  const resourceStride = Math.max(1, Math.floor(records.length / 120));
  const resourceTrends = records.filter((_, index) => index % resourceStride === 0).map((record) => ({
    timestamp: record.timestamp,
    milkFlow: record.milk_flow,
    electricity: record.electricity_kwh,
    water: record.water_l,
    output: record.output_l
  }));
  const output = records.filter((row) => row.operating_mode === "production");
  const activePlan = schedule === "source" ? plan.source : plan.recommended;
  const fillerLoad = schedule === "source" ? "82%" : activePlan.lines > 1 ? "70% × 2 линии" : "76%";

  return {
    dataset: { ...datasetInfo, quality: datasetQuality },
    updatedAt: new Date().toISOString(),
    dataTimestamp: last.timestamp,
    scenario,
    schedule,
    metrics: {
      output: Math.round(sum(output, "output_l")),
      energy: Number(sum(records, "electricity_kwh").toFixed(1)),
      water: Number(sum(records, "water_l").toFixed(1)),
      averageLoad: Number((sum(records, "equipment_load") / records.length).toFixed(1)),
      activeBatches: new Set(output.map((row) => row.batch_id)).size
    },
    forecast: {
      electricity: Number(currentPrediction.toFixed(2)),
      water: Number(trained.predictRecord.waterForest(last).toFixed(1)),
      observed: Number(displayedValue.toFixed(2)),
      observedWater: Number(last.water_l.toFixed(1)),
      threshold: trained.anomalyThreshold,
      activeWarning
    },
    testResults: trained.test,
    validationResults: trained.validation,
    waterTestResults: trained.waterTest,
    waterValidationResults: trained.waterValidation,
    anomalyMetrics: trained.anomalyMetrics,
    models: trained.modelInfo,
    chart,
    waterChart,
    resourceTrends,
    events: recentEvents(),
    plan,
    activePlan,
    plant: [
      { id: "tank", name: "Резервуар сырья", detail: "Молоко · 4–7 °C", status: "working", value: "68%" },
      { id: "pasteurizer", name: "Пастеризатор", detail: "72 °C · 2,5 бар", status: activeWarning ? "warning" : "working", value: "72 °C" },
      { id: "cooler", name: "Охладитель", detail: "Выход · 6 °C", status: "working", value: "6 °C" },
      { id: "filler", name: "Фасовочная линия", detail: `Линия ${activePlan.lines > 1 ? "1 + 2" : "1"} · ${fillerLoad}`, status: scenario === "line-down" ? "standby" : "working", value: scenario === "line-down" ? "Ожидание" : fillerLoad }
    ],
    recommendation: activeWarning
      ? "Проверьте режим теплового участка: обнаружено повышенное потребление энергии. Автоматическое управление оборудованием отключено."
      : plan.feasible
        ? `Рекомендуем запуск в ${plan.recommended.startAt}${plan.recommended.shiftMinutes ? ` (сдвиг ${plan.recommended.shiftMinutes > 0 ? "+" : ""}${plan.recommended.shiftMinutes} мин)` : ""}: это наименее затратное окно среди допустимых исторических производственных интервалов. Плановый выпуск сохраняется.`
        : "План превышает доступный запас сырья или производительность линий. Снизьте план до допустимого объёма; экономия за счёт недовыпуска не засчитывается."
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" });
    response.end();
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Поддерживается только GET." });
    return;
  }
  if (url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok", records: records.length, datasetQuality });
    return;
  }
  if (url.pathname === "/api/overview") {
    sendJson(response, 200, makeOverview(url));
    return;
  }
  sendJson(response, 404, { error: "Маршрут не найден." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Resource dashboard API ready at http://localhost:${PORT}`);
  console.log(`Generated ${records.length} records; model evaluation ready.`);
});
