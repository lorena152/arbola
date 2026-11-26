import {
  BarChart3,
  Briefcase,
  Check,
  Database,
  GitBranch,
  Grid2x2,
  RotateCcw,
  Target,
} from 'lucide-react';
import type { DatasetState } from '../types/analytics';

export type WorkflowStep = 1 | 2 | 3 | 4 | 5 | 6;

interface SidebarNavProps {
  currentStep: WorkflowStep;
  maxUnlockedStep: WorkflowStep;
  onSelectStep: (step: WorkflowStep) => void;
  dataset: DatasetState | null;
  targetColumn: string;
  onResetWorkspace: () => void;
}

const STEPS: {
  id: WorkflowStep;
  index: string;
  label: string;
  subtitle: string;
  icon: typeof Database;
}[] = [
  {
    id: 1,
    index: '01',
    label: 'Datos y Contexto',
    subtitle: 'Carga, síntesis y 5 registros',
    icon: Database,
  },
  {
    id: 2,
    index: '02',
    label: 'Variables y Estadística',
    subtitle: 'Tipos, descriptivo e histograma',
    icon: BarChart3,
  },
  {
    id: 3,
    index: '03',
    label: 'Objetivo y Split 70/30',
    subtitle: 'Variable dependiente y partición',
    icon: Target,
  },
  {
    id: 4,
    index: '04',
    label: 'Árbol y Poda',
    subtitle: 'Modelo optimizado y pruning',
    icon: GitBranch,
  },
  {
    id: 5,
    index: '05',
    label: 'Matriz y Métricas',
    subtitle: 'Accuracy, F1 y prueba 30%',
    icon: Grid2x2,
  },
  {
    id: 6,
    index: '06',
    label: 'Estrategia de Negocio',
    subtitle: 'Marketing y comunicación',
    icon: Briefcase,
  },
];

export function SidebarNav({
  currentStep,
  maxUnlockedStep,
  onSelectStep,
  dataset,
  targetColumn,
  onResetWorkspace,
}: SidebarNavProps) {
  return (
    <aside className="w-full lg:w-[276px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-zinc-200 flex flex-col justify-between">
      <div className="p-6">
        {/* Architectural Brand Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-700 flex items-center justify-center shrink-0 shadow-xs">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="text-white"
            >
              <circle cx="12" cy="5" r="2.5" fill="currentColor" />
              <circle cx="6.5" cy="18.5" r="2.5" fill="currentColor" />
              <circle cx="17.5" cy="18.5" r="2.5" fill="currentColor" opacity="0.7" />
              <path
                d="M12 7.5V12M12 12L6.5 16M12 12L17.5 16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-zinc-900 leading-none">
              Árbol Studio
            </div>
            <p className="text-xs text-zinc-500 mt-1">Analítica y Decisión ML</p>
          </div>
        </div>

        {/* Vertical Stepper Rail */}
        <nav aria-label="Flujo analítico" className="space-y-1.5">
          {STEPS.map((step) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isUnlocked = step.id <= maxUnlockedStep;
            const isCompleted = step.id < currentStep || (step.id < maxUnlockedStep && !isActive);

            return (
              <button
                key={step.id}
                type="button"
                disabled={!isUnlocked}
                onClick={() => isUnlocked && onSelectStep(step.id)}
                className={`group w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700 ${
                  isActive
                    ? 'bg-violet-50 text-violet-950 ring-1 ring-violet-200/80'
                    : isUnlocked
                      ? 'text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900'
                      : 'text-zinc-400 cursor-not-allowed opacity-55'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'bg-violet-700 text-white'
                      : isCompleted
                        ? 'bg-violet-100 text-violet-800'
                        : 'bg-zinc-100 text-zinc-500 group-hover:bg-zinc-200/70'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight">
                    <span className="font-mono text-[11px] opacity-65">{step.index}</span>
                    <span className="truncate">{step.label}</span>
                  </span>
                  <span className="block text-[11px] text-zinc-500 mt-0.5 truncate">
                    {step.subtitle}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Workspace Summary */}
      <div className="p-5 border-t border-zinc-200 bg-zinc-50/70 space-y-4">
        {dataset ? (
          <div className="space-y-2 text-xs">
            <div className="text-[11px] font-medium text-zinc-400">Proyecto activo</div>
            <div className="font-semibold text-zinc-900 truncate" title={dataset.name}>
              {dataset.name}
            </div>
            <div className="text-zinc-600 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums">
              <span>{dataset.rows.length} registros</span>
              <span aria-hidden="true">·</span>
              <span>{dataset.columns.length} variables</span>
            </div>
            {targetColumn && (
              <div className="pt-1 border-t border-zinc-200/80 text-zinc-600 truncate">
                Objetivo:{' '}
                <span className="font-mono font-semibold text-violet-800">{targetColumn}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 leading-relaxed">
            Carga un archivo o genera un dataset por sector para iniciar el modelado.
          </p>
        )}

        {dataset && (
          <button
            type="button"
            onClick={onResetWorkspace}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-100 hover:text-zinc-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Nuevo proyecto</span>
          </button>
        )}
      </div>
    </aside>
  );
}
