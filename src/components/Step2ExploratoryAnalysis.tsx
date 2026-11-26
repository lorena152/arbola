import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { DatasetState, VariableType } from '../types/analytics';
import { computeCategoricalDistribution, computeNumericStats } from '../utils/dataParser';

interface Step2ExploratoryAnalysisProps {
  dataset: DatasetState;
  targetColumn: string;
  onUpdateColumnType: (columnName: string, newType: VariableType) => void;
  onNextStep: () => void;
}

const TARGET_PALETTE = [
  '#6d28d9',
  '#52525b',
  '#a855f7',
  '#d97706',
  '#0f766e',
  '#dc2626',
];

export function Step2ExploratoryAnalysis({
  dataset,
  targetColumn,
  onUpdateColumnType,
  onNextStep,
}: Step2ExploratoryAnalysisProps) {
  const categoricalCols = useMemo(
    () => dataset.columns.filter((c) => c.type === 'categorical'),
    [dataset.columns]
  );

  const [selectedCatCol, setSelectedCatCol] = useState<string>(
    () => categoricalCols[0]?.name ?? ''
  );
  const [groupByTarget, setGroupByTarget] = useState<boolean>(false);

  const activeCatCol = categoricalCols.some((c) => c.name === selectedCatCol)
    ? selectedCatCol
    : categoricalCols[0]?.name ?? '';

  const numericStats = useMemo(
    () => computeNumericStats(dataset.rows, dataset.columns),
    [dataset.rows, dataset.columns]
  );

  const catDistribution = useMemo(() => {
    if (!activeCatCol) return null;
    return computeCategoricalDistribution(
      dataset.rows,
      activeCatCol,
      groupByTarget && targetColumn && targetColumn !== activeCatCol ? targetColumn : undefined
    );
  }, [dataset.rows, activeCatCol, groupByTarget, targetColumn]);

  const targetClasses = useMemo(() => {
    if (!groupByTarget || !targetColumn) return [];
    const set = new Set<string>();
    for (const r of dataset.rows) {
      const v = r[targetColumn];
      set.add(v === null || v === undefined || v === '' ? '(Nulo)' : String(v));
    }
    return Array.from(set).sort();
  }, [dataset.rows, groupByTarget, targetColumn]);

  const numericCount = dataset.columns.filter((c) => c.type === 'numeric').length;
  const catCount = dataset.columns.filter((c) => c.type === 'categorical').length;
  const ignoredCount = dataset.columns.filter((c) => c.type === 'ignored').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-violet-700">Etapa 02 · Exploración</div>
          <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-zinc-900">
            Tipos de Variables y Análisis Estadístico
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl">
            Clasifica tus variables como Numéricas o Categóricas (Factor), inspecciona el análisis
            descriptivo cuantitativo y explora el histograma de frecuencias.
          </p>
        </div>
        <button
          type="button"
          onClick={onNextStep}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start md:self-auto shadow-xs"
        >
          <span>Definir objetivo y split 70/30</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Variable Type Classification Table */}
      <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Clasificación de Variables (Categóricas / Factor y Numéricas)
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
              {numericCount} numéricas · {catCount} categóricas (factor) · {ignoredCount} ignoradas
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-100/70 border-b border-zinc-200 text-xs font-semibold text-zinc-600">
                <th className="py-3 px-5">Variable</th>
                <th className="py-3 px-4">Tipo asignado</th>
                <th className="py-3 px-4 text-right">Únicos</th>
                <th className="py-3 px-4 text-right">Nulos</th>
                <th className="py-3 px-5">Muestra de valores</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-sm">
              {dataset.columns.map((col) => (
                <tr key={col.name} className="hover:bg-violet-50/25 transition-colors">
                  <td className="py-3 px-5 font-semibold text-zinc-900 whitespace-nowrap">
                    {col.name}
                  </td>
                  <td className="py-3 px-4">
                    <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => onUpdateColumnType(col.name, 'numeric')}
                        className={`px-2.5 py-1 text-xs rounded-md transition-all whitespace-nowrap shrink-0 ${
                          col.type === 'numeric'
                            ? 'bg-white text-zinc-900 font-semibold shadow-xs'
                            : 'text-zinc-600 hover:text-zinc-900'
                        }`}
                      >
                        Numérica
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateColumnType(col.name, 'categorical')}
                        className={`px-2.5 py-1 text-xs rounded-md transition-all whitespace-nowrap shrink-0 ${
                          col.type === 'categorical'
                            ? 'bg-violet-700 text-white font-semibold shadow-xs'
                            : 'text-zinc-600 hover:text-zinc-900'
                        }`}
                      >
                        Categórica (Factor)
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateColumnType(col.name, 'ignored')}
                        className={`px-2.5 py-1 text-xs rounded-md transition-all whitespace-nowrap shrink-0 ${
                          col.type === 'ignored'
                            ? 'bg-zinc-700 text-white font-semibold shadow-xs'
                            : 'text-zinc-500 hover:text-zinc-800'
                        }`}
                      >
                        Ignorar
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 tabular-nums">
                    {col.uniqueCount}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 tabular-nums">
                    {col.missingCount}
                  </td>
                  <td className="py-3 px-5 text-xs text-zinc-500 max-w-xs truncate">
                    {col.sampleValues.map((v) => String(v)).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Descriptive Statistics for Numeric Variables */}
      <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50">
          <h2 className="text-base font-semibold text-zinc-900">
            Análisis Descriptivo — Variables Numéricas
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Tendencia central, dispersión, cuartiles y asimetría sobre los{' '}
            <span className="tabular-nums font-mono">{dataset.rows.length}</span> registros.
          </p>
        </div>

        {numericStats.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No hay variables clasificadas como numéricas actualmente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-100/70 border-b border-zinc-200 text-xs font-semibold text-zinc-600">
                  <th className="py-3 px-5">Variable</th>
                  <th className="py-3 px-3 text-right">N</th>
                  <th className="py-3 px-3 text-right">Media</th>
                  <th className="py-3 px-3 text-right">Desv. Est.</th>
                  <th className="py-3 px-3 text-right">Mín</th>
                  <th className="py-3 px-3 text-right">Q1</th>
                  <th className="py-3 px-3 text-right">Mediana</th>
                  <th className="py-3 px-3 text-right">Q3</th>
                  <th className="py-3 px-3 text-right">Máx</th>
                  <th className="py-3 px-4 text-right">Asimetría</th>
                  <th className="py-3 px-5 min-w-[150px]">Distribución Q1–Q3</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs">
                {numericStats.map((st) => {
                  const span = Math.max(1e-9, st.max - st.min);
                  const q1Pct = ((st.q1 - st.min) / span) * 100;
                  const q3Pct = ((st.q3 - st.min) / span) * 100;
                  const medPct = ((st.median - st.min) / span) * 100;

                  return (
                    <tr key={st.column} className="hover:bg-violet-50/25 transition-colors">
                      <td className="py-3 px-5 font-semibold text-sm text-zinc-900 whitespace-nowrap">
                        {st.column}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-600">
                        {st.count}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-zinc-900">
                        {st.mean.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-600">
                        {st.std.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-600">
                        {st.min.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-600">
                        {st.q1.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-violet-800">
                        {st.median.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-600">
                        {st.q3.toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-zinc-600">
                        {st.max.toFixed(1)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-600">
                        {st.skewness.toFixed(2)}
                      </td>
                      <td className="py-3 px-5">
                        <div
                          className="relative h-2.5 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200/70"
                          title={`Min ${st.min.toFixed(1)} · Mediana ${st.median.toFixed(1)} · Max ${st.max.toFixed(1)}`}
                        >
                          <div
                            className="absolute top-0 bottom-0 bg-violet-500/35 rounded-full"
                            style={{
                              left: `${q1Pct}%`,
                              width: `${Math.max(5, q3Pct - q1Pct)}%`,
                            }}
                          />
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-violet-800"
                            style={{ left: `${medPct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Categorical / Factor Histogram */}
      <section className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-100">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Histograma de Variables Categóricas o Tipo Factor
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Frecuencias absolutas y porcentuales por cada nivel del factor seleccionado.
            </p>
          </div>

          {categoricalCols.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-zinc-600 flex items-center gap-2">
                <span>Variable:</span>
                <select
                  value={activeCatCol}
                  onChange={(e) => setSelectedCatCol(e.target.value)}
                  className="px-3 py-1.5 text-xs font-semibold bg-zinc-50 border border-zinc-300 rounded-lg text-zinc-900 focus:outline-none focus:border-violet-700"
                >
                  {categoricalCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.uniqueCount})
                    </option>
                  ))}
                </select>
              </label>

              {targetColumn && targetColumn !== activeCatCol && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupByTarget}
                    onChange={(e) => setGroupByTarget(e.target.checked)}
                    className="rounded border-zinc-300 text-violet-700 focus:ring-violet-700"
                  />
                  <span>Desglosar por objetivo ({targetColumn})</span>
                </label>
              )}
            </div>
          )}
        </div>

        {!catDistribution || categoricalCols.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">
            No hay variables categóricas/factor disponibles.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
              <span className="tabular-nums">
                {catDistribution.totalValid} registros válidos · {catDistribution.uniqueCount}{' '}
                categorías · {catDistribution.missing} nulos
              </span>
              {groupByTarget && targetClasses.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  {targetClasses.map((cls, idx) => (
                    <span key={cls} className="inline-flex items-center gap-1.5 text-zinc-700">
                      <span
                        className="w-2.5 h-2.5 rounded-xs inline-block"
                        style={{ backgroundColor: TARGET_PALETTE[idx % TARGET_PALETTE.length] }}
                      />
                      <span>{cls}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3.5">
              {catDistribution.buckets.slice(0, 15).map((bucket, idx) => {
                const maxCount = Math.max(1, catDistribution.buckets[0]?.count ?? 1);
                const barWidthPct = (bucket.count / maxCount) * 100;

                return (
                  <div key={bucket.value} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-900 truncate pr-4">
                        <span className="font-mono text-zinc-400 mr-2">0{idx + 1}</span>
                        {bucket.value}
                      </span>
                      <span className="font-mono tabular-nums text-zinc-600 shrink-0">
                        <strong className="text-zinc-900">{bucket.count}</strong> (
                        {bucket.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-6 w-full bg-zinc-100 rounded-lg overflow-hidden flex items-center p-0.5">
                      {groupByTarget && bucket.byTarget ? (
                        <div
                          className="h-full flex overflow-hidden rounded-md transition-all"
                          style={{ width: `${barWidthPct}%` }}
                        >
                          {targetClasses.map((cls, cIdx) => {
                            const clsCount = bucket.byTarget?.[cls] ?? 0;
                            const segPct = bucket.count > 0 ? (clsCount / bucket.count) * 100 : 0;
                            if (segPct <= 0) return null;
                            return (
                              <div
                                key={cls}
                                title={`${bucket.value} · ${cls}: ${clsCount}`}
                                style={{
                                  width: `${segPct}%`,
                                  backgroundColor: TARGET_PALETTE[cIdx % TARGET_PALETTE.length],
                                }}
                                className="h-full"
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div
                          className="h-full bg-violet-700 rounded-md transition-all"
                          style={{ width: `${barWidthPct}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
