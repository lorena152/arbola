import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Maximize2,
  RotateCcw,
  Scissors,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CcpAlphaOption,
  DecisionTreeNode,
  OptimizationSummary,
  SplitCriterion,
  TreeHyperparams,
  TreeSnapshotMetrics,
} from '../types/analytics';
import { computeFeatureImportance, extractTreeRules } from '../utils/decisionTree';

interface Step4TreeAndPruningProps {
  tree: DecisionTreeNode;
  params: TreeHyperparams;
  optimizationSummary: OptimizationSummary | null;
  originalSnapshot: TreeSnapshotMetrics;
  currentSnapshot: TreeSnapshotMetrics;
  ccpOptions: CcpAlphaOption[];
  targetColumn: string;
  onUpdateParams: (newParams: TreeHyperparams) => void;
  onAutoOptimize: () => void;
  onApplyReducedErrorPruning: () => void;
  onPruneNode: (nodeId: string) => void;
  onRestoreOptimized: () => void;
  onNextStep: () => void;
}

interface PositionedNode {
  node: DecisionTreeNode;
  x: number;
  y: number;
  parentX?: number;
  parentY?: number;
  branchLabel?: string;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 108;
const H_GAP = 30;
const V_GAP = 76;

function layoutTree(root: DecisionTreeNode): {
  nodes: PositionedNode[];
  width: number;
  height: number;
} {
  let leafIndex = 0;
  const coords = new Map<string, { x: number; y: number }>();

  function assignX(node: DecisionTreeNode, depth: number): number {
    const y = depth * (NODE_HEIGHT + V_GAP) + 32;
    if (node.isLeaf || !node.left || !node.right) {
      const x = leafIndex * (NODE_WIDTH + H_GAP) + 32 + NODE_WIDTH / 2;
      leafIndex++;
      coords.set(node.id, { x, y });
      return x;
    }
    const lx = assignX(node.left, depth + 1);
    const rx = assignX(node.right, depth + 1);
    const x = (lx + rx) / 2;
    coords.set(node.id, { x, y });
    return x;
  }

  assignX(root, 0);

  const positioned: PositionedNode[] = [];
  let maxX = 0;
  let maxY = 0;

  function collect(
    node: DecisionTreeNode,
    parentX?: number,
    parentY?: number,
    branchLabel?: string
  ) {
    const pos = coords.get(node.id)!;
    maxX = Math.max(maxX, pos.x + NODE_WIDTH / 2 + 32);
    maxY = Math.max(maxY, pos.y + NODE_HEIGHT + 32);

    positioned.push({
      node,
      x: pos.x,
      y: pos.y,
      parentX,
      parentY,
      branchLabel,
    });

    if (!node.isLeaf && node.left && node.right && node.split) {
      collect(node.left, pos.x, pos.y + NODE_HEIGHT, node.split.labelLeft);
      collect(node.right, pos.x, pos.y + NODE_HEIGHT, node.split.labelRight);
    }
  }

  collect(root);
  return {
    nodes: positioned,
    width: Math.max(680, maxX),
    height: Math.max(360, maxY),
  };
}

export function Step4TreeAndPruning({
  tree,
  params,
  optimizationSummary,
  originalSnapshot,
  currentSnapshot,
  ccpOptions,
  targetColumn,
  onUpdateParams,
  onAutoOptimize,
  onApplyReducedErrorPruning,
  onPruneNode,
  onRestoreOptimized,
  onNextStep,
}: Step4TreeAndPruningProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(tree.id);
  const [zoom, setZoom] = useState<number>(0.9);

  const layout = useMemo(() => layoutTree(tree), [tree]);
  const rules = useMemo(() => extractTreeRules(tree), [tree]);
  const importances = useMemo(() => computeFeatureImportance(tree), [tree]);

  const selectedNode = useMemo(() => {
    const found = layout.nodes.find((n) => n.node.id === selectedNodeId);
    return found?.node ?? tree;
  }, [layout.nodes, selectedNodeId, tree]);

  const nodeDelta = currentSnapshot.totalNodes - originalSnapshot.totalNodes;
  const depthDelta = currentSnapshot.maxDepth - originalSnapshot.maxDepth;
  const cvAccDeltaPp = (currentSnapshot.cvAccuracy - originalSnapshot.cvAccuracy) * 100;
  const cvF1DeltaPp = (currentSnapshot.cvF1 - originalSnapshot.cvF1) * 100;
  const nodeReductionPct =
    originalSnapshot.totalNodes > 0
      ? ((originalSnapshot.totalNodes - currentSnapshot.totalNodes) /
          originalSnapshot.totalNodes) *
        100
      : 0;
  const overfitGap = (currentSnapshot.trainAccuracy - currentSnapshot.cvAccuracy) * 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-violet-700">Etapa 04 · Modelado y Poda</div>
          <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-zinc-900">
            Árbol de Decisión Optimizado y Poda
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl">
            Guiado por validación cruzada (5-fold) sobre el 70% de entrenamiento. El 30% de prueba
            permanece estrictamente reservado para la evaluación final en el siguiente paso.
          </p>
        </div>

        <button
          type="button"
          onClick={onNextStep}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start md:self-auto shadow-xs"
        >
          <span>Evaluación final en Prueba (30%)</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Model Complexity vs Cross-Validation Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-zinc-500">Nodos / Hojas</div>
          <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 mt-1">
            {currentSnapshot.totalNodes}{' '}
            <span className="text-sm font-normal text-zinc-500">/ {currentSnapshot.leafCount}</span>
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-zinc-500">Profundidad real</div>
          <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 mt-1">
            {currentSnapshot.maxDepth}
          </div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-zinc-500">Accuracy Train (70%)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 mt-1">
            {(currentSnapshot.trainAccuracy * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-violet-50/75 border border-violet-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-medium text-violet-800">Accuracy CV (5-fold)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-violet-950 mt-1">
            {(currentSnapshot.cvAccuracy * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] text-zinc-600 tabular-nums mt-0.5">
            Brecha Train–CV: {overfitGap >= 0 ? '+' : ''}
            {overfitGap.toFixed(1)} pp
          </div>
        </div>
        <div className="bg-violet-50/75 border border-violet-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-medium text-violet-800">F1-Score CV (5-fold)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-violet-950 mt-1">
            {(currentSnapshot.cvF1 * 100).toFixed(1)}%
          </div>
          <div className="text-[11px] text-zinc-600 mt-0.5">Guía de poda</div>
        </div>
      </div>

      {/* Main Split: Tree Blueprint Viewport + Pruning Sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-8 bg-white border border-zinc-200 rounded-2xl overflow-hidden flex flex-col shadow-xs">
          <div className="px-5 py-3.5 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/70">
            <div className="text-xs text-zinc-600">
              Objetivo:{' '}
              <span className="font-mono font-semibold text-violet-900">{targetColumn}</span> ·
              Criterio:{' '}
              <span className="font-semibold text-zinc-900">
                {params.criterion === 'gini' ? 'Impureza Gini' : 'Entropía'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.1).toFixed(2))))}
                title="Alejar"
                className="p-1.5 text-zinc-600 hover:text-zinc-900 bg-white border border-zinc-200 rounded-lg"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono tabular-nums text-zinc-700 w-11 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
                title="Acercar"
                className="p-1.5 text-zinc-600 hover:text-zinc-900 bg-white border border-zinc-200 rounded-lg"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(Math.min(1, Number((780 / layout.width).toFixed(2))))}
                title="Ajustar al ancho"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Ajustar</span>
              </button>
            </div>
          </div>

          <div className="overflow-auto max-h-[540px] tree-blueprint-bg p-5">
            <div
              style={{
                width: `${layout.width * zoom}px`,
                height: `${layout.height * zoom}px`,
                position: 'relative',
              }}
            >
              <svg
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                }}
                className="select-none"
              >
                {layout.nodes.map((item) => {
                  if (item.parentX === undefined || item.parentY === undefined) return null;
                  const startX = item.parentX;
                  const startY = item.parentY;
                  const endX = item.x;
                  const endY = item.y;
                  const midY = (startY + endY) / 2;
                  const pathD = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;

                  return (
                    <g key={`edge_${item.node.id}`}>
                      <path d={pathD} fill="none" stroke="#a1a1aa" strokeWidth={1.6} />
                      {item.branchLabel && (
                        <g transform={`translate(${(startX + endX) / 2}, ${midY})`}>
                          <rect
                            x={-56}
                            y={-11}
                            width={112}
                            height={22}
                            rx={6}
                            fill="#ffffff"
                            stroke="#d4d4d8"
                            strokeWidth={1}
                          />
                          <text
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={10.5}
                            fontFamily="JetBrains Mono, monospace"
                            fill="#27272a"
                          >
                            {item.branchLabel.length > 15
                              ? `${item.branchLabel.slice(0, 14)}…`
                              : item.branchLabel}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {layout.nodes.map((item) => {
                  const n = item.node;
                  const isSelected = n.id === selectedNode.id;
                  const left = item.x - NODE_WIDTH / 2;
                  const top = item.y;

                  const strokeColor = isSelected
                    ? '#6d28d9'
                    : n.isLeaf
                      ? '#7c3aed'
                      : '#d4d4d8';
                  const headerFill = n.isLeaf ? '#f5f3ff' : '#f4f4f5';

                  return (
                    <g
                      key={n.id}
                      transform={`translate(${left}, ${top})`}
                      onClick={() => setSelectedNodeId(n.id)}
                      className="cursor-pointer"
                    >
                      <rect
                        width={NODE_WIDTH}
                        height={NODE_HEIGHT}
                        rx={12}
                        fill="#ffffff"
                        stroke={strokeColor}
                        strokeWidth={isSelected ? 2.4 : 1.2}
                      />
                      <path
                        d={`M 0 12 Q 0 0 12 0 L ${NODE_WIDTH - 12} 0 Q ${NODE_WIDTH} 0 ${NODE_WIDTH} 12 L ${NODE_WIDTH} 32 L 0 32 Z`}
                        fill={headerFill}
                      />
                      <line x1={0} y1={32} x2={NODE_WIDTH} y2={32} stroke="#e4e4e7" strokeWidth={1} />

                      <text
                        x={12}
                        y={20}
                        fontSize={11.5}
                        fontWeight={600}
                        fontFamily="Plus Jakarta Sans, sans-serif"
                        fill={n.isLeaf ? '#4c1d95' : '#18181b'}
                      >
                        {n.isLeaf
                          ? `Hoja: ${n.prediction.length > 18 ? `${n.prediction.slice(0, 17)}…` : n.prediction}`
                          : n.split && n.split.feature.length > 22
                            ? `${n.split.feature.slice(0, 21)}…`
                            : n.split?.feature}
                      </text>

                      <text
                        x={12}
                        y={50}
                        fontSize={10.5}
                        fontFamily="JetBrains Mono, monospace"
                        fill="#52525b"
                      >
                        {`n = ${n.samples}  ·  ${params.criterion === 'gini' ? 'Gini' : 'Ent'}: ${n.impurity.toFixed(3)}`}
                      </text>
                      <text
                        x={12}
                        y={68}
                        fontSize={11}
                        fontFamily="DM Sans, sans-serif"
                        fill="#18181b"
                      >
                        {`Clase: ${n.prediction.length > 14 ? `${n.prediction.slice(0, 13)}…` : n.prediction} (${(n.confidence * 100).toFixed(0)}%)`}
                      </text>

                      <rect
                        x={12}
                        y={84}
                        width={NODE_WIDTH - 24}
                        height={8}
                        rx={4}
                        fill="#e4e4e7"
                      />
                      <rect
                        x={12}
                        y={84}
                        width={Math.max(5, (NODE_WIDTH - 24) * n.confidence)}
                        height={8}
                        rx={4}
                        fill={n.isLeaf ? '#6d28d9' : '#71717a'}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>

        {/* Pruning & Node Inspector Controls */}
        <div className="xl:col-span-4 space-y-4">
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">
                Inspector de Nodo ({selectedNode.isLeaf ? 'Hoja' : 'División'})
              </h2>
              <span className="text-xs font-mono text-zinc-500">Prof. {selectedNode.depth}</span>
            </div>

            {selectedNode.split && !selectedNode.isLeaf ? (
              <div className="text-xs bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-1">
                <div className="text-zinc-500">Regla de división</div>
                <div className="font-mono font-medium text-zinc-900">
                  {selectedNode.split.feature} {selectedNode.split.labelLeft} (izq) vs.{' '}
                  {selectedNode.split.labelRight} (der)
                </div>
              </div>
            ) : (
              <div className="text-xs bg-violet-50 border border-violet-200 rounded-xl p-3 text-violet-950">
                Nodo terminal predice <strong>{selectedNode.prediction}</strong> con{' '}
                <span className="font-mono tabular-nums">
                  {(selectedNode.confidence * 100).toFixed(1)}%
                </span>{' '}
                de pureza.
              </div>
            )}

            <div className="space-y-1.5 text-xs">
              <div className="text-zinc-500">Distribución (n = {selectedNode.samples}):</div>
              {Object.entries(selectedNode.classCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([cls, count]) => (
                  <div key={cls} className="flex items-center justify-between">
                    <span className="text-zinc-700 truncate pr-2">{cls}</span>
                    <span className="font-mono tabular-nums text-zinc-900 font-medium">
                      {count} ({((count / Math.max(1, selectedNode.samples)) * 100).toFixed(1)}%)
                    </span>
                  </div>
                ))}
            </div>

            {!selectedNode.isLeaf && (
              <button
                type="button"
                onClick={() => onPruneNode(selectedNode.id)}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-xl transition-colors"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Podar este subárbol (convertir en hoja)</span>
              </button>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900">Opciones de Poda y Ajuste</h2>
              <button
                type="button"
                onClick={onRestoreOptimized}
                className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 font-semibold"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Restaurar óptimo</span>
              </button>
            </div>

            {optimizationSummary && (
              <p className="text-xs text-zinc-500 leading-relaxed">
                Auto-optimización CV ({optimizationSummary.candidatesTested} combinaciones):
                precisión CV{' '}
                <span className="font-mono tabular-nums font-medium text-zinc-900">
                  {(optimizationSummary.cvAccuracy * 100).toFixed(1)}%
                </span>
                .
              </p>
            )}

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-zinc-700">Criterio de impureza</div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 rounded-xl">
                {(['gini', 'entropy'] as SplitCriterion[]).map((crit) => (
                  <button
                    key={crit}
                    type="button"
                    onClick={() => onUpdateParams({ ...params, criterion: crit })}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      params.criterion === crit
                        ? 'bg-white text-violet-950 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {crit === 'gini' ? 'Gini' : 'Entropía'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3.5">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-700">Pre-poda: Profundidad máxima</span>
                  <span className="font-mono tabular-nums font-semibold text-violet-900">
                    {params.maxDepth}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={params.maxDepth}
                  onChange={(e) => onUpdateParams({ ...params, maxDepth: Number(e.target.value) })}
                  className="w-full accent-violet-700"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-700">Mín. muestras para dividir</span>
                  <span className="font-mono tabular-nums font-semibold text-violet-900">
                    {params.minSamplesSplit}
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={50}
                  step={2}
                  value={params.minSamplesSplit}
                  onChange={(e) =>
                    onUpdateParams({ ...params, minSamplesSplit: Number(e.target.value) })
                  }
                  className="w-full accent-violet-700"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-700">Mín. muestras por hoja</span>
                  <span className="font-mono tabular-nums font-semibold text-violet-900">
                    {params.minSamplesLeaf}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={35}
                  value={params.minSamplesLeaf}
                  onChange={(e) =>
                    onUpdateParams({ ...params, minSamplesLeaf: Number(e.target.value) })
                  }
                  className="w-full accent-violet-700"
                />
              </div>

              <div className="pt-2.5 border-t border-zinc-100">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-700">Post-poda CCP (alpha · vía CV)</span>
                  <span className="font-mono tabular-nums font-semibold text-violet-900">
                    {params.ccpAlpha.toFixed(4)}
                  </span>
                </div>
                {ccpOptions.length > 1 ? (
                  <select
                    value={params.ccpAlpha}
                    onChange={(e) =>
                      onUpdateParams({ ...params, ccpAlpha: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-2 text-xs font-mono bg-zinc-50 border border-zinc-300 rounded-xl"
                  >
                    {ccpOptions.map((opt) => (
                      <option key={opt.alpha} value={opt.alpha}>
                        α={opt.alpha.toFixed(4)} · {opt.leafCount} hojas · CV{' '}
                        {(opt.cvAccuracy * 100).toFixed(1)}%
                        {opt.isRecommended ? ' ★ Óptimo CV' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-zinc-500">
                    Aumenta la profundidad para explorar niveles adicionales de alpha.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={onApplyReducedErrorPruning}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-colors"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Poda por Error Reducido (REP sobre CV)</span>
              </button>
              <button
                type="button"
                onClick={onAutoOptimize}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-violet-900 bg-violet-50 hover:bg-violet-100 rounded-xl transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Re-optimizar hiperparámetros (CV)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Comparative Table: Original Tree vs Pruned Tree */}
      <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50">
          <h2 className="text-base font-semibold text-zinc-900">
            Comparación de Poda: Árbol Original vs. Árbol Podado (Validación Cruzada 5-fold)
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Compara el árbol sin restricciones (profundidad máx. 8, sin poda) frente al árbol actual
            para decidir el punto de poda sin contaminar los datos de prueba (30%).
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-100/70 border-b border-zinc-200 text-xs font-semibold text-zinc-600">
                <th className="py-3 px-6">Métrica del modelo</th>
                <th className="py-3 px-6 text-right">Árbol Original (Sin podar)</th>
                <th className="py-3 px-6 text-right text-violet-950">Árbol Podado / Actual</th>
                <th className="py-3 px-6 text-right">Variación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-xs">
              <tr>
                <td className="py-3 px-6 font-medium text-zinc-900">Profundidad del árbol</td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-700">
                  {originalSnapshot.maxDepth}
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums font-semibold text-violet-900">
                  {currentSnapshot.maxDepth}
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-600">
                  {depthDelta > 0 ? `+${depthDelta}` : depthDelta} niveles
                </td>
              </tr>
              <tr>
                <td className="py-3 px-6 font-medium text-zinc-900">Número de nodos totales</td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-700">
                  {originalSnapshot.totalNodes} ({originalSnapshot.leafCount} hojas)
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums font-semibold text-violet-900">
                  {currentSnapshot.totalNodes} ({currentSnapshot.leafCount} hojas)
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-600">
                  {nodeDelta > 0 ? `+${nodeDelta}` : nodeDelta} nodos (
                  {nodeReductionPct >= 0 ? `-${nodeReductionPct.toFixed(0)}%` : `+${Math.abs(nodeReductionPct).toFixed(0)}%`})
                </td>
              </tr>
              <tr>
                <td className="py-3 px-6 font-medium text-zinc-900">
                  Accuracy — Validación Cruzada (5-fold)
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-700">
                  {(originalSnapshot.cvAccuracy * 100).toFixed(1)}%
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums font-semibold text-violet-900">
                  {(currentSnapshot.cvAccuracy * 100).toFixed(1)}%
                </td>
                <td
                  className={`py-3 px-6 text-right font-mono tabular-nums font-semibold ${
                    cvAccDeltaPp >= 0 ? 'text-violet-800' : 'text-zinc-600'
                  }`}
                >
                  {cvAccDeltaPp >= 0 ? '+' : ''}
                  {cvAccDeltaPp.toFixed(1)} pp
                </td>
              </tr>
              <tr>
                <td className="py-3 px-6 font-medium text-zinc-900">
                  F1-Score (Ponderado) — Validación Cruzada (5-fold)
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-700">
                  {(originalSnapshot.cvF1 * 100).toFixed(1)}%
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums font-semibold text-violet-900">
                  {(currentSnapshot.cvF1 * 100).toFixed(1)}%
                </td>
                <td
                  className={`py-3 px-6 text-right font-mono tabular-nums font-semibold ${
                    cvF1DeltaPp >= 0 ? 'text-violet-800' : 'text-zinc-600'
                  }`}
                >
                  {cvF1DeltaPp >= 0 ? '+' : ''}
                  {cvF1DeltaPp.toFixed(1)} pp
                </td>
              </tr>
              <tr>
                <td className="py-3 px-6 font-medium text-zinc-900">
                  Accuracy — Entrenamiento (70%)
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-600">
                  {(originalSnapshot.trainAccuracy * 100).toFixed(1)}%
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-700">
                  {(currentSnapshot.trainAccuracy * 100).toFixed(1)}%
                </td>
                <td className="py-3 px-6 text-right font-mono tabular-nums text-zinc-500">
                  {((currentSnapshot.trainAccuracy - originalSnapshot.trainAccuracy) * 100).toFixed(1)} pp
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 bg-violet-50/50 border-t border-zinc-200 text-xs text-zinc-700 leading-relaxed space-y-1">
          <div className="font-semibold text-violet-950">
            Equilibrio entre complejidad, interpretabilidad y desempeño predictivo
          </div>
          <p>
            {nodeReductionPct > 5 ? (
              <>
                La poda redujo el tamaño del árbol en un{' '}
                <strong className="font-mono">{nodeReductionPct.toFixed(0)}%</strong> (de{' '}
                <span className="font-mono">{originalSnapshot.totalNodes}</span> a{' '}
                <span className="font-mono">{currentSnapshot.totalNodes}</span> nodos y{' '}
                <span className="font-mono">{currentSnapshot.leafCount}</span> reglas interpretables).{' '}
                {cvAccDeltaPp >= -0.5
                  ? `Además, en validación cruzada la exactitud ${
                      cvAccDeltaPp >= 0 ? 'mejoró' : 'se mantuvo estable'
                    } (${cvAccDeltaPp >= 0 ? '+' : ''}${cvAccDeltaPp.toFixed(1)} pp) y el F1-Score varió ${
                      cvF1DeltaPp >= 0 ? '+' : ''
                    }${cvF1DeltaPp.toFixed(1)} pp, mitigando el sobreajuste del árbol original (${(
                      originalSnapshot.trainAccuracy * 100
                    ).toFixed(1)}% en train vs. ${(originalSnapshot.cvAccuracy * 100).toFixed(
                      1
                    )}% en CV).`
                  : `Aunque la validación cruzada bajó ligeramente (${cvAccDeltaPp.toFixed(
                      1
                    )} pp), la ganancia en simplicidad e interpretabilidad comercial facilita accionar las reglas sin depender de micro-segmentos ruidosos.`}
              </>
            ) : (
              <>
                El árbol actual conserva una estructura similar al árbol original (
                <span className="font-mono">{currentSnapshot.totalNodes}</span> nodos). Puedes
                reducir la profundidad máxima, incrementar las muestras mínimas por hoja o subir
                alpha (CCP) para evaluar si un árbol más compacto mejora o sostiene el desempeño en
                validación cruzada.
              </>
            )}
          </p>
        </div>
      </section>

      {/* Directly Visible 2-Column Analytics: Feature Importance Bar Chart + Decision Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 bg-white border border-zinc-200 rounded-2xl p-6 space-y-4 shadow-xs">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Importancia Predictiva de Variables
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Contribución normalizada de cada variable a la reducción de impureza del árbol actual.
            </p>
          </div>

          {importances.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4">
              El árbol está colapsado en la raíz; aumenta la profundidad para calcular importancia.
            </p>
          ) : (
            <div className="space-y-3.5 pt-1">
              {importances.map((item, idx) => (
                <div key={item.feature} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-900 truncate pr-3">
                      <span className="font-mono text-zinc-400 mr-2">0{idx + 1}</span>
                      {item.feature}
                      <span className="text-zinc-400 font-normal ml-1.5">
                        ({item.splitsCount} {item.splitsCount === 1 ? 'corte' : 'cortes'})
                      </span>
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-violet-900 shrink-0">
                      {item.importance.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-700 rounded-full transition-all"
                      style={{ width: `${Math.max(3, item.importance)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-7 bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50">
            <h2 className="text-base font-semibold text-zinc-900">
              Reglas de Decisión Extraídas ({rules.length} hojas)
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Caminos completos desde la raíz hasta cada nodo terminal ordenados por cobertura.
            </p>
          </div>
          <div className="divide-y divide-zinc-100 max-h-[380px] overflow-y-auto">
            {rules.map((rule, idx) => (
              <div
                key={rule.leafId}
                className="px-6 py-3.5 flex flex-col gap-1.5 text-xs hover:bg-violet-50/25 transition-colors"
              >
                <div className="font-mono text-zinc-800 leading-relaxed">
                  <span className="text-zinc-400 mr-2">R{idx + 1}.</span>
                  <span className="font-semibold text-violet-800">SI </span>
                  {rule.conditions.length > 0 ? rule.conditions.join(' Y ') : 'Sin divisiones (Raíz)'}
                </div>
                <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-[11px]">
                  <span className="text-violet-950 font-semibold">→ {rule.prediction}</span>
                  <span className="text-zinc-600">
                    Confianza {(rule.confidence * 100).toFixed(1)}%
                  </span>
                  <span className="text-zinc-500">
                    n={rule.samples} ({rule.supportPct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
