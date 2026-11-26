import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  HelpCircle,
  Loader2,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import type {
  DatasetState,
  SplitResult,
  TargetSuggestionResponse,
} from '../types/analytics';
import { computeCategoricalDistribution, suggestTargetHeuristic } from '../utils/dataParser';

interface Step3TargetAndSplitProps {
  dataset: DatasetState;
  targetColumn: string;
  positiveClass: string;
  stratified: boolean;
  seed: number;
  splitResult: SplitResult | null;
  onSelectTarget: (col: string, posClass?: string) => void;
  onDiscretizeTarget: (col: string, bins: 2 | 3) => void;
  onUpdateSplitConfig: (stratified: boolean, seed: number) => void;
  onTrainOptimizedTree: () => void;
}

export function Step3TargetAndSplit({
  dataset,
  targetColumn,
  positiveClass,
  stratified,
  seed,
  splitResult,
  onSelectTarget,
  onDiscretizeTarget,
  onUpdateSplitConfig,
  onTrainOptimizedTree,
}: Step3TargetAndSplitProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<TargetSuggestionResponse | null>(null);

  const heuristicSuggestions = useMemo(
    () => suggestTargetHeuristic(dataset.columns, dataset.rows),
    [dataset.columns, dataset.rows]
  );

  useEffect(() => {
    setAiSuggestion(null);
    setAiError(null);
  }, [dataset.name]);

  const activeTargetSchema = dataset.columns.find((c) => c.name === targetColumn);
  const needsDiscretization =
    activeTargetSchema &&
    activeTargetSchema.type === 'numeric' &&
    activeTargetSchema.uniqueCount > 8;

  const targetDistribution = useMemo(() => {
    if (!targetColumn || needsDiscretization) return null;
    return computeCategoricalDistribution(dataset.rows, targetColumn);
  }, [dataset.rows, targetColumn, needsDiscretization]);

  const activeSuggestions = aiSuggestion?.suggestions ?? heuristicSuggestions;

  async function handleAskAiSuggestion() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/suggest-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetName: dataset.name,
          sectorContext: dataset.sectorContext,
          columns: dataset.columns.map((c) => ({
            name: c.name,
            type: c.type,
            uniqueCount: c.uniqueCount,
            sampleValues: c.sampleValues,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'No se pudo obtener sugerencia inteligente.');
      }
      setAiSuggestion(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Error al consultar sugerencia.');
    } finally {
      setAiLoading(false);
    }
  }

  const candidateColumns = dataset.columns.filter((c) => c.type !== 'ignored');

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-violet-700">Etapa 03 · Definición ML</div>
          <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-zinc-900">
            Variable Dependiente y Partición 70 / 30
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl">
            Confirma la variable objetivo que predecirá el árbol y configura el split de
            entrenamiento (70%) y prueba (30%).
          </p>
        </div>

        <button
          type="button"
          disabled={!targetColumn || Boolean(needsDiscretization)}
          onClick={onTrainOptimizedTree}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start md:self-auto disabled:opacity-50 shadow-xs"
        >
          <span>Crear árbol optimizado</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Suggestion and Question Panel */}
      <section className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-violet-50/60 border border-violet-200/80">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-700 text-white flex items-center justify-center shrink-0">
              <HelpCircle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-900">
                ¿Cuál es tu variable dependiente o de análisis?
              </h2>
              <p className="text-sm text-zinc-700 mt-0.5 leading-relaxed">
                {aiSuggestion?.clarifyingQuestion ||
                  'Basado en la estructura de tus datos, te sugerimos estas variables objetivo. Confirma una o selecciona otra manualmente.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={aiLoading}
            onClick={handleAskAiSuggestion}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-violet-900 bg-white border border-violet-300 hover:bg-violet-100/60 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start"
          >
            {aiLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-violet-700" />
            )}
            <span>{aiLoading ? 'Analizando columnas...' : 'Sugerir con IA'}</span>
          </button>
        </div>

        {aiError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
            {aiError}
          </div>
        )}

        {aiSuggestion?.domainSummary && (
          <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 leading-relaxed">
            {aiSuggestion.domainSummary}
          </p>
        )}

        {/* Top Suggested Candidates */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activeSuggestions.map((sug) => {
            const isSelected = targetColumn === sug.column;
            return (
              <button
                key={sug.column}
                type="button"
                onClick={() => onSelectTarget(sug.column, sug.recommendedPositiveClass)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-violet-700 bg-violet-50/70 ring-1 ring-violet-700/20'
                    : 'border-zinc-200 bg-white hover:border-violet-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-zinc-900 truncate">
                    {sug.column}
                  </span>
                  <span
                    className={`text-[11px] font-medium shrink-0 ${
                      isSelected ? 'text-violet-800' : 'text-zinc-500'
                    }`}
                  >
                    Confianza {sug.confidence}
                  </span>
                </div>
                <p className="text-xs text-zinc-600 mt-2 leading-relaxed">{sug.reason}</p>
              </button>
            );
          })}
        </div>

        {/* Manual Selector + Positive Class Focus */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-zinc-100">
          <div className="space-y-1.5">
            <label htmlFor="target-select" className="block text-xs font-semibold text-zinc-700">
              Variable dependiente seleccionada (Y)
            </label>
            <select
              id="target-select"
              value={targetColumn}
              onChange={(e) => onSelectTarget(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/70 border border-zinc-300 rounded-xl focus:bg-white focus:outline-none focus:border-violet-700"
            >
              <option value="">-- Selecciona una variable --</option>
              {candidateColumns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.type === 'numeric' ? 'Numérica' : 'Categórica'} · {c.uniqueCount}{' '}
                  valores)
                </option>
              ))}
            </select>
          </div>

          {targetDistribution && targetDistribution.buckets.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="positive-select" className="block text-xs font-semibold text-zinc-700">
                Clase foco de negocio (para métricas y estrategia)
              </label>
              <select
                id="positive-select"
                value={positiveClass}
                onChange={(e) => onSelectTarget(targetColumn, e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/70 border border-zinc-300 rounded-xl focus:bg-white focus:outline-none focus:border-violet-700"
              >
                {targetDistribution.buckets.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.value} ({b.count} casos · {b.percentage.toFixed(1)}%)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {needsDiscretization && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-amber-950">
                  La variable «{targetColumn}» es numérica continua ({activeTargetSchema.uniqueCount}{' '}
                  valores únicos)
                </h3>
                <p className="text-xs text-amber-900 mt-0.5">
                  Conviértela en segmentos categóricos para generar la Matriz de Confusión y F1-Score.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onDiscretizeTarget(targetColumn, 2)}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-amber-300 text-amber-950 rounded-lg hover:bg-amber-100 whitespace-nowrap"
              >
                2 niveles (Bajo / Alto)
              </button>
              <button
                type="button"
                onClick={() => onDiscretizeTarget(targetColumn, 3)}
                className="px-3 py-1.5 text-xs font-medium bg-amber-700 text-white rounded-lg hover:bg-amber-800 whitespace-nowrap"
              >
                3 terciles (Bajo / Medio / Alto)
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ML 70-30 Configuration and Split Summary */}
      <section className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Partición Machine Learning: 70% Entrenamiento / 30% Prueba
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              El modelo aprende exclusivamente del 70%; la matriz de confusión y F1 se evalúan en el
              30% restante.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={stratified}
                onChange={(e) => onUpdateSplitConfig(e.target.checked, seed)}
                className="rounded border-zinc-300 text-violet-700 focus:ring-violet-700"
              />
              <span>Muestreo estratificado</span>
            </label>

            <div className="flex items-center gap-2">
              <label htmlFor="seed-input" className="text-xs font-medium text-zinc-600">
                Semilla:
              </label>
              <input
                id="seed-input"
                type="number"
                value={seed}
                onChange={(e) => onUpdateSplitConfig(stratified, Number(e.target.value) || 42)}
                className="w-20 px-2.5 py-1 text-xs font-mono tabular-nums border border-zinc-300 rounded-lg"
              />
              <button
                type="button"
                onClick={() => onUpdateSplitConfig(stratified, Math.floor(1 + Math.random() * 9999))}
                title="Nueva semilla aleatoria"
                className="p-1.5 text-zinc-600 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
              >
                <Shuffle className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {splitResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200">
                <div className="text-xs text-zinc-500">Total registros válidos</div>
                <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 mt-1">
                  {splitResult.trainRows.length + splitResult.testRows.length}
                </div>
              </div>
              <div className="p-4 rounded-xl bg-violet-50/70 border border-violet-200">
                <div className="text-xs font-medium text-violet-800">Entrenamiento (70%)</div>
                <div className="text-xl font-bold font-mono tabular-nums text-violet-950 mt-1">
                  {splitResult.trainRows.length} registros
                </div>
              </div>
              <div className="p-4 rounded-xl bg-zinc-100/80 border border-zinc-200">
                <div className="text-xs font-medium text-zinc-600">Prueba / Evaluación (30%)</div>
                <div className="text-xl font-bold font-mono tabular-nums text-zinc-900 mt-1">
                  {splitResult.testRows.length} registros
                </div>
              </div>
            </div>

            <div className="h-3 w-full rounded-full overflow-hidden flex bg-zinc-200">
              <div
                className="bg-violet-700 h-full"
                style={{ width: '70%' }}
                title="70% Entrenamiento"
              />
              <div
                className="bg-zinc-500 h-full"
                style={{ width: '30%' }}
                title="30% Prueba"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-zinc-500">
                    <th className="py-2.5 px-3 font-semibold">Clase objetivo</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Total</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Train (70%)</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Test (30%)</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Proporción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {splitResult.classBalance.map((cb) => {
                    const totalValid = splitResult.trainRows.length + splitResult.testRows.length;
                    const pct = totalValid > 0 ? (cb.total / totalValid) * 100 : 0;
                    return (
                      <tr key={cb.label}>
                        <td className="py-2.5 px-3 font-semibold text-zinc-900">{cb.label}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700">
                          {cb.total}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-violet-800 font-semibold">
                          {cb.train}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700">
                          {cb.test}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-500">
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
