import { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { DatasetState } from '../types/analytics';
import {
  PRESET_DATASETS,
  exportDatasetToCsv,
  inferColumnSchemas,
  parseUploadedFile,
} from '../utils/dataParser';

interface Step1DataIngestionProps {
  dataset: DatasetState | null;
  onDatasetLoaded: (ds: DatasetState, suggestedTarget?: string, positiveClass?: string) => void;
  onNextStep: () => void;
}

const SECTOR_SUGGESTIONS = [
  'Banca y Riesgo Crediticio',
  'E-commerce y Retención de Clientes',
  'Telecomunicaciones (Churn)',
  'Seguros y Siniestralidad',
  'Salud y Triaje Hospitalario',
  'Educación y Deserción Estudiantil',
];

export function Step1DataIngestion({
  dataset,
  onDatasetLoaded,
  onNextStep,
}: Step1DataIngestionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeMode, setActiveMode] = useState<'upload' | 'synthetic' | 'presets'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [sector, setSector] = useState('Retail y Fidelización de Clientes');
  const [rowCount, setRowCount] = useState(350);
  const [scenarioNote, setScenarioNote] = useState('');

  async function handleFile(file: File) {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const parsed = await parseUploadedFile(file);
      onDatasetLoaded(parsed);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No se pudo procesar el archivo seleccionado.'
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGenerateSynthetic(e: React.FormEvent) {
    e.preventDefault();
    if (!sector.trim()) {
      setErrorMessage('Ingresa el contexto o sector para generar la data sintética.');
      return;
    }
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/synthetic-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector, rowCount, scenarioNote }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || 'Error al generar el dataset sintético.');
      }
      const rows = payload.rows ?? [];
      if (rows.length === 0) {
        throw new Error('La generación no produjo registros.');
      }
      const headers = Object.keys(rows[0]);
      const columns = inferColumnSchemas(headers, rows);
      const ds: DatasetState = {
        name: `${sector
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')}_${rows.length}.csv`,
        source: 'synthetic',
        sectorContext: payload.sectorSummary || sector,
        rows,
        columns,
        fileFormat: 'SINTÉTICO',
      };
      onDatasetLoaded(ds, payload.targetColumn, payload.positiveClass);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'No se pudo generar el dataset sintético.'
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleSelectPreset(presetId: string) {
    setErrorMessage(null);
    const preset = PRESET_DATASETS.find((p) => p.id === presetId);
    if (!preset) return;
    const ds = preset.build();
    onDatasetLoaded(ds);
  }

  const previewRows = dataset ? dataset.rows.slice(0, 5) : [];

  return (
    <div className="space-y-8">
      {/* Editorial Section Header + Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 pb-6 border-b border-zinc-200">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-violet-700">Etapa 01 · Ingesta</div>
          <h1 className="text-2xl lg:text-[28px] font-bold tracking-tight text-zinc-900">
            Datos y Contexto del Sector
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl leading-relaxed">
            Carga tu propio archivo (.csv, .txt, .tsv, .xlsx, .xls, .json), genera datos sintéticos
            a la medida de tu industria o utiliza un dataset de referencia.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-zinc-200/70 rounded-xl self-start shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveMode('upload');
              setErrorMessage(null);
            }}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeMode === 'upload'
                ? 'bg-white text-violet-950 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Subir archivo
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode('synthetic');
              setErrorMessage(null);
            }}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeMode === 'synthetic'
                ? 'bg-white text-violet-950 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Data sintética
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode('presets');
              setErrorMessage(null);
            }}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 ${
              activeMode === 'presets'
                ? 'bg-white text-violet-950 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Ejemplos listos
          </button>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <div>{errorMessage}</div>
        </div>
      )}

      {activeMode === 'upload' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) handleFile(dropped);
          }}
          className={`bg-white border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
            isDragging
              ? 'border-violet-600 bg-violet-50/40'
              : 'border-zinc-300 hover:border-violet-400'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.tsv,.dat,.xlsx,.xls,.ods,.json"
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) handleFile(selected);
              e.target.value = '';
            }}
          />
          <div className="mx-auto w-12 h-12 rounded-xl bg-violet-50 border border-violet-200/80 flex items-center justify-center text-violet-700 mb-4">
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-violet-700" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
          </div>
          <h2 className="text-base font-semibold text-zinc-900">
            Arrastra tu archivo aquí o selecciónalo desde tu equipo
          </h2>
          <p className="text-sm text-zinc-500 mt-1.5 max-w-lg mx-auto">
            Compatible con Excel (.xlsx, .xls), CSV, TXT con detección automática de delimitador
            (coma, punto y coma, tabulador o pipe), TSV y JSON tabular.
          </p>
          <div className="mt-6">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-700 hover:bg-violet-800 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 shadow-xs"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{isLoading ? 'Procesando archivo...' : 'Seleccionar archivo'}</span>
            </button>
          </div>
        </div>
      )}

      {activeMode === 'synthetic' && (
        <form
          onSubmit={handleGenerateSynthetic}
          className="bg-white border border-zinc-200 rounded-2xl p-7 space-y-6 shadow-xs"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-2">
              <label htmlFor="sector-input" className="block text-sm font-semibold text-zinc-900">
                Contexto o sector económico
              </label>
              <input
                id="sector-input"
                type="text"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="Ej. Banca minorista, Clínica dental, SaaS B2B, Logística..."
                className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/70 border border-zinc-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-700/15 focus:border-violet-700 transition-colors"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SECTOR_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSector(s)}
                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                      sector === s
                        ? 'bg-violet-50 border-violet-300 text-violet-900 font-medium'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:border-zinc-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="rows-input" className="block text-sm font-semibold text-zinc-900">
                Cantidad de registros
              </label>
              <select
                id="rows-input"
                value={rowCount}
                onChange={(e) => setRowCount(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/70 border border-zinc-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-700/15 focus:border-violet-700 tabular-nums"
              >
                <option value={200}>200 registros</option>
                <option value={350}>350 registros (Recomendado)</option>
                <option value={500}>500 registros</option>
                <option value={800}>800 registros</option>
                <option value={1000}>1,000 registros</option>
              </select>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Sintetiza variables numéricas, factores categóricos y reglas causales del sector.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="scenario-note" className="block text-sm font-semibold text-zinc-900">
              Detalle del problema o variables clave (opcional)
            </label>
            <input
              id="scenario-note"
              type="text"
              value={scenarioNote}
              onChange={(e) => setScenarioNote(e.target.value)}
              placeholder="Ej. Evaluar renovación de membresía según frecuencia de uso, canal de adquisición y promociones"
              className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/70 border border-zinc-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-700/15 focus:border-violet-700"
            />
          </div>

          <div className="flex items-center justify-end pt-2 border-t border-zinc-100">
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-700 hover:bg-violet-800 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 shadow-xs"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>{isLoading ? 'Generando dataset...' : 'Generar dataset sintético'}</span>
            </button>
          </div>
        </form>
      )}

      {activeMode === 'presets' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PRESET_DATASETS.map((preset, idx) => (
            <div
              key={preset.id}
              className="bg-white border border-zinc-200 hover:border-violet-300 rounded-2xl p-6 flex flex-col justify-between gap-5 transition-colors shadow-xs"
            >
              <div>
                <div className="text-xs text-zinc-500 mb-2 flex items-center justify-between">
                  <span>{preset.sector}</span>
                  <span className="font-mono tabular-nums text-zinc-400">0{idx + 1}</span>
                </div>
                <h3 className="text-base font-semibold text-zinc-900 leading-snug">
                  {preset.title}
                </h3>
                <p className="text-sm text-zinc-600 mt-2 leading-relaxed">{preset.description}</p>
              </div>
              <button
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                className="w-full px-4 py-2.5 text-xs font-semibold text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200/70 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                Cargar {preset.rowCount} registros
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview Table: First 5 Records */}
      {dataset && (
        <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-6 py-5 border-b border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-50/50">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">
                Vista previa: Primeros 5 registros
              </h2>
              <p className="text-xs text-zinc-500 mt-1 tabular-nums">
                {dataset.name} · {dataset.rows.length} registros · {dataset.columns.length}{' '}
                variables · {dataset.sectorContext}
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => exportDatasetToCsv(dataset.rows, dataset.columns, dataset.name)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar CSV</span>
              </button>
              <button
                type="button"
                onClick={onNextStep}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-xl transition-colors whitespace-nowrap shrink-0 shadow-xs"
              >
                <span>Analizar variables</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-100/70 border-b border-zinc-200">
                  <th className="py-3 px-4 text-xs font-semibold text-zinc-500 w-12">#</th>
                  {dataset.columns.map((col) => (
                    <th key={col.name} className="py-3 px-4 text-xs font-semibold text-zinc-800">
                      <div className="whitespace-nowrap">{col.name}</div>
                      <div className="text-[11px] font-normal text-zinc-500 mt-0.5">
                        {col.type === 'numeric'
                          ? 'Numérica'
                          : col.type === 'categorical'
                            ? 'Categórica (Factor)'
                            : 'ID / Ignorada'}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm">
                {previewRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-violet-50/25 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-zinc-400 tabular-nums">
                      {idx + 1}
                    </td>
                    {dataset.columns.map((col) => {
                      const val = row[col.name];
                      const isNum = typeof val === 'number';
                      return (
                        <td
                          key={col.name}
                          className={`py-3 px-4 whitespace-nowrap ${
                            isNum
                              ? 'font-mono text-xs text-zinc-900 tabular-nums'
                              : 'text-zinc-700'
                          }`}
                        >
                          {val === null || val === undefined ? (
                            <span className="text-zinc-400 italic">nulo</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
