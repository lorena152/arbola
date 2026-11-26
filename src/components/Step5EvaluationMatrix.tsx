import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, Play, Sparkles } from 'lucide-react';
import type {
  ColumnSchema,
  DataRow,
  DecisionTreeNode,
  ErrorImpactAnalysis,
  EvaluationMetrics,
} from '../types/analytics';
import { getConfusionErrorBreakdown, predictRow } from '../utils/decisionTree';

interface Step5EvaluationMatrixProps {
  tree: DecisionTreeNode;
  metrics: EvaluationMetrics;
  columns: ColumnSchema[];
  targetColumn: string;
  datasetName: string;
  sectorContext: string;
  sampleRow: DataRow | undefined;
  allRows: DataRow[];
  errorImpact: ErrorImpactAnalysis | null;
  onErrorImpactGenerated: (impact: ErrorImpactAnalysis) => void;
  onNextStep: () => void;
}

export function Step5EvaluationMatrix({
  tree,
  metrics,
  columns,
  targetColumn,
  datasetName,
  sectorContext,
  sampleRow,
  allRows,
  errorImpact,
  onErrorImpactGenerated,
  onNextStep,
}: Step5EvaluationMatrixProps) {
  const activeFeatures = useMemo(
    () => columns.filter((c) => c.name !== targetColumn && c.type !== 'ignored'),
    [columns, targetColumn]
  );

  const categoryOptions = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const feat of activeFeatures) {
      if (feat.type === 'categorical') {
        const set = new Set<string>();
        for (const r of allRows) {
          const val = r[feat.name];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            set.add(String(val));
          }
        }
        map.set(feat.name, Array.from(set).sort());
      }
    }
    return map;
  }, [activeFeatures, allRows]);

  const [simInput, setSimInput] = useState<DataRow>(() => {
    const init: DataRow = {};
    for (const feat of activeFeatures) {
      init[feat.name] = sampleRow?.[feat.name] ?? feat.sampleValues[0] ?? '';
    }
    return init;
  });

  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  const simPrediction = useMemo(() => predictRow(tree, simInput), [tree, simInput]);
  const errorBreakdown = useMemo(() => getConfusionErrorBreakdown(metrics), [metrics]);

  const overfitGap = (metrics.trainAccuracy - metrics.accuracy) * 100;
  const maxCellCount = Math.max(1, ...metrics.confusionMatrix.flatMap((row) => row));

  async function fetchErrorImpact() {
    setImpactLoading(true);
    setImpactError(null);
    try {
      const res = await fetch('/api/error-impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectorContext,
          datasetName,
          targetColumn,
          positiveClass: errorBreakdown.positiveClass,
          totalTest: metrics.totalTest,
          tp: errorBreakdown.tp,
          fp: errorBreakdown.fp,
          fn: errorBreakdown.fn,
          tn: errorBreakdown.tn,
          accuracy: metrics.accuracy,
          weightedF1: metrics.weightedF1,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'No se pudo interpretar el impacto de los errores.');
      }
      onErrorImpactGenerated(data);
    } catch (err) {
      setImpactError(
        err instanceof Error ? err.message : 'Error al generar interpretación de errores.'
      );
    } finally {
      setImpactLoading(false);
    }
  }

  // Clear error alert if errorImpact updates
  useEffect(() => {
    if (errorImpact) setImpactError(null);
  }, [errorImpact]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-violet-700">Etapa 05 · Evaluación Final 30%</div>
          <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-zinc-900">
            Matriz de Confusión, Métricas y Simulador
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl">
            Evaluación definitiva sobre los{' '}
            <span className="font-mono font-semibold text-zinc-900 tabular-nums">
              {metrics.totalTest}
            </span>{' '}
            registros de prueba reservados (30% no visto durante entrenamiento ni poda).
          </p>
        </div>

        <button
          type="button"
          onClick={onNextStep}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start md:self-auto shadow-xs"
        >
          <span>Aplicación al negocio y marketing</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-violet-50/75 border border-violet-200 rounded-2xl p-5 shadow-xs">
          <div className="text-xs text-violet-800 font-semibold">Accuracy (Exactitud)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-violet-950 mt-1.5">
            {(metrics.accuracy * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-600 mt-1 tabular-nums">
            Train: {(metrics.trainAccuracy * 100).toFixed(1)}% ({overfitGap >= 0 ? '+' : ''}
            {overfitGap.toFixed(1)} pp)
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs">
          <div className="text-xs text-zinc-500">F1-Score (Ponderado)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-zinc-900 mt-1.5">
            {(metrics.weightedF1 * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1 tabular-nums">
            Macro F1: {(metrics.macroF1 * 100).toFixed(1)}%
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs">
          <div className="text-xs text-zinc-500">Precisión (Macro)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-zinc-900 mt-1.5">
            {(metrics.macroPrecision * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">Calidad de positivos</div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs">
          <div className="text-xs text-zinc-500">Recall / Sensibilidad</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-zinc-900 mt-1.5">
            {(metrics.macroRecall * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">Cobertura de reales</div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-xs">
          <div className="text-xs text-zinc-500">
            {metrics.rocAuc !== null ? 'ROC-AUC (Binario)' : 'Clases evaluadas'}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-zinc-900 mt-1.5">
            {metrics.rocAuc !== null ? metrics.rocAuc.toFixed(3) : metrics.labels.length}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {metrics.rocAuc !== null ? 'Poder discriminante' : 'Clasificación multiclase'}
          </div>
        </div>
      </div>

      {/* Confusion Matrix + Per-Class Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-6 bg-white border border-zinc-200 rounded-2xl p-6 space-y-4 shadow-xs">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Matriz de Confusión (Prueba 30%)
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Filas: Valor Real · Columnas: Predicción del Árbol · Diagonal principal en morado
              indica aciertos.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="p-2.5 text-left text-zinc-500 font-medium">Real \ Predicho</th>
                  {metrics.labels.map((predLabel) => (
                    <th
                      key={predLabel}
                      className="p-2.5 text-center font-semibold text-zinc-800 border-b border-zinc-200"
                    >
                      {predLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.labels.map((actualLabel, rIdx) => {
                  const rowSum = metrics.confusionMatrix[rIdx].reduce((a, b) => a + b, 0);
                  return (
                    <tr key={actualLabel}>
                      <td className="p-3 font-semibold text-zinc-800 border-r border-zinc-200 whitespace-nowrap">
                        {actualLabel}
                      </td>
                      {metrics.confusionMatrix[rIdx].map((count, cIdx) => {
                        const isDiagonal = rIdx === cIdx;
                        const rowPct = rowSum > 0 ? (count / rowSum) * 100 : 0;
                        const intensity = Math.max(0.08, count / maxCellCount);

                        const bgStyle = isDiagonal
                          ? `rgba(109, 40, 217, ${0.12 + intensity * 0.28})`
                          : count > 0
                            ? `rgba(113, 113, 122, ${0.08 + intensity * 0.16})`
                            : '#fafafa';

                        return (
                          <td
                            key={cIdx}
                            style={{ backgroundColor: bgStyle }}
                            className="p-3.5 text-center border border-zinc-200 min-w-[96px]"
                          >
                            <div
                              className={`text-base font-bold font-mono tabular-nums ${
                                isDiagonal
                                  ? 'text-violet-950'
                                  : count > 0
                                    ? 'text-zinc-800'
                                    : 'text-zinc-400'
                              }`}
                            >
                              {count}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-zinc-600 mt-0.5">
                              {rowPct.toFixed(1)}%
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-zinc-600 pt-1">
            {overfitGap > 12 ? (
              <span>
                Diagnóstico: Brecha de{' '}
                <strong className="font-mono text-zinc-900">{overfitGap.toFixed(1)} pp</strong> entre
                entrenamiento y prueba; considera ajustar la poda en el paso 04.
              </span>
            ) : (
              <span>
                Diagnóstico: Generalización estable entre entrenamiento (
                <span className="font-mono">{(metrics.trainAccuracy * 100).toFixed(1)}%</span>) y
                prueba (<span className="font-mono">{(metrics.accuracy * 100).toFixed(1)}%</span>).
              </span>
            )}
          </div>
        </section>

        <section className="lg:col-span-6 bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50">
            <h2 className="text-base font-semibold text-zinc-900">Desempeño por Clase</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Precisión, Recall, F1-Score y Especificidad en el 30% de prueba.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-100/70 border-b border-zinc-200 text-zinc-600">
                  <th className="py-3 px-4 font-semibold">Clase</th>
                  <th className="py-3 px-3 text-right font-semibold">Precisión</th>
                  <th className="py-3 px-3 text-right font-semibold">Recall</th>
                  <th className="py-3 px-3 text-right font-semibold">F1-Score</th>
                  <th className="py-3 px-3 text-right font-semibold">Especif.</th>
                  <th className="py-3 px-4 text-right font-semibold">Soporte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {metrics.perClass.map((pc) => (
                  <tr key={pc.label} className="hover:bg-violet-50/25">
                    <td className="py-3 px-4 font-semibold text-zinc-900">{pc.label}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-700">
                      {(pc.precision * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-700">
                      {(pc.recall * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-violet-900">
                      {(pc.f1 * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-700">
                      {(pc.specificity * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-600">
                      {pc.support}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Classification Error Impact (FP & FN Business Consequences) */}
      <section className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Impacto de los Errores de Clasificación en el Negocio
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Consecuencias comerciales, económicas y operativas de los Falsos Positivos y Falsos
              Negativos respecto a «{errorBreakdown.positiveClass}» en {sectorContext}.
            </p>
          </div>

          <button
            type="button"
            disabled={impactLoading}
            onClick={fetchErrorImpact}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto disabled:opacity-50"
          >
            {impactLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-violet-700" />
            )}
            <span>
              {impactLoading
                ? 'Interpretando errores...'
                : errorImpact
                  ? 'Actualizar interpretación IA'
                  : 'Interpretar impacto con IA'}
            </span>
          </button>
        </div>

        {/* Exact FP / FN Counts from Trained Model */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900">
                Falsos Positivos (FP)
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-zinc-900">
                {errorBreakdown.fp} casos ({errorBreakdown.fpPct.toFixed(1)}% del test)
              </span>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              El modelo predijo <strong>{errorBreakdown.positiveClass}</strong> cuando el resultado
              real pertenecía a otra clase.
            </p>
            {errorImpact && (
              <p className="text-xs text-zinc-800 pt-2 border-t border-zinc-200/80 leading-relaxed">
                {errorImpact.falsePositiveImpact}
              </p>
            )}
          </div>

          <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900">
                Falsos Negativos (FN)
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-zinc-900">
                {errorBreakdown.fn} casos ({errorBreakdown.fnPct.toFixed(1)}% del test)
              </span>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Casos reales de <strong>{errorBreakdown.positiveClass}</strong> que el modelo no
              logró detectar a tiempo.
            </p>
            {errorImpact && (
              <p className="text-xs text-zinc-800 pt-2 border-t border-zinc-200/80 leading-relaxed">
                {errorImpact.falseNegativeImpact}
              </p>
            )}
          </div>
        </div>

        {impactError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{impactError}</span>
          </div>
        )}

        {errorImpact ? (
          <div className="p-4 rounded-xl bg-violet-50/70 border border-violet-200 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-violet-950">
                Recomendación operativa de equilibrio de errores
              </span>
              <span className="font-mono font-semibold text-violet-800">
                Prioridad: {errorImpact.priorityErrorType}
              </span>
            </div>
            <p className="text-xs text-zinc-800 leading-relaxed">
              {errorImpact.balanceRecommendation}
            </p>
          </div>
        ) : (
          !impactLoading && (
            <p className="text-xs text-zinc-500">
              Haz clic en «Interpretar impacto con IA» para obtener el análisis económico, comercial
              y operativo específico para estos {errorBreakdown.fp} falsos positivos y{' '}
              {errorBreakdown.fn} falsos negativos en el contexto de {sectorContext}.
            </p>
          )
        )}
      </section>

      {/* Interactive Prediction Simulator with Full Class Probabilities & Interpretation */}
      <section className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Simulador de Predicciones (What-If)
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Ingresa manualmente los valores de las variables independientes para obtener la clase
              predicha, las probabilidades de clasificación y la interpretación de la ruta del árbol.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 text-xs text-zinc-600">
            <Play className="w-3.5 h-3.5 text-violet-700" />
            <span>Cálculo directo sobre el árbol entrenado</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {activeFeatures.map((feat) => {
            const val = simInput[feat.name];
            if (feat.type === 'categorical') {
              const opts = categoryOptions.get(feat.name) ?? [];
              return (
                <div key={feat.name} className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-700 truncate">
                    {feat.name}
                  </label>
                  <select
                    value={val !== null && val !== undefined ? String(val) : ''}
                    onChange={(e) => setSimInput((prev) => ({ ...prev, [feat.name]: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-300 rounded-xl focus:bg-white focus:outline-none focus:border-violet-700"
                  >
                    {opts.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            return (
              <div key={feat.name} className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700 truncate">
                  {feat.name}
                </label>
                <input
                  type="number"
                  step="any"
                  value={val !== null && val !== undefined ? Number(val) : 0}
                  onChange={(e) =>
                    setSimInput((prev) => ({
                      ...prev,
                      [feat.name]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-zinc-50 border border-zinc-300 rounded-xl focus:bg-white focus:outline-none focus:border-violet-700"
                />
              </div>
            );
          })}
        </div>

        {/* Simulator Result: Predicted Class + Probabilities + Brief Interpretation */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-5 rounded-2xl bg-violet-50/60 border border-violet-200">
          <div className="lg:col-span-4 space-y-2">
            <div className="text-xs text-violet-800 font-semibold">Clase predicha</div>
            <div className="text-2xl font-bold text-zinc-900">
              {simPrediction.prediction}
            </div>
            <div className="text-xs text-zinc-600 font-mono tabular-nums">
              Variable: {targetColumn} · Hoja con n = {simPrediction.leafSamples} casos de
              entrenamiento
            </div>
          </div>

          <div className="lg:col-span-4 space-y-2.5">
            <div className="text-xs font-semibold text-zinc-700">
              Probabilidades de clasificación
            </div>
            <div className="space-y-2">
              {simPrediction.allProbabilities.map((prob) => (
                <div key={prob.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-900">{prob.label}</span>
                    <span className="font-mono tabular-nums font-semibold text-violet-950">
                      {(prob.probability * 100).toFixed(1)}% ({prob.count}/{simPrediction.leafSamples})
                    </span>
                  </div>
                  <div className="h-2 bg-white rounded-full overflow-hidden border border-violet-200/70">
                    <div
                      className={`h-full rounded-full ${
                        prob.label === simPrediction.prediction ? 'bg-violet-700' : 'bg-zinc-400'
                      }`}
                      style={{ width: `${Math.max(3, prob.probability * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-2">
            <div className="text-xs font-semibold text-zinc-700">
              Interpretación del resultado
            </div>
            <p className="text-xs text-zinc-700 leading-relaxed">
              El perfil ingresado cumple{' '}
              <span className="font-mono text-zinc-900">
                {simPrediction.pathConditions.length > 0
                  ? simPrediction.pathConditions.join(' → ')
                  : 'la condición raíz'}
              </span>
              , ubicándose en un segmento donde el{' '}
              <strong className="font-mono text-violet-950">
                {(simPrediction.confidence * 100).toFixed(1)}%
              </strong>{' '}
              de los casos históricos correspondieron a{' '}
              <strong>{simPrediction.prediction}</strong>.{' '}
              {simPrediction.confidence >= 0.75
                ? 'Es una clasificación de alta certeza dentro del árbol.'
                : simPrediction.confidence >= 0.58
                  ? 'Existe una tendencia moderada; conviene validar señales secundarias.'
                  : 'El nodo presenta mezcla cercana al empate; úsese con cautela operativa.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
