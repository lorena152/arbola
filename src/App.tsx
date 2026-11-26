import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { SidebarNav, type WorkflowStep } from './components/SidebarNav';
import { Step1DataIngestion } from './components/Step1DataIngestion';
import { Step2ExploratoryAnalysis } from './components/Step2ExploratoryAnalysis';
import { Step3TargetAndSplit } from './components/Step3TargetAndSplit';
import { Step4TreeAndPruning } from './components/Step4TreeAndPruning';
import { Step5EvaluationMatrix } from './components/Step5EvaluationMatrix';
import { Step6BusinessStrategy } from './components/Step6BusinessStrategy';
import type {
  BusinessStrategyReport,
  DatasetState,
  DecisionTreeNode,
  ErrorImpactAnalysis,
  OptimizationSummary,
  TreeHyperparams,
  TreeSnapshotMetrics,
  VariableType,
} from './types/analytics';
import {
  discretizeNumericTarget,
  inferColumnSchemas,
  suggestTargetHeuristic,
} from './utils/dataParser';
import {
  applyReducedErrorPruning,
  buildDecisionTree,
  buildTreeSnapshotMetrics,
  buildUnprunedTree,
  computeCvCcpAlphaPath,
  evaluateCrossValidation,
  evaluateDecisionTree,
  optimizeDecisionTree,
  predictRow,
  pruneNodeById,
  splitTrainTest,
} from './utils/decisionTree';

const STEP_TITLES: Record<WorkflowStep, string> = {
  1: 'Datos y Contexto',
  2: 'Variables y Estadística',
  3: 'Variable Objetivo y Split 70/30',
  4: 'Árbol de Decisión y Poda',
  5: 'Matriz de Confusión y Métricas',
  6: 'Estrategia de Negocio y Marketing',
};

const DEFAULT_PARAMS: TreeHyperparams = {
  criterion: 'gini',
  maxDepth: 4,
  minSamplesSplit: 10,
  minSamplesLeaf: 5,
  ccpAlpha: 0,
};

export default function App() {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(1);
  const [dataset, setDataset] = useState<DatasetState | null>(null);
  const [targetColumn, setTargetColumn] = useState<string>('');
  const [positiveClass, setPositiveClass] = useState<string>('');
  const [stratified, setStratified] = useState<boolean>(true);
  const [seed, setSeed] = useState<number>(42);

  const [tree, setTree] = useState<DecisionTreeNode | null>(null);
  const [baseOptimizedTree, setBaseOptimizedTree] = useState<DecisionTreeNode | null>(null);
  const [treeParams, setTreeParams] = useState<TreeHyperparams>(DEFAULT_PARAMS);
  const [optimizedParams, setOptimizedParams] = useState<TreeHyperparams>(DEFAULT_PARAMS);
  const [optimizationSummary, setOptimizationSummary] = useState<OptimizationSummary | null>(null);
  const [isCustomPruned, setIsCustomPruned] = useState<boolean>(false);
  const [errorImpact, setErrorImpact] = useState<ErrorImpactAnalysis | null>(null);
  const [strategyReport, setStrategyReport] = useState<BusinessStrategyReport | null>(null);

  const splitResult = useMemo(() => {
    if (!dataset || !targetColumn) return null;
    const targetSchema = dataset.columns.find((c) => c.name === targetColumn);
    if (!targetSchema || (targetSchema.type === 'numeric' && targetSchema.uniqueCount > 8)) {
      return null;
    }
    return splitTrainTest(dataset.rows, targetColumn, 0.7, stratified, seed);
  }, [dataset, targetColumn, stratified, seed]);

  const maxUnlockedStep: WorkflowStep = useMemo(() => {
    if (!dataset) return 1;
    if (tree && splitResult) return 6;
    return 3;
  }, [dataset, tree, splitResult]);

  function handleDatasetLoaded(
    ds: DatasetState,
    suggestedTarget?: string,
    suggestedPositive?: string
  ) {
    setDataset(ds);
    setTree(null);
    setBaseOptimizedTree(null);
    setOptimizationSummary(null);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);

    if (suggestedTarget && ds.columns.some((c) => c.name === suggestedTarget)) {
      setTargetColumn(suggestedTarget);
      setPositiveClass(suggestedPositive ?? '');
    } else {
      const heuristic = suggestTargetHeuristic(ds.columns, ds.rows);
      setTargetColumn(heuristic[0]?.column ?? '');
      setPositiveClass(heuristic[0]?.recommendedPositiveClass ?? '');
    }
    setCurrentStep(1);
  }

  function handleUpdateColumnType(columnName: string, newType: VariableType) {
    if (!dataset) return;
    const updatedCols = dataset.columns.map((c) =>
      c.name === columnName ? { ...c, type: newType } : c
    );
    setDataset({ ...dataset, columns: updatedCols });
    setTree(null);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);
  }

  function handleSelectTarget(col: string, posClass?: string) {
    setTargetColumn(col);
    setTree(null);
    setBaseOptimizedTree(null);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);

    if (posClass) {
      setPositiveClass(posClass);
    } else if (dataset && col) {
      const heuristic = suggestTargetHeuristic(
        dataset.columns.filter((c) => c.name === col),
        dataset.rows
      );
      setPositiveClass(heuristic[0]?.recommendedPositiveClass ?? '');
    } else {
      setPositiveClass('');
    }
  }

  function handleDiscretizeTarget(col: string, bins: 2 | 3) {
    if (!dataset) return;
    const { rows, newColumnName, labels } = discretizeNumericTarget(dataset.rows, col, bins);
    const headers = Object.keys(rows[0] ?? {});
    const newColumns = inferColumnSchemas(headers, rows).map((c) => {
      const prev = dataset.columns.find((p) => p.name === c.name);
      if (prev) return { ...c, type: prev.type };
      if (c.name === newColumnName) return { ...c, type: 'categorical' as VariableType };
      return c;
    });

    setDataset({ ...dataset, rows, columns: newColumns });
    setTargetColumn(newColumnName);
    setPositiveClass(labels[labels.length - 1] ?? '');
    setTree(null);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);
  }

  function handleUpdateSplitConfig(newStratified: boolean, newSeed: number) {
    setStratified(newStratified);
    setSeed(newSeed);
    setTree(null);
    setBaseOptimizedTree(null);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);
  }

  function handleTrainOptimizedTree() {
    if (!dataset || !splitResult || !targetColumn) return;
    const { tree: optTree, summary } = optimizeDecisionTree(
      splitResult.trainRows,
      dataset.columns,
      targetColumn,
      seed
    );
    setTree(optTree);
    setBaseOptimizedTree(optTree);
    setTreeParams(summary.bestParams);
    setOptimizedParams(summary.bestParams);
    setOptimizationSummary(summary);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);
    setCurrentStep(4);
  }

  function handleUpdateTreeParams(newParams: TreeHyperparams) {
    if (!dataset || !splitResult || !targetColumn) return;
    const updatedTree = buildDecisionTree(
      splitResult.trainRows,
      dataset.columns,
      targetColumn,
      newParams
    );
    setTreeParams(newParams);
    setTree(updatedTree);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);
  }

  function handleApplyReducedErrorPruning() {
    if (!tree || !splitResult) return;
    const valCut = Math.max(10, Math.floor(splitResult.trainRows.length * 0.25));
    const validationSlice = splitResult.trainRows.slice(0, valCut);
    const pruned = applyReducedErrorPruning(tree, validationSlice, targetColumn);
    setTree(pruned);
    setIsCustomPruned(true);
    setErrorImpact(null);
    setStrategyReport(null);
  }

  function handlePruneNode(nodeId: string) {
    if (!tree) return;
    setTree(pruneNodeById(tree, nodeId));
    setIsCustomPruned(true);
    setErrorImpact(null);
    setStrategyReport(null);
  }

  function handleRestoreOptimized() {
    if (!baseOptimizedTree) return;
    setTree(baseOptimizedTree);
    setTreeParams(optimizedParams);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);
  }

  // Unpruned baseline tree & its 5-fold CV metrics on 70% training data ONLY
  const originalSnapshot: TreeSnapshotMetrics | null = useMemo(() => {
    if (!dataset || !splitResult || !targetColumn) return null;
    const unprunedParams: TreeHyperparams = {
      criterion: treeParams.criterion,
      maxDepth: 8,
      minSamplesSplit: 2,
      minSamplesLeaf: 1,
      ccpAlpha: 0,
    };
    const unprunedTree = buildUnprunedTree(
      splitResult.trainRows,
      dataset.columns,
      targetColumn,
      treeParams.criterion
    );
    const cv = evaluateCrossValidation(
      splitResult.trainRows,
      dataset.columns,
      targetColumn,
      unprunedParams,
      seed,
      5
    );
    return buildTreeSnapshotMetrics(
      'Árbol Original',
      unprunedTree,
      splitResult.trainRows,
      cv.cvAccuracy,
      cv.cvF1,
      targetColumn
    );
  }, [dataset, splitResult, targetColumn, treeParams.criterion, seed]);

  // Active/pruned tree snapshot with 5-fold CV metrics on 70% training data ONLY
  const currentSnapshot: TreeSnapshotMetrics | null = useMemo(() => {
    if (!dataset || !splitResult || !targetColumn || !tree) return null;

    let cvAccuracy = 0;
    let cvF1 = 0;
    if (!isCustomPruned) {
      const cv = evaluateCrossValidation(
        splitResult.trainRows,
        dataset.columns,
        targetColumn,
        treeParams,
        seed,
        5
      );
      cvAccuracy = cv.cvAccuracy;
      cvF1 = cv.cvF1;
    } else {
      // For manually pruned or REP trees, evaluate against an internal 25% holdout slice of trainRows
      // (strictly never touching the reserved 30% testRows!)
      const valCut = Math.max(10, Math.floor(splitResult.trainRows.length * 0.25));
      const valSlice = splitResult.trainRows.slice(0, valCut);
      let ok = 0;
      const labels = Array.from(new Set(valSlice.map((r) => String(r[targetColumn]))));
      const pairs = valSlice.map((r) => {
        const pred = predictRow(tree, r).prediction;
        const actual = String(r[targetColumn]);
        if (pred === actual) ok++;
        return { actual, predicted: pred };
      });
      cvAccuracy = valSlice.length > 0 ? ok / valSlice.length : 0;
      let weightedF1 = 0;
      for (const lbl of labels) {
        let tp = 0;
        let fp = 0;
        let fn = 0;
        let sup = 0;
        for (const p of pairs) {
          if (p.actual === lbl) sup++;
          if (p.actual === lbl && p.predicted === lbl) tp++;
          else if (p.actual !== lbl && p.predicted === lbl) fp++;
          else if (p.actual === lbl && p.predicted !== lbl) fn++;
        }
        const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
        const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
        weightedF1 += f1 * sup;
      }
      cvF1 = valSlice.length > 0 ? weightedF1 / valSlice.length : 0;
    }

    return buildTreeSnapshotMetrics(
      'Árbol Podado',
      tree,
      splitResult.trainRows,
      cvAccuracy,
      cvF1,
      targetColumn
    );
  }, [dataset, splitResult, targetColumn, tree, treeParams, seed, isCustomPruned]);

  // CCP Alpha options guided strictly by 5-fold Cross-Validation on 70% trainRows
  const ccpOptions = useMemo(() => {
    if (!dataset || !splitResult || !targetColumn) return [];
    return computeCvCcpAlphaPath(
      splitResult.trainRows,
      dataset.columns,
      targetColumn,
      treeParams,
      seed
    );
  }, [
    dataset,
    splitResult,
    targetColumn,
    treeParams.criterion,
    treeParams.maxDepth,
    treeParams.minSamplesSplit,
    treeParams.minSamplesLeaf,
    seed,
  ]);

  // Reserved 30% Test Evaluation (strictly for Step 5 & Step 6)
  const evaluationMetrics = useMemo(() => {
    if (!tree || !splitResult || !targetColumn) return null;
    return evaluateDecisionTree(
      tree,
      splitResult.trainRows,
      splitResult.testRows,
      targetColumn,
      positiveClass
    );
  }, [tree, splitResult, targetColumn, positiveClass]);

  function handleResetWorkspace() {
    setDataset(null);
    setTargetColumn('');
    setPositiveClass('');
    setTree(null);
    setBaseOptimizedTree(null);
    setOptimizationSummary(null);
    setIsCustomPruned(false);
    setErrorImpact(null);
    setStrategyReport(null);
    setCurrentStep(1);
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F6F6F9] text-zinc-900">
      <SidebarNav
        currentStep={currentStep}
        maxUnlockedStep={maxUnlockedStep}
        onSelectStep={setCurrentStep}
        dataset={dataset}
        targetColumn={targetColumn}
        onResetWorkspace={handleResetWorkspace}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-[3px] w-full bg-violet-700 shrink-0" />
        <header className="bg-white border-b border-zinc-200 px-6 lg:px-10 h-14 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="font-semibold text-zinc-900 whitespace-nowrap">
              {dataset ? dataset.name : 'Nuevo Proyecto'}
            </span>
            <span className="text-zinc-300" aria-hidden="true">
              /
            </span>
            <span className="text-zinc-600 truncate">
              Paso 0{currentStep} · {STEP_TITLES[currentStep]}
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-zinc-500 tabular-nums">
              <span>0{currentStep}/06</span>
              <div className="w-20 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-700 transition-all duration-200"
                  style={{ width: `${(currentStep / 6) * 100}%` }}
                />
              </div>
            </div>

            {dataset && currentStep < maxUnlockedStep && (
              <button
                type="button"
                onClick={() => setCurrentStep((s) => Math.min(6, s + 1) as WorkflowStep)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Siguiente paso
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-10 max-w-[1280px] w-full mx-auto">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {currentStep === 1 && (
              <Step1DataIngestion
                dataset={dataset}
                onDatasetLoaded={handleDatasetLoaded}
                onNextStep={() => setCurrentStep(2)}
              />
            )}

            {currentStep === 2 && dataset && (
              <Step2ExploratoryAnalysis
                dataset={dataset}
                targetColumn={targetColumn}
                onUpdateColumnType={handleUpdateColumnType}
                onNextStep={() => setCurrentStep(3)}
              />
            )}

            {currentStep === 3 && dataset && (
              <Step3TargetAndSplit
                dataset={dataset}
                targetColumn={targetColumn}
                positiveClass={positiveClass}
                stratified={stratified}
                seed={seed}
                splitResult={splitResult}
                onSelectTarget={handleSelectTarget}
                onDiscretizeTarget={handleDiscretizeTarget}
                onUpdateSplitConfig={handleUpdateSplitConfig}
                onTrainOptimizedTree={handleTrainOptimizedTree}
              />
            )}

            {currentStep === 4 && tree && originalSnapshot && currentSnapshot && (
              <Step4TreeAndPruning
                tree={tree}
                params={treeParams}
                optimizationSummary={optimizationSummary}
                originalSnapshot={originalSnapshot}
                currentSnapshot={currentSnapshot}
                ccpOptions={ccpOptions}
                targetColumn={targetColumn}
                onUpdateParams={handleUpdateTreeParams}
                onAutoOptimize={handleTrainOptimizedTree}
                onApplyReducedErrorPruning={handleApplyReducedErrorPruning}
                onPruneNode={handlePruneNode}
                onRestoreOptimized={handleRestoreOptimized}
                onNextStep={() => setCurrentStep(5)}
              />
            )}

            {currentStep === 5 && tree && evaluationMetrics && dataset && splitResult && (
              <Step5EvaluationMatrix
                tree={tree}
                metrics={evaluationMetrics}
                columns={dataset.columns}
                targetColumn={targetColumn}
                datasetName={dataset.name}
                sectorContext={dataset.sectorContext}
                sampleRow={splitResult.testRows[0]}
                allRows={dataset.rows}
                errorImpact={errorImpact}
                onErrorImpactGenerated={setErrorImpact}
                onNextStep={() => setCurrentStep(6)}
              />
            )}

            {currentStep === 6 && tree && evaluationMetrics && dataset && (
              <Step6BusinessStrategy
                sectorContext={dataset.sectorContext}
                datasetName={dataset.name}
                targetColumn={targetColumn}
                positiveClass={positiveClass}
                tree={tree}
                metrics={evaluationMetrics}
                strategyReport={strategyReport}
                onStrategyGenerated={setStrategyReport}
              />
            )}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
