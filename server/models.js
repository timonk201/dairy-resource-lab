import { featureVector, temporalVector } from "./simulator.js";

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function fitScaler(rows) {
  const columns = rows[0].length;
  const center = Array.from({ length: columns }, (_, column) => mean(rows.map((row) => row[column])));
  const scale = Array.from({ length: columns }, (_, column) => {
    const variance = mean(rows.map((row) => (row[column] - center[column]) ** 2));
    return Math.sqrt(variance) || 1;
  });
  return {
    transform: (row) => row.map((value, column) => (value - center[column]) / scale[column])
  };
}

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot] || 1e-10;
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function trainLinear(samples) {
  const scaler = fitScaler(samples.map((sample) => sample.x));
  const rows = samples.map((sample) => [1, ...scaler.transform(sample.x)]);
  const columns = rows[0].length;
  const matrix = Array.from({ length: columns }, () => Array(columns).fill(0));
  const target = Array(columns).fill(0);

  for (let row = 0; row < rows.length; row += 1) {
    for (let i = 0; i < columns; i += 1) {
      target[i] += rows[row][i] * samples[row].y;
      for (let j = 0; j < columns; j += 1) matrix[i][j] += rows[row][i] * rows[row][j];
    }
  }
  for (let i = 1; i < columns; i += 1) matrix[i][i] += 1e-5;
  const weights = solveLinearSystem(matrix, target);
  return (record) => {
    const row = [1, ...scaler.transform(featureVector(record))];
    return row.reduce((sum, value, index) => sum + value * weights[index], 0);
  };
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function trainForest(samples, seed = 41) {
  const random = createRandom(seed);
  const featureCount = samples[0].x.length;
  const trees = [];
  const treeCount = 12;

  function grow(rows, depth) {
    const average = mean(rows.map((row) => row.y));
    if (depth >= 4 || rows.length < 24) return { value: average };

    const features = Array.from({ length: featureCount }, (_, index) => index)
      .sort(() => random() - 0.5)
      .slice(0, 4);
    let best = null;
    let bestError = Infinity;

    for (const feature of features) {
      let minimum = Infinity;
      let maximum = -Infinity;
      for (const row of rows) {
        minimum = Math.min(minimum, row.x[feature]);
        maximum = Math.max(maximum, row.x[feature]);
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const threshold = minimum + (maximum - minimum) * random();
        let leftCount = 0;
        let leftSum = 0;
        let leftSquares = 0;
        let rightCount = 0;
        let rightSum = 0;
        let rightSquares = 0;
        for (const row of rows) {
          if (row.x[feature] <= threshold) {
            leftCount += 1;
            leftSum += row.y;
            leftSquares += row.y * row.y;
          } else {
            rightCount += 1;
            rightSum += row.y;
            rightSquares += row.y * row.y;
          }
        }
        if (!leftCount || !rightCount) continue;
        const error = leftSquares - leftSum ** 2 / leftCount
          + rightSquares - rightSum ** 2 / rightCount;
        if (error < bestError) {
          bestError = error;
          best = { feature, threshold };
        }
      }
    }

    if (!best) return { value: average };
    const left = [];
    const right = [];
    for (const row of rows) (row.x[best.feature] <= best.threshold ? left : right).push(row);
    return { ...best, left: grow(left, depth + 1), right: grow(right, depth + 1) };
  }

  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    const bootstrap = Array.from({ length: Math.min(1400, samples.length) }, () => samples[Math.floor(random() * samples.length)]);
    trees.push(grow(bootstrap, 0));
  }

  return (record) => {
    const row = featureVector(record);
    return mean(trees.map((tree) => {
      let node = tree;
      while (node.left) node = row[node.feature] <= node.threshold ? node.left : node.right;
      return node.value;
    }));
  };
}

function trainConv1D(records, trainEnd, validationEnd, targetField, seed = 73) {
  const windowSize = 12;
  const kernelSize = 3;
  const filterCount = 5;
  const channels = 4;
  const positions = windowSize - kernelSize + 1;
  const random = createRandom(seed);
  const scaler = fitScaler(records.slice(0, trainEnd - 1).map(temporalVector));
  const parameters = Array.from({ length: filterCount }, () => ({
    weights: Array.from({ length: kernelSize }, () =>
      Array.from({ length: channels }, () => (random() - 0.5) * 0.12)),
    bias: 0.05
  }));
  const outputWeights = Array.from({ length: filterCount }, () => (random() - 0.5) * 0.2);
  let outputBias = 0.55;
  const examples = [];
  const validationExamples = [];

  for (let targetIndex = windowSize; targetIndex < trainEnd; targetIndex += 1) {
    examples.push({
      sequence: records.slice(targetIndex - windowSize, targetIndex).map((record) => scaler.transform(temporalVector(record))),
      target: records[targetIndex][targetField]
    });
  }
  for (let targetIndex = trainEnd; targetIndex < validationEnd; targetIndex += 1) {
    validationExamples.push({
      sequence: records.slice(targetIndex - windowSize, targetIndex).map((record) => scaler.transform(temporalVector(record))),
      target: records[targetIndex][targetField]
    });
  }

  function predictSequence(sequence) {
    const pooled = parameters.map((filter) => {
      const values = [];
      for (let position = 0; position < positions; position += 1) {
        let value = filter.bias;
        for (let step = 0; step < kernelSize; step += 1) {
          for (let channel = 0; channel < channels; channel += 1) {
            value += filter.weights[step][channel] * sequence[position + step][channel];
          }
        }
        values.push(Math.max(0, value));
      }
      return mean(values);
    });
    return outputBias + pooled.reduce((sum, value, index) => sum + value * outputWeights[index], 0);
  }

  function copyParameters() {
    return {
      filters: parameters.map((filter) => ({
        weights: filter.weights.map((row) => [...row]),
        bias: filter.bias
      })),
      outputWeights: [...outputWeights],
      outputBias
    };
  }

  function restoreParameters(snapshot) {
    snapshot.filters.forEach((filter, index) => {
      parameters[index].weights = filter.weights.map((row) => [...row]);
      parameters[index].bias = filter.bias;
    });
    snapshot.outputWeights.forEach((value, index) => { outputWeights[index] = value; });
    outputBias = snapshot.outputBias;
  }

  const learningRate = 0.018;
  let bestLoss = Infinity;
  let bestParameters = copyParameters();
  let epochsWithoutImprovement = 0;
  for (let epoch = 0; epoch < 28; epoch += 1) {
    const gradients = () => ({
      filters: parameters.map(() => ({
        weights: Array.from({ length: kernelSize }, () => Array(channels).fill(0)),
        bias: 0
      })),
      output: Array(filterCount).fill(0),
      bias: 0,
      count: 0
    });
    let batch = gradients();

    for (let exampleIndex = 0; exampleIndex < examples.length; exampleIndex += 1) {
      const { sequence, target } = examples[exampleIndex];
      const activations = parameters.map((filter) => {
        const pooled = [];
        for (let position = 0; position < positions; position += 1) {
          let value = filter.bias;
          for (let step = 0; step < kernelSize; step += 1) {
            for (let channel = 0; channel < channels; channel += 1) {
              value += filter.weights[step][channel] * sequence[position + step][channel];
            }
          }
          pooled.push(Math.max(0, value));
        }
        return pooled;
      });
      const pooled = activations.map((values) => mean(values));
      const prediction = outputBias + pooled.reduce((sum, value, index) => sum + value * outputWeights[index], 0);
      const delta = Math.max(-4, Math.min(4, prediction - target));
      batch.bias += delta;
      batch.count += 1;

      for (let filterIndex = 0; filterIndex < filterCount; filterIndex += 1) {
        batch.output[filterIndex] += delta * pooled[filterIndex];
        const factor = delta * outputWeights[filterIndex] / positions;
        for (let position = 0; position < positions; position += 1) {
          if (activations[filterIndex][position] <= 0) continue;
          batch.filters[filterIndex].bias += factor;
          for (let step = 0; step < kernelSize; step += 1) {
            for (let channel = 0; channel < channels; channel += 1) {
              batch.filters[filterIndex].weights[step][channel] += factor * sequence[position + step][channel];
            }
          }
        }
      }

      if (batch.count === 64 || exampleIndex === examples.length - 1) {
        const rate = learningRate / batch.count;
        outputBias -= rate * batch.bias;
        outputWeights.forEach((value, index) => { outputWeights[index] -= rate * batch.output[index]; });
        parameters.forEach((filter, filterIndex) => {
          filter.bias -= rate * batch.filters[filterIndex].bias;
          for (let step = 0; step < kernelSize; step += 1) {
            for (let channel = 0; channel < channels; channel += 1) {
              filter.weights[step][channel] -= rate * batch.filters[filterIndex].weights[step][channel];
            }
          }
        });
        batch = gradients();
      }
    }
    const validationLoss = mean(validationExamples.map((example) =>
      (predictSequence(example.sequence) - example.target) ** 2));
    if (validationLoss < bestLoss) {
      bestLoss = validationLoss;
      bestParameters = copyParameters();
      epochsWithoutImprovement = 0;
    } else {
      epochsWithoutImprovement += 1;
      if (epochsWithoutImprovement >= 5) break;
    }
  }
  restoreParameters(bestParameters);

  return (endIndex) => {
    const sequence = records.slice(endIndex - windowSize, endIndex).map((record) => scaler.transform(temporalVector(record)));
    return predictSequence(sequence);
  };
}

function trainTargetModels(records, split, targetField, forestSeed, convSeed) {
  const training = [];
  for (let targetIndex = 1; targetIndex < split.trainEnd; targetIndex += 1) {
    training.push({ x: featureVector(records[targetIndex - 1]), y: records[targetIndex][targetField] });
  }

  const linear = trainLinear(training);
  const forest = trainForest(training, forestSeed);
  const conv1d = trainConv1D(records, split.trainEnd, split.validationEnd, targetField, convSeed);
  const predictByName = {
    baseline: (index) => records[index - 1][targetField],
    linear: (index) => linear(records[index - 1]),
    forest: (index) => forest(records[index - 1]),
    conv1d: (index) => conv1d(index)
  };

  function evaluate(start, end) {
    return Object.fromEntries(Object.entries(predictByName).map(([name, predict]) => {
      const actual = [];
      const predicted = [];
      for (let index = start; index < end; index += 1) {
        actual.push(records[index][targetField]);
        predicted.push(predict(index));
      }
      const errors = predicted.map((value, index) => value - actual[index]);
      const mae = mean(errors.map(Math.abs));
      const rmse = Math.sqrt(mean(errors.map((value) => value * value)));
      const total = actual.reduce((sum, value) => sum + (value - mean(actual)) ** 2, 0);
      const residual = errors.reduce((sum, value) => sum + value * value, 0);
      return [name, {
        mae: Number(mae.toFixed(3)),
        rmse: Number(rmse.toFixed(3)),
        r2: Number((1 - residual / (total || 1)).toFixed(3))
      }];
    }));
  }

  const validation = evaluate(split.trainEnd, split.validationEnd);
  const test = evaluate(split.validationEnd, records.length);
  return {
    predictByName,
    predictRecord: { forest },
    validation,
    test
  };
}

export function trainModels(records, split) {
  const electricity = trainTargetModels(records, split, "electricity_kwh", 41, 73);
  const water = trainTargetModels(records, split, "water_l", 43, 79);
  const forest = electricity.predictByName.forest;
  const validationErrors = [];
  for (let index = split.trainEnd; index < split.validationEnd; index += 1) {
    validationErrors.push(Math.abs(forest(index) - records[index].electricity_kwh));
  }
  validationErrors.sort((a, b) => a - b);
  const anomalyThreshold = validationErrors[Math.floor(validationErrors.length * 0.95)] ?? 0;
  let consecutiveErrors = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let firstAnomaly = -1;
  let firstDetection = -1;
  let warningPoints = 0;

  for (let index = split.validationEnd; index < records.length; index += 1) {
    const error = Math.abs(forest(index) - records[index].electricity_kwh);
    consecutiveErrors = error > anomalyThreshold ? consecutiveErrors + 1 : 0;
    const detected = consecutiveErrors >= 3;
    const actual = records[index].anomaly;
    if (actual && firstAnomaly < 0) firstAnomaly = index;
    if (detected) warningPoints += 1;
    if (detected && actual) {
      truePositive += 1;
      if (firstDetection < 0) firstDetection = index;
    } else if (detected) {
      falsePositive += 1;
    } else if (actual) {
      falseNegative += 1;
    }
  }
  const anomalyMetrics = {
    precision: Number((truePositive / Math.max(truePositive + falsePositive, 1)).toFixed(3)),
    recall: Number((truePositive / Math.max(truePositive + falseNegative, 1)).toFixed(3)),
    detectionDelayIntervals: firstAnomaly >= 0 && firstDetection >= 0 ? firstDetection - firstAnomaly : null,
    warningPoints,
    threshold: Number(anomalyThreshold.toFixed(3))
  };

  return {
    predictByName: electricity.predictByName,
    waterPredictByName: water.predictByName,
    predictRecord: {
      forest: electricity.predictRecord.forest,
      waterForest: water.predictRecord.forest
    },
    validation: electricity.validation,
    test: electricity.test,
    waterValidation: water.validation,
    waterTest: water.test,
    anomalyMetrics,
    anomalyThreshold: Number(anomalyThreshold.toFixed(3)),
    modelInfo: [
      { key: "baseline", name: "Наивный прогноз", detail: "Расход следующего интервала равен текущему" },
      { key: "linear", name: "Линейная регрессия", detail: "МНК, масштабирование по обучающей части" },
      { key: "forest", name: "Случайный лес", detail: "12 деревьев, глубина 4, bootstrap" },
      { key: "conv1d", name: "1D CNN", detail: "Окно 12 × 4, 5 фильтров, ранняя остановка (до 28 эпох)" }
    ]
  };
}
