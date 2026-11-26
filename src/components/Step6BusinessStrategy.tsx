import { useState } from 'react';
import {
  AlertCircle,
  Download,
  Loader2,
  Megaphone,
  Send,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import type {
  BusinessStrategyReport,
  DecisionTreeNode,
  EvaluationMetrics,
} from '../types/analytics';
import { computeFeatureImportance, extractTreeRules } from '../utils/decisionTree';

interface Step6BusinessStrategyProps {
  sectorContext: string;
  datasetName: string;
  targetColumn: string;
  positiveClass: string;
  tree: DecisionTreeNode;
  metrics: EvaluationMetrics;
  strategyReport: BusinessStrategyReport | null;
  onStrategyGenerated: (report: BusinessStrategyReport) => void;
}

export function Step6BusinessStrategy({
  sectorContext,
  datasetName,
  targetColumn,
  positiveClass,
  tree,
  metrics,
  strategyReport,
  onStrategyGenerated,
}: Step6BusinessStrategyProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userQuestion, setUserQuestion] = useState('');

  async function generateStrategy(customPrompt?: string) {
    setLoading(true);
    setError(null);
    try {
      const rules = extractTreeRules(tree);
      const importances = computeFeatureImportance(tree);

      const res = await fetch('/api/business-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectorContext,
          datasetName,
          targetColumn,
          positiveClass,
          metrics: {
            accuracy: metrics.accuracy,
            macroF1: metrics.macroF1,
            weightedF1: metrics.weightedF1,
            macroPrecision: metrics.macroPrecision,
            macroRecall: metrics.macroRecall,
          },
          featureImportances: importances,
          treeRules: rules,
          userQuestion: customPrompt ?? userQuestion,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Error al generar la estrategia de negocio.');
      }
      onStrategyGenerated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar la estrategia.');
    } finally {
      setLoading(false);
    }
  }

  function exportStrategyMarkdown() {
    if (!strategyReport) return;
    const lines: string[] = [
      `# Estrategia de Negocio y Marketing — ${datasetName}`,
      `Sector: ${sectorContext} | Variable Objetivo: ${targetColumn} (Foco: ${positiveClass})`,
      `Evaluación en Prueba (30%): Accuracy ${(metrics.accuracy * 100).toFixed(1)}% · F1 ${(metrics.weightedF1 * 100).toFixed(1)}%`,
      '',
      '## Resumen Ejecutivo',
      strategyReport.executiveSummary,
      '',
      '## Confiabilidad del Modelo',
      strategyReport.modelTrustAssessment,
      '',
      '## Segmentos Derivados del Árbol',
      ...strategyReport.segments.map(
        (s) =>
          `### ${s.segmentName} (${s.predictedOutcome} · ${s.volumeShare})\n- Regla del árbol: \`${s.treeRule}\`\n- Enfoque marketing: ${s.marketingAngle}\n- Canal: ${s.communicationChannel}\n- Mensaje clave: "${s.keyMessage}"`
      ),
      '',
      '## Estrategias de Marketing',
      ...strategyReport.marketingStrategies.map(
        (m) =>
          `### ${m.title}\n- Objetivo: ${m.objective}\n- Táctica: ${m.tactic}\n- Impacto esperado: ${m.expectedImpact}`
      ),
      '',
      '## Plan de Comunicación',
      ...strategyReport.communicationPlan.map(
        (c) =>
          `### Audiencia: ${c.audience}\n- Tono y narrativa: ${c.toneAndNarrative}\n- Canales: ${c.channels.join(', ')}\n- Call to Action: ${c.callToAction}`
      ),
      '',
      '## Plan de Acción y KPIs',
      ...strategyReport.actionPlan.map((a) => `- **${a.horizon}**: ${a.action} (KPI: ${a.kpi})`),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estrategia_${targetColumn}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-zinc-200">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-violet-700">Etapa 06 · Estrategia Comercial</div>
          <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-zinc-900">
            Aplicación al Negocio: Marketing y Comunicación
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl">
            Traduce las reglas reales descubiertas por el árbol y su desempeño en prueba en
            segmentos accionables, campañas de marketing y plan de comunicación.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {strategyReport && (
            <button
              type="button"
              onClick={exportStrategyMarkdown}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar informe (.md)</span>
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => generateStrategy()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 shadow-xs"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>
              {loading
                ? 'Generando estrategia...'
                : strategyReport
                  ? 'Regenerar según árbol actual'
                  : 'Generar estrategia comercial'}
            </span>
          </button>
        </div>
      </div>

      {/* Custom Strategic Focus Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          generateStrategy(userQuestion);
        }}
        className="bg-white border border-zinc-200 rounded-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shadow-xs"
      >
        <input
          type="text"
          value={userQuestion}
          onChange={(e) => setUserQuestion(e.target.value)}
          placeholder="Opcional: especifica un enfoque (ej. campaña de retención con presupuesto acotado, estrategia omnicanal B2B...)"
          className="flex-1 px-3.5 py-2.5 text-sm bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:bg-white focus:border-violet-700"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200/80 rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Aplicar enfoque</span>
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <div>{error}</div>
        </div>
      )}

      {!strategyReport && !loading && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-12 text-center space-y-4 shadow-xs">
          <div className="mx-auto w-12 h-12 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="max-w-lg mx-auto space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900">
              Convierte tu árbol de decisión en decisiones de marketing y negocio
            </h2>
            <p className="text-sm text-zinc-600 leading-relaxed">
              Analizaremos las {extractTreeRules(tree).length} hojas del árbol, la importancia de
              variables y las métricas en prueba (Accuracy{' '}
              <span className="font-mono font-medium text-zinc-900">
                {(metrics.accuracy * 100).toFixed(1)}%
              </span>{' '}
              · F1{' '}
              <span className="font-mono font-medium text-zinc-900">
                {(metrics.weightedF1 * 100).toFixed(1)}%
              </span>
              ) para construir un plan estratégico completo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => generateStrategy()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition-colors shadow-xs"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generar plan estratégico</span>
          </button>
        </div>
      )}

      {loading && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-12 text-center space-y-3 shadow-xs">
          <Loader2 className="w-6 h-6 animate-spin text-violet-700 mx-auto" />
          <p className="text-sm font-medium text-zinc-800">
            Sintetizando segmentos del árbol, tácticas de marketing y mensajes de comunicación...
          </p>
        </div>
      )}

      {strategyReport && !loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section className="lg:col-span-7 bg-white border border-zinc-200 rounded-2xl p-6 space-y-2 shadow-xs">
              <h2 className="text-base font-semibold text-zinc-900">Resumen Ejecutivo</h2>
              <p className="text-sm text-zinc-700 leading-relaxed">
                {strategyReport.executiveSummary}
              </p>
            </section>
            <section className="lg:col-span-5 bg-violet-50/60 border border-violet-200 rounded-2xl p-6 space-y-2 shadow-xs">
              <h2 className="text-base font-semibold text-violet-950">
                Lectura de Confiabilidad del Modelo
              </h2>
              <p className="text-sm text-zinc-700 leading-relaxed">
                {strategyReport.modelTrustAssessment}
              </p>
            </section>
          </div>

          {/* Segments Derived from Tree Rules */}
          <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50 flex items-center gap-2">
              <Target className="w-4 h-4 text-violet-700" />
              <h2 className="text-base font-semibold text-zinc-900">
                Segmentos Accionables (Basados en las Hojas del Árbol)
              </h2>
            </div>
            <div className="divide-y divide-zinc-100">
              {strategyReport.segments.map((seg, idx) => (
                <div key={idx} className="p-6 space-y-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-zinc-900">
                      <span className="font-mono text-xs text-violet-700 mr-2">0{idx + 1}</span>
                      {seg.segmentName}
                    </h3>
                    <div className="text-xs font-mono text-zinc-600 tabular-nums">
                      Predicción: <strong className="text-violet-800">{seg.predictedOutcome}</strong>{' '}
                      · Volumen: {seg.volumeShare}
                    </div>
                  </div>
                  <div className="text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-zinc-800">
                    Regla: {seg.treeRule}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-sm pt-1">
                    <div>
                      <div className="text-xs font-semibold text-zinc-500">Estrategia de oferta</div>
                      <p className="text-zinc-800 mt-1 leading-relaxed">{seg.marketingAngle}</p>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-500">Canal prioritario</div>
                      <p className="text-zinc-800 mt-1 leading-relaxed">
                        {seg.communicationChannel}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-500">Mensaje clave</div>
                      <p className="text-zinc-900 italic mt-1 leading-relaxed">
                        «{seg.keyMessage}»
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Marketing Strategies & Communication Plan */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
                <TrendingUp className="w-4 h-4 text-violet-700" />
                <h2 className="text-base font-semibold text-zinc-900">
                  Estrategias de Marketing y Crecimiento
                </h2>
              </div>
              <div className="divide-y divide-zinc-100">
                {strategyReport.marketingStrategies.map((ms, idx) => (
                  <div key={idx} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                    <h3 className="text-sm font-semibold text-zinc-900">{ms.title}</h3>
                    <p className="text-xs text-zinc-600">
                      <strong>Objetivo:</strong> {ms.objective}
                    </p>
                    <p className="text-sm text-zinc-700 leading-relaxed">{ms.tactic}</p>
                    <p className="text-xs text-violet-800 font-semibold">
                      Impacto esperado: {ms.expectedImpact}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
                <Megaphone className="w-4 h-4 text-violet-700" />
                <h2 className="text-base font-semibold text-zinc-900">
                  Estrategia de Comunicación y Mensajería
                </h2>
              </div>
              <div className="divide-y divide-zinc-100">
                {strategyReport.communicationPlan.map((cp, idx) => (
                  <div key={idx} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                    <h3 className="text-sm font-semibold text-zinc-900">{cp.audience}</h3>
                    <p className="text-sm text-zinc-700 leading-relaxed">{cp.toneAndNarrative}</p>
                    <div className="text-xs text-zinc-600">
                      <strong>Canales:</strong> {cp.channels.join(' · ')}
                    </div>
                    <div className="text-xs font-semibold text-violet-900">
                      Call to Action: «{cp.callToAction}»
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Action Plan & KPIs */}
          <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-zinc-200 bg-zinc-50/50">
              <h2 className="text-base font-semibold text-zinc-900">
                Hoja de Ruta de Implementación y KPIs
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-zinc-100/70 border-b border-zinc-200 text-xs font-semibold text-zinc-600">
                    <th className="py-3 px-6">Horizonte</th>
                    <th className="py-3 px-6">Acción prioritaria</th>
                    <th className="py-3 px-6">KPI de seguimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {strategyReport.actionPlan.map((ap, idx) => (
                    <tr key={idx} className="hover:bg-violet-50/25">
                      <td className="py-3.5 px-6 font-mono text-xs font-semibold text-violet-900 whitespace-nowrap">
                        {ap.horizon}
                      </td>
                      <td className="py-3.5 px-6 text-zinc-800">{ap.action}</td>
                      <td className="py-3.5 px-6 text-xs font-medium text-zinc-600">{ap.kpi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
