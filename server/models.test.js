import test from "node:test";
import assert from "node:assert/strict";
import { datasetInfo, makeDataset, validateDataset } from "./simulator.js";
import { trainModels } from "./models.js";

test("генератор воспроизводит 5000 последовательных наблюдений", () => {
  const first = makeDataset();
  const second = makeDataset();
  assert.equal(first.length, 5000);
  assert.deepEqual(first[0], second[0]);
  assert.deepEqual(first.at(-1), second.at(-1));
  assert.equal(first[1].timestamp, new Date(Date.parse(first[0].timestamp) + 5 * 60_000).toISOString());
  assert.equal(first.filter((record) => record.anomaly).length, 8);
  assert.equal(datasetInfo.trainEnd, 3500);
  assert.equal(datasetInfo.validationEnd, 4250);
  assert.deepEqual(validateDataset(first), {
    valid: true,
    records: 5000,
    missingValues: 0,
    invalidTimestamps: 0,
    duplicateTimestamps: 0,
    outOfOrderTimestamps: 0,
    intervalGaps: 0
  });
});

test("проверка датасета обнаруживает пропуски, дубликаты, порядок и разрывы", () => {
  const records = makeDataset().slice(0, 4).map((record) => ({ ...record }));
  records[1].water_l = null;
  records[2].timestamp = records[0].timestamp;

  const quality = validateDataset(records);
  assert.equal(quality.valid, false);
  assert.equal(quality.missingValues, 1);
  assert.equal(quality.duplicateTimestamps, 1);
  assert.equal(quality.outOfOrderTimestamps, 1);
  assert.equal(quality.intervalGaps, 2);
});

test("модели оцениваются на общей будущей выборке и возвращают конечные метрики", () => {
  const records = makeDataset();
  const result = trainModels(records, { trainEnd: 3500, validationEnd: 4250 });
  assert.deepEqual(Object.keys(result.test).sort(), ["baseline", "conv1d", "forest", "linear"]);
  for (const metrics of Object.values(result.test)) {
    assert.ok(Number.isFinite(metrics.mae) && metrics.mae >= 0);
    assert.ok(Number.isFinite(metrics.rmse) && metrics.rmse >= 0);
    assert.ok(Number.isFinite(metrics.r2));
  }
  assert.deepEqual(Object.keys(result.waterTest).sort(), ["baseline", "conv1d", "forest", "linear"]);
  for (const metrics of Object.values(result.waterTest)) {
    assert.ok(Number.isFinite(metrics.mae) && metrics.mae >= 0);
    assert.ok(Number.isFinite(metrics.rmse) && metrics.rmse >= 0);
    assert.ok(Number.isFinite(metrics.r2));
  }
  assert.ok(Number.isFinite(result.anomalyThreshold) && result.anomalyThreshold > 0);
  assert.ok(Number.isFinite(result.predictByName.conv1d(records.length - 1)));
  assert.ok(Number.isFinite(result.waterPredictByName.forest(records.length - 1)));
  assert.ok(Number.isFinite(result.waterPredictByName.conv1d(records.length - 1)));
  assert.ok(result.anomalyMetrics.recall > 0);
  assert.ok(Number.isFinite(result.anomalyMetrics.precision));
  assert.ok(Number.isFinite(result.anomalyMetrics.detectionDelayIntervals));
});
