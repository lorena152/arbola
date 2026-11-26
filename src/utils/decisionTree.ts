import type {
  CcpAlphaOption,
  ColumnSchema,
  DataRow,
  DecisionTreeNode,
  EvaluationMetrics,
  FeatureImportance,
  OptimizationSummary,
  PerClassMetrics,
  SplitCriterion,
  SplitResult,
  TreeHyperparams,
  TreeRule,
  TreeSnapshotMetrics,
  TreeSplitCondition,
  TreeStats,
} from '../types/analytics';

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function splitTrainTest(
  rows: DataRow[],
  targetColumn: string,
  trainRatio = 0.7,
  stratified = true,
  seed = 42
): SplitResult {
  const validRows = rows.filter((r) => {
    const t = r[targetColumn];
    return t !== null && t !== undefined && String(t).trim() !== '';
  });

  const rand = createRng(seed);
  let trainRows: DataRow[] = [];
  let testRows: DataRow[] = [];

  if (stratified) {
    const byClass = new Map<string, DataRow[]>();
    for (const row of validRows) {
      const label = String(row[targetColumn]);
      const list = byClass.get(label) ?? [];
      list.push(row);
      byClass.set(label, list);
    }

    for (const [, group] of byClass.entries()) {
      const shuffled = shuffleInPlace([...group], rand);
      const cut = Math.max(1, Math.min(shuffled.length - 1, Math.round(shuffled.length * trainRatio)));
      if (shuffled.length === 1) {
        trainRows.push(...shuffled);
      } else {
        trainRows.push(...shuffled.slice(0, cut));
        testRows.push(...shuffled.slice(cut));
      }
    }
    trainRows = shuffleInPlace(trainRows, rand);
    testRows = shuffleInPlace(testRows, rand);
  } else {
    const shuffled = shuffleInPlace([...validRows], rand);
    const cut = Math.round(shuffled.length * trainRatio);
    trainRows = shuffled.slice(0, cut);
    testRows = shuffled.slice(cut);
  }

  const labelSet = Array.from(new Set(validRows.map((r) => String(r[targetColumn])))).sort();
  const classBalance = labelSet.map((label) => ({
    label,
    total: validRows.filter((r) => String(r[targetColumn]) === label).length,
    train: trainRows.filter((r) => String(r[targetColumn]) === label).length,
    test: testRows.filter((r) => String(r[targetColumn]) === label).length,
  }));

  return {
    trainRows,
    testRows,
    trainRatio,
    stratified,
    seed,
    classBalance,
  };
}

function countClasses(rows: DataRow[], targetColumn: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const label = String(row[targetColumn]);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function getMajorityClass(counts: Record<string, number>): { label: string; count: number; total: number } {
  let bestLabel = '';
  let bestCount = -1;
  let total = 0;
  for (const [label, count] of Object.entries(counts)) {
    total += count;
    if (count > bestCount) {
      bestCount = count;
      bestLabel = label;
    }
  }
  return { label: bestLabel, count: bestCount, total };
}

function calcImpurity(counts: Record<string, number>, total: number, criterion: SplitCriterion): number {
  if (total <= 0) return 0;
  if (criterion === 'gini') {
    let sumSq = 0;
    for (const c of Object.values(counts)) {
      const p = c / total;
      sumSq += p * p;
    }
    return 1 - sumSq;
  } else {
    let entropy = 0;
    for (const c of Object.values(counts)) {
      if (c > 0) {
        const p = c / total;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }
}

interface CandidateSplit {
  condition: TreeSplitCondition;
  leftRows: DataRow[];
  rightRows: DataRow[];
  gain: number;
}

function findBestSplit(
  rows: DataRow[],
  features: ColumnSchema[],
  targetColumn: string,
  criterion: SplitCriterion,
  minSamplesLeaf: number,
  parentImpurity: number
): CandidateSplit | null {
  const n = rows.length;
  let best: CandidateSplit | null = null;

  for (const feat of features) {
    if (feat.name === targetColumn || feat.type === 'ignored') continue;

    if (feat.type === 'numeric') {
      const pairs: { val: number; target: string; row: DataRow }[] = [];
      const missingRows: DataRow[] = [];

      for (const row of rows) {
        const raw = row[feat.name];
        const num = typeof raw === 'number' ? raw : raw !== null && raw !== '' ? Number(raw) : NaN;
        if (Number.isFinite(num)) {
          pairs.push({ val: num, target: String(row[targetColumn]), row });
        } else {
          missingRows.push(row);
        }
      }

      if (pairs.length < minSamplesLeaf * 2) continue;
      pairs.sort((a, b) => a.val - b.val);

      const totalCounts = countClasses(pairs.map((p) => p.row), targetColumn);
      const leftCounts: Record<string, number> = {};
      const rightCounts: Record<string, number> = { ...totalCounts };

      let leftTotal = 0;
      let rightTotal = pairs.length;

      for (let i = 0; i < pairs.length - 1; i++) {
        const item = pairs[i];
        leftCounts[item.target] = (leftCounts[item.target] ?? 0) + 1;
        rightCounts[item.target] = (rightCounts[item.target] ?? 0) - 1;
        leftTotal++;
        rightTotal--;

        const nextVal = pairs[i + 1].val;
        if (item.val === nextVal) continue;
        if (leftTotal < minSamplesLeaf || rightTotal < minSamplesLeaf) continue;

        const impLeft = calcImpurity(leftCounts, leftTotal, criterion);
        const impRight = calcImpurity(rightCounts, rightTotal, criterion);
        const weightedImp = (leftTotal / pairs.length) * impLeft + (rightTotal / pairs.length) * impRight;
        const gain = parentImpurity - weightedImp;

        if (gain > 1e-7 && (!best || gain > best.gain)) {
          const threshold = Number(((item.val + nextVal) / 2).toFixed(4));
          const leftSlice = pairs.slice(0, i + 1).map((p) => p.row);
          const rightSlice = pairs.slice(i + 1).map((p) => p.row);
          if (missingRows.length > 0) {
            if (leftSlice.length >= rightSlice.length) leftSlice.push(...missingRows);
            else rightSlice.push(...missingRows);
          }
          best = {
            gain,
            leftRows: leftSlice,
            rightRows: rightSlice,
            condition: {
              feature: feat.name,
              featureType: 'numeric',
              operator: '<=',
              threshold,
              labelLeft: `≤ ${formatThreshold(threshold)}`,
              labelRight: `> ${formatThreshold(threshold)}`,
            },
          };
        }
      }
    } else {
      const categoriesMap = new Map<string, DataRow[]>();
      for (const row of rows) {
        const raw = row[feat.name];
        const cat = raw === null || raw === undefined || String(raw).trim() === '' ? '(Nulo)' : String(raw);
        const arr = categoriesMap.get(cat) ?? [];
        arr.push(row);
        categoriesMap.set(cat, arr);
      }

      const categories = Array.from(categoriesMap.keys());
      if (categories.length < 2) continue;

      const allLabels = Object.keys(countClasses(rows, targetColumn));
      const primaryTarget = allLabels[0];

      const orderedCats = [...categories].sort((a, b) => {
        const aRows = categoriesMap.get(a)!;
        const bRows = categoriesMap.get(b)!;
        const aRate = aRows.filter((r) => String(r[targetColumn]) === primaryTarget).length / aRows.length;
        const bRate = bRows.filter((r) => String(r[targetColumn]) === primaryTarget).length / bRows.length;
        return aRate - bRate;
      });

      const candidatePartitions: string[][] = [];
      for (let k = 1; k < orderedCats.length; k++) {
        candidatePartitions.push(orderedCats.slice(0, k));
      }
      if (categories.length > 2 && categories.length <= 12) {
        for (const cat of categories) {
          candidatePartitions.push([cat]);
        }
      }

      for (const leftCats of candidatePartitions) {
        const leftSet = new Set(leftCats);
        const leftRows: DataRow[] = [];
        const rightRows: DataRow[] = [];

        for (const [cat, catRows] of categoriesMap.entries()) {
          if (leftSet.has(cat)) leftRows.push(...catRows);
          else rightRows.push(...catRows);
        }

        if (leftRows.length < minSamplesLeaf || rightRows.length < minSamplesLeaf) continue;

        const impLeft = calcImpurity(countClasses(leftRows, targetColumn), leftRows.length, criterion);
        const impRight = calcImpurity(countClasses(rightRows, targetColumn), rightRows.length, criterion);
        const weightedImp = (leftRows.length / n) * impLeft + (rightRows.length / n) * impRight;
        const gain = parentImpurity - weightedImp;

        if (gain > 1e-7 && (!best || gain > best.gain)) {
          const rightCats = categories.filter((c) => !leftSet.has(c));
          const leftLabel =
            leftCats.length === 1
              ? `= ${leftCats[0]}`
              : leftCats.length <= 2
                ? `∈ {${leftCats.join(', ')}}`
                : `∈ {${leftCats.slice(0, 2).join(', ')}, +${leftCats.length - 2}}`;
          const rightLabel =
            rightCats.length === 1
              ? `= ${rightCats[0]}`
              : rightCats.length <= 2
                ? `∈ {${rightCats.join(', ')}}`
                : `≠ {${leftCats.slice(0, 2).join(', ')}}`;

          best = {
            gain,
            leftRows,
            rightRows,
            condition: {
              feature: feat.name,
              featureType: 'categorical',
              operator: 'in',
              leftCategories: leftCats,
              rightCategories: rightCats,
              labelLeft: leftLabel,
              labelRight: rightLabel,
            },
          };
        }
      }
    }
  }

  return best;
}

function formatThreshold(val: number): string {
  if (Math.abs(val) >= 100) return val.toFixed(1);
  if (Math.abs(val) >= 10) return val.toFixed(2);
  return Number(val.toFixed(3)).toString();
}

export function buildDecisionTree(
  trainRows: DataRow[],
  columns: ColumnSchema[],
  targetColumn: string,
  params: TreeHyperparams
): DecisionTreeNode {
  let nodeCounter = 0;
  const activeFeatures = columns.filter((c) => c.name !== targetColumn && c.type !== 'ignored');

  function build(rows: DataRow[], depth: number): DecisionTreeNode {
    const id = `node_${++nodeCounter}`;
    const counts = countClasses(rows, targetColumn);
    const maj = getMajorityClass(counts);
    const impurity = calcImpurity(counts, rows.length, params.criterion);
    const confidence = maj.total > 0 ? maj.count / maj.total : 0;

    const shouldStop =
      depth >= params.maxDepth ||
      rows.length < params.minSamplesSplit ||
      Object.keys(counts).length <= 1 ||
      impurity <= 1e-7;

    if (shouldStop) {
      return {
        id,
        depth,
        samples: rows.length,
        impurity,
        impurityGain: 0,
        classCounts: counts,
        prediction: maj.label,
        confidence,
        isLeaf: true,
      };
    }

    const bestSplit = findBestSplit(
      rows,
      activeFeatures,
      targetColumn,
      params.criterion,
      params.minSamplesLeaf,
      impurity
    );

    if (!bestSplit) {
      return {
        id,
        depth,
        samples: rows.length,
        impurity,
        impurityGain: 0,
        classCounts: counts,
        prediction: maj.label,
        confidence,
        isLeaf: true,
      };
    }

    const leftChild = build(bestSplit.leftRows, depth + 1);
    const rightChild = build(bestSplit.rightRows, depth + 1);

    return {
      id,
      depth,
      samples: rows.length,
      impurity,
      impurityGain: bestSplit.gain,
      classCounts: counts,
      prediction: maj.label,
      confidence,
      isLeaf: false,
      split: bestSplit.condition,
      left: leftChild,
      right: rightChild,
    };
  }

  const rawTree = build(trainRows, 0);
  if (params.ccpAlpha > 0) {
    return applyCostComplexityPruning(rawTree, params.ccpAlpha);
  }
  return rawTree;
}

export function buildUnprunedTree(
  trainRows: DataRow[],
  columns: ColumnSchema[],
  targetColumn: string,
  criterion: SplitCriterion = 'gini'
): DecisionTreeNode {
  return buildDecisionTree(trainRows, columns, targetColumn, {
    criterion,
    maxDepth: 8,
    minSamplesSplit: 2,
    minSamplesLeaf: 1,
    ccpAlpha: 0,
  });
}

export function cloneTree(node: DecisionTreeNode): DecisionTreeNode {
  return {
    ...node,
    classCounts: { ...node.classCounts },
    split: node.split ? { ...node.split } : undefined,
    left: node.left ? cloneTree(node.left) : undefined,
    right: node.right ? cloneTree(node.right) : undefined,
  };
}

function getLeafErrorRate(node: DecisionTreeNode): number {
  const majCount = node.classCounts[node.prediction] ?? 0;
  return node.samples - majCount;
}

function getSubtreeStats(node: DecisionTreeNode, rootTotalSamples: number): { leaves: number; errorSum: number } {
  if (node.isLeaf || !node.left || !node.right) {
    return { leaves: 1, errorSum: getLeafErrorRate(node) / rootTotalSamples };
  }
  const l = getSubtreeStats(node.left, rootTotalSamples);
  const r = getSubtreeStats(node.right, rootTotalSamples);
  return { leaves: l.leaves + r.leaves, errorSum: l.errorSum + r.errorSum };
}

function computeAccuracyAndWeightedF1FromPredictions(
  pairs: { actual: string; predicted: string }[]
): { accuracy: number; weightedF1: number } {
  if (pairs.length === 0) return { accuracy: 0, weightedF1: 0 };
  const labelSet = new Set<string>();
  let correct = 0;
  for (const p of pairs) {
    labelSet.add(p.actual);
    labelSet.add(p.predicted);
    if (p.actual === p.predicted) correct++;
  }
  const labels = Array.from(labelSet);
  let weightedF1Sum = 0;

  for (const label of labels) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (const p of pairs) {
      if (p.actual === label) support++;
      if (p.actual === label && p.predicted === label) tp++;
      else if (p.actual !== label && p.predicted === label) fp++;
      else if (p.actual === label && p.predicted !== label) fn++;
    }
    const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
    weightedF1Sum += f1 * support;
  }

  return {
    accuracy: correct / pairs.length,
    weightedF1: weightedF1Sum / pairs.length,
  };
}

export function evaluateCrossValidation(
  trainRows: DataRow[],
  columns: ColumnSchema[],
  targetColumn: string,
  params: TreeHyperparams,
  seed = 42,
  kFolds = 5
): { cvAccuracy: number; cvF1: number } {
  const rand = createRng(seed + 31);
  const shuffled = shuffleInPlace([...trainRows], rand);
  const folds = Math.min(kFolds, Math.max(3, Math.floor(shuffled.length / 15)));
  const oofPairs: { actual: string; predicted: string }[] = [];

  for (let f = 0; f < folds; f++) {
    const valStart = Math.floor((f * shuffled.length) / folds);
    const valEnd = Math.floor(((f + 1) * shuffled.length) / folds);
    const valFold = shuffled.slice(valStart, valEnd);
    const trFold = [...shuffled.slice(0, valStart), ...shuffled.slice(valEnd)];

    const foldTree = buildDecisionTree(trFold, columns, targetColumn, params);
    for (const row of valFold) {
      oofPairs.push({
        actual: String(row[targetColumn]),
        predicted: predictRow(foldTree, row).prediction,
      });
    }
  }

  const res = computeAccuracyAndWeightedF1FromPredictions(oofPairs);
  return { cvAccuracy: res.accuracy, cvF1: res.weightedF1 };
}

export function computeCvCcpAlphaPath(
  trainRows: DataRow[],
  columns: ColumnSchema[],
  targetColumn: string,
  baseParams: TreeHyperparams,
  seed = 42
): CcpAlphaOption[] {
  const fullTree = buildDecisionTree(trainRows, columns, targetColumn, {
    ...baseParams,
    ccpAlpha: 0,
  });
  const alphas = new Set<number>([0]);
  const rootTotal = Math.max(1, fullTree.samples);

  function collectAlphas(node: DecisionTreeNode) {
    if (node.isLeaf || !node.left || !node.right) return;
    const nodeError = getLeafErrorRate(node) / rootTotal;
    const sub = getSubtreeStats(node, rootTotal);
    if (sub.leaves > 1) {
      const effectiveAlpha = Math.max(0, (nodeError - sub.errorSum) / (sub.leaves - 1));
      alphas.add(Number(effectiveAlpha.toFixed(5)));
    }
    collectAlphas(node.left);
    collectAlphas(node.right);
  }

  collectAlphas(fullTree);
  const sorted = Array.from(alphas).sort((a, b) => a - b);

  const seenLeafCounts = new Set<number>();
  const options: CcpAlphaOption[] = [];

  for (const alpha of sorted) {
    const pruned = applyCostComplexityPruning(fullTree, alpha);
    const counts = getStructureCounts(pruned);
    if (!seenLeafCounts.has(counts.leafCount)) {
      seenLeafCounts.add(counts.leafCount);
      const cv = evaluateCrossValidation(
        trainRows,
        columns,
        targetColumn,
        { ...baseParams, ccpAlpha: alpha },
        seed,
        5
      );
      options.push({
        alpha,
        leafCount: counts.leafCount,
        cvAccuracy: cv.cvAccuracy,
        cvF1: cv.cvF1,
      });
    }
  }

  if (options.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    options.forEach((opt, idx) => {
      const score = opt.cvAccuracy * 0.5 + opt.cvF1 * 0.5 - opt.leafCount * 0.0005;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    options[bestIdx].isRecommended = true;
  }

  return options;
}

export function applyCostComplexityPruning(root: DecisionTreeNode, alpha: number): DecisionTreeNode {
  const tree = cloneTree(root);
  const rootTotal = Math.max(1, tree.samples);

  function prune(node: DecisionTreeNode): DecisionTreeNode {
    if (node.isLeaf || !node.left || !node.right) return node;
    node.left = prune(node.left);
    node.right = prune(node.right);

    const nodeError = getLeafErrorRate(node) / rootTotal;
    const sub = getSubtreeStats(node, rootTotal);
    if (sub.leaves > 1) {
      const effectiveAlpha = (nodeError - sub.errorSum) / (sub.leaves - 1);
      if (effectiveAlpha <= alpha) {
        node.isLeaf = true;
        node.left = undefined;
        node.right = undefined;
        node.split = undefined;
        node.manuallyPruned = true;
      }
    }
    return node;
  }

  return prune(tree);
}

export function applyReducedErrorPruning(
  root: DecisionTreeNode,
  validationRows: DataRow[],
  targetColumn: string
): DecisionTreeNode {
  const tree = cloneTree(root);

  function accuracyOnRows(candidate: DecisionTreeNode): number {
    if (validationRows.length === 0) return 0;
    let correct = 0;
    for (const row of validationRows) {
      const pred = predictRow(candidate, row).prediction;
      if (pred === String(row[targetColumn])) correct++;
    }
    return correct / validationRows.length;
  }

  function pruneBottomUp(node: DecisionTreeNode): void {
    if (node.isLeaf || !node.left || !node.right) return;
    pruneBottomUp(node.left);
    pruneBottomUp(node.right);

    const beforeAcc = accuracyOnRows(tree);
    const savedLeft = node.left;
    const savedRight = node.right;
    const savedSplit = node.split;

    node.isLeaf = true;
    node.left = undefined;
    node.right = undefined;
    node.split = undefined;

    const afterAcc = accuracyOnRows(tree);
    if (afterAcc < beforeAcc) {
      node.isLeaf = false;
      node.left = savedLeft;
      node.right = savedRight;
      node.split = savedSplit;
    } else {
      node.manuallyPruned = true;
    }
  }

  pruneBottomUp(tree);
  return tree;
}

export function pruneNodeById(root: DecisionTreeNode, targetNodeId: string): DecisionTreeNode {
  const tree = cloneTree(root);
  function visit(node: DecisionTreeNode): boolean {
    if (node.id === targetNodeId) {
      node.isLeaf = true;
      node.left = undefined;
      node.right = undefined;
      node.split = undefined;
      node.manuallyPruned = true;
      return true;
    }
    if (node.left && visit(node.left)) return true;
    if (node.right && visit(node.right)) return true;
    return false;
  }
  visit(tree);
  return tree;
}

export function predictRow(
  root: DecisionTreeNode,
  row: DataRow
): {
  prediction: string;
  confidence: number;
  pathNodeIds: string[];
  pathConditions: string[];
  leafId: string;
  leafSamples: number;
  classCounts: Record<string, number>;
  allProbabilities: { label: string; count: number; probability: number }[];
} {
  let current = root;
  const pathNodeIds = [current.id];
  const pathConditions: string[] = [];

  while (!current.isLeaf && current.split && current.left && current.right) {
    const raw = row[current.split.feature];
    let goLeft = true;

    if (current.split.featureType === 'numeric') {
      const num = typeof raw === 'number' ? raw : raw !== null && raw !== '' ? Number(raw) : NaN;
      if (Number.isFinite(num) && current.split.threshold !== undefined) {
        goLeft = num <= current.split.threshold;
      } else {
        goLeft = current.left.samples >= current.right.samples;
      }
    } else {
      const cat = raw === null || raw === undefined || String(raw).trim() === '' ? '(Nulo)' : String(raw);
      goLeft = (current.split.leftCategories ?? []).includes(cat);
    }

    pathConditions.push(
      `${current.split.feature} ${goLeft ? current.split.labelLeft : current.split.labelRight}`
    );
    current = goLeft ? current.left : current.right;
    pathNodeIds.push(current.id);
  }

  const total = Math.max(
    1,
    Object.values(current.classCounts).reduce((a, b) => a + b, 0)
  );
  const allProbabilities = Object.entries(current.classCounts)
    .map(([label, count]) => ({
      label,
      count,
      probability: count / total,
    }))
    .sort((a, b) => b.probability - a.probability);

  return {
    prediction: current.prediction,
    confidence: current.confidence,
    pathNodeIds,
    pathConditions,
    leafId: current.id,
    leafSamples: current.samples,
    classCounts: current.classCounts,
    allProbabilities,
  };
}

export function getStructureCounts(root: DecisionTreeNode): {
  totalNodes: number;
  leafCount: number;
  maxDepthReached: number;
} {
  let totalNodes = 0;
  let leafCount = 0;
  let maxDepthReached = 0;

  function traverse(n: DecisionTreeNode) {
    totalNodes++;
    if (n.depth > maxDepthReached) maxDepthReached = n.depth;
    if (n.isLeaf || !n.left || !n.right) {
      leafCount++;
    } else {
      traverse(n.left);
      traverse(n.right);
    }
  }
  traverse(root);
  return { totalNodes, leafCount, maxDepthReached };
}

export function getTreeStats(
  root: DecisionTreeNode,
  trainRows: DataRow[],
  testRows: DataRow[],
  targetColumn: string
): TreeStats {
  const { totalNodes, leafCount, maxDepthReached } = getStructureCounts(root);

  const calcAcc = (rows: DataRow[]) => {
    if (rows.length === 0) return 0;
    let ok = 0;
    for (const r of rows) {
      if (predictRow(root, r).prediction === String(r[targetColumn])) ok++;
    }
    return ok / rows.length;
  };

  return {
    totalNodes,
    leafCount,
    maxDepthReached,
    trainAccuracy: calcAcc(trainRows),
    testAccuracy: calcAcc(testRows),
  };
}

export function buildTreeSnapshotMetrics(
  label: string,
  treeNode: DecisionTreeNode,
  trainRows: DataRow[],
  cvAccuracy: number,
  cvF1: number,
  targetColumn: string
): TreeSnapshotMetrics {
  const { totalNodes, leafCount, maxDepthReached } = getStructureCounts(treeNode);
  const trainPairs = trainRows.map((r) => ({
    actual: String(r[targetColumn]),
    predicted: predictRow(treeNode, r).prediction,
  }));
  const trainRes = computeAccuracyAndWeightedF1FromPredictions(trainPairs);

  return {
    label,
    maxDepth: maxDepthReached,
    totalNodes,
    leafCount,
    trainAccuracy: trainRes.accuracy,
    trainF1: trainRes.weightedF1,
    cvAccuracy,
    cvF1,
  };
}

export function optimizeDecisionTree(
  trainRows: DataRow[],
  columns: ColumnSchema[],
  targetColumn: string,
  seed = 42
): { tree: DecisionTreeNode; summary: OptimizationSummary } {
  const rand = createRng(seed + 17);
  const shuffled = shuffleInPlace([...trainRows], rand);
  const kFolds = Math.min(5, Math.max(3, Math.floor(shuffled.length / 20)));

  const criteria: SplitCriterion[] = ['gini', 'entropy'];
  const depths = [3, 4, 5, 6];
  const minLeaves = [3, 6, 10, 15];

  let bestParams: TreeHyperparams = {
    criterion: 'gini',
    maxDepth: 4,
    minSamplesSplit: 10,
    minSamplesLeaf: 5,
    ccpAlpha: 0,
  };
  let bestScore = -1;
  let candidatesTested = 0;

  for (const criterion of criteria) {
    for (const maxDepth of depths) {
      for (const minSamplesLeaf of minLeaves) {
        const minSamplesSplit = Math.max(minSamplesLeaf * 2, 4);
        if (minSamplesSplit >= trainRows.length * 0.5) continue;

        candidatesTested++;
        let totalCorrect = 0;
        let totalCount = 0;

        for (let f = 0; f < kFolds; f++) {
          const valStart = Math.floor((f * shuffled.length) / kFolds);
          const valEnd = Math.floor(((f + 1) * shuffled.length) / kFolds);
          const valFold = shuffled.slice(valStart, valEnd);
          const trFold = [...shuffled.slice(0, valStart), ...shuffled.slice(valEnd)];

          const candidateTree = buildDecisionTree(trFold, columns, targetColumn, {
            criterion,
            maxDepth,
            minSamplesSplit,
            minSamplesLeaf,
            ccpAlpha: 0,
          });

          for (const row of valFold) {
            if (predictRow(candidateTree, row).prediction === String(row[targetColumn])) {
              totalCorrect++;
            }
            totalCount++;
          }
        }

        const cvAcc = totalCount > 0 ? totalCorrect / totalCount : 0;
        const simplicityBonus = (7 - maxDepth) * 0.0005 + minSamplesLeaf * 0.0001;
        const score = cvAcc + simplicityBonus;

        if (score > bestScore) {
          bestScore = score;
          bestParams = {
            criterion,
            maxDepth,
            minSamplesSplit,
            minSamplesLeaf,
            ccpAlpha: 0,
          };
        }
      }
    }
  }

  const finalTree = buildDecisionTree(trainRows, columns, targetColumn, bestParams);
  return {
    tree: finalTree,
    summary: {
      bestParams,
      cvAccuracy: Math.min(1, bestScore),
      candidatesTested,
    },
  };
}

export function extractTreeRules(root: DecisionTreeNode): TreeRule[] {
  const rules: TreeRule[] = [];
  const totalSamples = Math.max(1, root.samples);

  function walk(node: DecisionTreeNode, conditions: string[]) {
    if (node.isLeaf || !node.split || !node.left || !node.right) {
      rules.push({
        leafId: node.id,
        conditions,
        prediction: node.prediction,
        samples: node.samples,
        confidence: node.confidence,
        supportPct: (node.samples / totalSamples) * 100,
        classCounts: node.classCounts,
      });
      return;
    }

    walk(node.left, [...conditions, `${node.split.feature} ${node.split.labelLeft}`]);
    walk(node.right, [...conditions, `${node.split.feature} ${node.split.labelRight}`]);
  }

  walk(root, []);
  return rules.sort((a, b) => b.samples - a.samples);
}

export function computeFeatureImportance(root: DecisionTreeNode): FeatureImportance[] {
  const map = new Map<string, { score: number; count: number }>();

  function walk(node: DecisionTreeNode) {
    if (node.isLeaf || !node.split || !node.left || !node.right) return;
    const weightedGain = node.impurityGain * node.samples;
    const cur = map.get(node.split.feature) ?? { score: 0, count: 0 };
    cur.score += weightedGain;
    cur.count += 1;
    map.set(node.split.feature, cur);
    walk(node.left);
    walk(node.right);
  }

  walk(root);
  const totalScore = Array.from(map.values()).reduce((a, b) => a + b.score, 0);

  return Array.from(map.entries())
    .map(([feature, data]) => ({
      feature,
      importance: totalScore > 0 ? (data.score / totalScore) * 100 : 0,
      splitsCount: data.count,
    }))
    .sort((a, b) => b.importance - a.importance);
}

export function evaluateDecisionTree(
  root: DecisionTreeNode,
  trainRows: DataRow[],
  testRows: DataRow[],
  targetColumn: string,
  preferredPositiveClass?: string
): EvaluationMetrics {
  const labelSet = new Set<string>();
  for (const r of [...trainRows, ...testRows]) {
    const val = r[targetColumn];
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      labelSet.add(String(val));
    }
  }
  const labels = Array.from(labelSet).sort();
  const labelIndex = new Map<string, number>();
  labels.forEach((l, i) => labelIndex.set(l, i));

  const k = labels.length;
  const matrix: number[][] = Array.from({ length: k }, () => Array(k).fill(0));

  let testCorrect = 0;
  const binaryScores: { yTrue: number; yProb: number }[] = [];
  const positiveClass =
    preferredPositiveClass && labels.includes(preferredPositiveClass)
      ? preferredPositiveClass
      : labels[labels.length - 1] ?? '';

  for (const row of testRows) {
    const actual = String(row[targetColumn]);
    const predRes = predictRow(root, row);
    const rIdx = labelIndex.get(actual);
    const cIdx = labelIndex.get(predRes.prediction);

    if (rIdx !== undefined && cIdx !== undefined) {
      matrix[rIdx][cIdx]++;
      if (rIdx === cIdx) testCorrect++;
    }

    if (k === 2 && positiveClass) {
      const totalNode = Object.values(predRes.classCounts).reduce((a, b) => a + b, 0);
      const posCount = predRes.classCounts[positiveClass] ?? 0;
      const prob = totalNode > 0 ? posCount / totalNode : 0.5;
      binaryScores.push({ yTrue: actual === positiveClass ? 1 : 0, yProb: prob });
    }
  }

  let trainCorrect = 0;
  for (const row of trainRows) {
    if (predictRow(root, row).prediction === String(row[targetColumn])) {
      trainCorrect++;
    }
  }

  const totalTest = testRows.length;
  const perClass: PerClassMetrics[] = labels.map((label, i) => {
    const tp = matrix[i][i];
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) {
        if (r !== i && c === i) fp += matrix[r][c];
        if (r === i && c !== i) fn += matrix[r][c];
        if (r !== i && c !== i) tn += matrix[r][c];
      }
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
    const support = tp + fn;

    return { label, precision, recall, f1, specificity, support };
  });

  const macroPrecision = perClass.reduce((a, b) => a + b.precision, 0) / Math.max(1, k);
  const macroRecall = perClass.reduce((a, b) => a + b.recall, 0) / Math.max(1, k);
  const macroF1 = perClass.reduce((a, b) => a + b.f1, 0) / Math.max(1, k);
  const weightedF1 =
    totalTest > 0 ? perClass.reduce((a, b) => a + b.f1 * b.support, 0) / totalTest : 0;

  let rocAuc: number | null = null;
  if (k === 2 && binaryScores.length > 0) {
    const pos = binaryScores.filter((s) => s.yTrue === 1);
    const neg = binaryScores.filter((s) => s.yTrue === 0);
    if (pos.length > 0 && neg.length > 0) {
      let wins = 0;
      for (const p of pos) {
        for (const n of neg) {
          if (p.yProb > n.yProb) wins += 1;
          else if (p.yProb === n.yProb) wins += 0.5;
        }
      }
      rocAuc = wins / (pos.length * neg.length);
    }
  }

  return {
    labels,
    confusionMatrix: matrix,
    totalTest,
    accuracy: totalTest > 0 ? testCorrect / totalTest : 0,
    macroPrecision,
    macroRecall,
    macroF1,
    weightedF1,
    rocAuc,
    positiveClass,
    perClass,
    trainAccuracy: trainRows.length > 0 ? trainCorrect / trainRows.length : 0,
  };
}

export function getConfusionErrorBreakdown(metrics: EvaluationMetrics): {
  positiveClass: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  fpPct: number;
  fnPct: number;
} {
  const idx = Math.max(0, metrics.labels.indexOf(metrics.positiveClass));
  const label = metrics.labels[idx] ?? metrics.positiveClass;
  const k = metrics.labels.length;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      const val = metrics.confusionMatrix[r]?.[c] ?? 0;
      if (r === idx && c === idx) tp += val;
      else if (r !== idx && c === idx) fp += val;
      else if (r === idx && c !== idx) fn += val;
      else tn += val;
    }
  }

  const total = Math.max(1, metrics.totalTest);
  return {
    positiveClass: label,
    tp,
    fp,
    fn,
    tn,
    fpPct: (fp / total) * 100,
    fnPct: (fn / total) * 100,
  };
}
