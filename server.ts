import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '4mb' }));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY no está configurada. Configura la clave en Settings > Secrets para usar la generación por IA.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientHighDemandError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return (
    status === 503 ||
    status === 429 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('RESOURCE_EXHAUSTED')
  );
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403')) {
    return {
      status: 403,
      message:
        'Clave de API inválida o sin permisos. Verifica GEMINI_API_KEY en Settings > Secrets.',
    };
  }
  if (isTransientHighDemandError(err)) {
    return {
      status: 503,
      message:
        'Los modelos de IA están experimentando alta demanda temporal (503). Por favor intenta nuevamente en unos segundos.',
    };
  }
  return {
    status: 500,
    message: raw || 'Error al procesar la solicitud con IA.',
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateJsonWithResilience(
  ai: GoogleGenAI,
  contents: string,
  responseSchema: Record<string, unknown>
): Promise<string> {
  const modelAttempts = [
    { model: 'gemini-4-hydrogen', delayBeforeMs: 0 },
    { model: 'gemini-4-hydrogen', delayBeforeMs: 900 },
    { model: 'gemini-3.1-flash-lite', delayBeforeMs: 400 },
    { model: 'gemini-3.1-flash-lite', delayBeforeMs: 1400 },
  ];

  let lastError: unknown;
  for (const attempt of modelAttempts) {
    if (attempt.delayBeforeMs > 0) {
      await sleep(attempt.delayBeforeMs);
    }
    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      const text = (response.text ?? '').trim();
      if (text) return text;
      lastError = new Error('El modelo devolvió una respuesta vacía.');
    } catch (err) {
      lastError = err;
      if (!isTransientHighDemandError(err)) {
        throw err;
      }
      console.warn(
        `Modelo ${attempt.model} temporalmente saturado, reintentando con backoff/respaldo...`
      );
    }
  }

  throw lastError;
}

function gaussianRandom(mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}

function pickWeighted(items: { value: string; weight: number }[]): string {
  const total = items.reduce((acc, item) => acc + Math.max(0.01, item.weight), 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= Math.max(0.01, item.weight);
    if (r <= 0) return item.value;
  }
  return items[items.length - 1]?.value ?? 'Otro';
}

app.post('/api/synthetic-data', async (req, res) => {
  try {
    const { sector, rowCount = 350, scenarioNote = '' } = req.body ?? {};
    if (!sector || typeof sector !== 'string' || sector.trim().length < 2) {
      res.status(400).json({ error: 'Debes indicar un sector o contexto de negocio válido.' });
      return;
    }

    const safeRowCount = Math.min(1200, Math.max(100, Number(rowCount) || 350));
    const ai = getGeminiClient();

    const prompt = `Diseña el esquema estadístico y causal para un conjunto de datos sintético realista en español del sector: "${sector.trim()}".
${scenarioNote ? `Contexto adicional del usuario: "${String(scenarioNote).trim()}".` : ''}
Requisitos:
- Todas las columnas y categorías deben estar en español claro, usando snake_case para nombres de columna.
- Incluye exactamente 4 variables numéricas relevantes al sector y 3 variables categóricas (de tipo factor, cada una con 3 a 5 categorías y pesos de frecuencia realistas).
- Define 1 variable objetivo (dependiente) binaria o de 2 clases claras (por ejemplo "Sí"/"No" o "Alto Riesgo"/"Bajo Riesgo" o "Convierte"/"No Convierte").
- Define entre 5 y 7 reglas causales realistas que conecten las variables con la probabilidad de la clase positiva, para que un árbol de decisión pueda descubrir patrones interpretables pero con incertidumbre realista.`;

    const rawText = await generateJsonWithResilience(ai, prompt, {
      type: Type.OBJECT,
      properties: {
        datasetTitle: { type: Type.STRING },
        sectorSummary: { type: Type.STRING },
        targetColumn: { type: Type.STRING },
        positiveClass: { type: Type.STRING },
        negativeClass: { type: Type.STRING },
        basePositiveProbability: { type: Type.NUMBER },
        numericFeatures: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              min: { type: Type.NUMBER },
              max: { type: Type.NUMBER },
              mean: { type: Type.NUMBER },
              std: { type: Type.NUMBER },
              decimals: { type: Type.INTEGER },
            },
            required: ['name', 'min', 'max', 'mean', 'std', 'decimals'],
          },
        },
        categoricalFeatures: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              categories: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    value: { type: Type.STRING },
                    weight: { type: Type.NUMBER },
                  },
                  required: ['value', 'weight'],
                },
              },
            },
            required: ['name', 'categories'],
          },
        },
        causalRules: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              featureName: { type: Type.STRING },
              operator: { type: Type.STRING, description: 'gt, lt, or eq' },
              numericThreshold: { type: Type.NUMBER },
              categoryValue: { type: Type.STRING },
              probabilityShift: {
                type: Type.NUMBER,
                description: 'Shift added to positive class probability, e.g. 0.25 or -0.18',
              },
            },
            required: ['featureName', 'operator', 'probabilityShift'],
          },
        },
      },
      required: [
        'datasetTitle',
        'sectorSummary',
        'targetColumn',
        'positiveClass',
        'negativeClass',
        'basePositiveProbability',
        'numericFeatures',
        'categoricalFeatures',
        'causalRules',
      ],
    });

    const blueprint = JSON.parse(rawText);
    const numFeats = Array.isArray(blueprint.numericFeatures) ? blueprint.numericFeatures : [];
    const catFeats = Array.isArray(blueprint.categoricalFeatures) ? blueprint.categoricalFeatures : [];
    const rules = Array.isArray(blueprint.causalRules) ? blueprint.causalRules : [];
    const baseProb = Math.min(0.65, Math.max(0.1, Number(blueprint.basePositiveProbability) || 0.25));

    const rows: Record<string, string | number>[] = [];

    for (let i = 0; i < safeRowCount; i++) {
      const row: Record<string, string | number> = {};

      for (const cf of catFeats) {
        const cats =
          Array.isArray(cf.categories) && cf.categories.length > 0
            ? cf.categories
            : [
                { value: 'Categoría A', weight: 0.5 },
                { value: 'Categoría B', weight: 0.5 },
              ];
        row[cf.name] = pickWeighted(cats);
      }

      for (const nf of numFeats) {
        const min = Number(nf.min) || 0;
        const max = Math.max(min + 1, Number(nf.max) || 100);
        const mean = Math.min(max, Math.max(min, Number(nf.mean) || (min + max) / 2));
        const std = Math.max(0.5, Number(nf.std) || (max - min) / 5);
        const dec = Math.min(3, Math.max(0, Number(nf.decimals) || 0));
        const rawVal = Math.min(max, Math.max(min, gaussianRandom(mean, std)));
        row[nf.name] = Number(rawVal.toFixed(dec));
      }

      let prob = baseProb;
      for (const rule of rules) {
        const val = row[rule.featureName];
        if (val === undefined) continue;
        const shift = Number(rule.probabilityShift) || 0;
        const op = String(rule.operator).toLowerCase();
        if (op === 'gt' && typeof val === 'number' && typeof rule.numericThreshold === 'number') {
          if (val > rule.numericThreshold) prob += shift;
        } else if (op === 'lt' && typeof val === 'number' && typeof rule.numericThreshold === 'number') {
          if (val < rule.numericThreshold) prob += shift;
        } else if (op === 'eq' && rule.categoryValue) {
          if (String(val) === String(rule.categoryValue)) prob += shift;
        }
      }

      // Clamp between 0.04 and 0.94 so there is realistic noise without pure determinism
      const finalProb = Math.min(0.94, Math.max(0.04, prob));
      row[blueprint.targetColumn] =
        Math.random() < finalProb ? blueprint.positiveClass : blueprint.negativeClass;

      rows.push(row);
    }

    res.json({
      datasetTitle: blueprint.datasetTitle,
      sectorSummary: blueprint.sectorSummary,
      targetColumn: blueprint.targetColumn,
      positiveClass: blueprint.positiveClass,
      rows,
    });
  } catch (error) {
    console.error('Error en /api/synthetic-data:', error);
    const { status, message } = formatGeminiError(error);
    res.status(status).json({ error: message });
  }
});

app.post('/api/suggest-target', async (req, res) => {
  try {
    const { datasetName, sectorContext, columns } = req.body ?? {};
    if (!Array.isArray(columns) || columns.length === 0) {
      res.status(400).json({ error: 'Se requiere la lista de columnas para sugerir la variable objetivo.' });
      return;
    }

    const ai = getGeminiClient();

    const prompt = `Analiza el siguiente conjunto de datos y sugiere qué columna debe ser la variable dependiente (objetivo) para entrenar un árbol de decisión de clasificación, formulando una pregunta clara al usuario para confirmar su objetivo de análisis.
Dataset: ${datasetName || 'Sin nombre'}
Contexto/Sector: ${sectorContext || 'General'}
Columnas:
${columns
  .map(
    (c: { name: string; type: string; uniqueCount: number; sampleValues: unknown[] }) =>
      `- ${c.name} (tipo: ${c.type}, valores únicos: ${c.uniqueCount}, ejemplos: ${JSON.stringify(c.sampleValues)})`
  )
  .join('\n')}

Responde en español profesional y directo.`;

    const text = await generateJsonWithResilience(ai, prompt, {
      type: Type.OBJECT,
      properties: {
        domainSummary: { type: Type.STRING },
        clarifyingQuestion: { type: Type.STRING },
        suggestions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              column: { type: Type.STRING },
              confidence: { type: Type.STRING, description: 'alta, media, or baja' },
              reason: { type: Type.STRING },
              recommendedPositiveClass: { type: Type.STRING },
            },
            required: ['column', 'confidence', 'reason'],
          },
        },
      },
      required: ['domainSummary', 'clarifyingQuestion', 'suggestions'],
    });

    res.json(JSON.parse(text));
  } catch (error) {
    console.error('Error en /api/suggest-target:', error);
    const { status, message } = formatGeminiError(error);
    res.status(status).json({ error: message });
  }
});

app.post('/api/business-strategy', async (req, res) => {
  try {
    const {
      sectorContext,
      datasetName,
      targetColumn,
      positiveClass,
      metrics,
      featureImportances,
      treeRules,
      userQuestion,
    } = req.body ?? {};

    if (!targetColumn || !Array.isArray(treeRules)) {
      res.status(400).json({ error: 'Faltan las reglas del árbol o la variable objetivo.' });
      return;
    }

    const ai = getGeminiClient();

    const prompt = `Eres un director de estrategia comercial, marketing y analítica avanzada. Traduce los resultados reales de un Árbol de Decisión (evaluado sobre un conjunto de prueba del 30%) en un plan accionable de negocio, marketing y comunicación en español.

Contexto del negocio:
- Sector: ${sectorContext || 'General'}
- Dataset: ${datasetName || 'Dataset'}
- Variable objetivo: ${targetColumn} (Clase foco de negocio: ${positiveClass || 'N/A'})
- Desempeño en Prueba (30%): Accuracy=${((metrics?.accuracy ?? 0) * 100).toFixed(1)}%, F1-Macro=${((metrics?.macroF1 ?? 0) * 100).toFixed(1)}%, Precisión=${((metrics?.macroPrecision ?? 0) * 100).toFixed(1)}%, Recall=${((metrics?.macroRecall ?? 0) * 100).toFixed(1)}%

Variables más importantes según el árbol:
${(featureImportances ?? [])
  .slice(0, 6)
  .map((f: { feature: string; importance: number }) => `- ${f.feature}: ${f.importance.toFixed(1)}%`)
  .join('\n')}

Reglas principales extraídas de las hojas del árbol actual:
${treeRules
  .slice(0, 8)
  .map(
    (r: { conditions: string[]; prediction: string; confidence: number; samples: number; supportPct: number }, idx: number) =>
      `${idx + 1}. SI [${r.conditions.length > 0 ? r.conditions.join(' Y ') : 'Raíz'}] -> Predice "${r.prediction}" (Confianza: ${(r.confidence * 100).toFixed(1)}%, Cobertura: ${r.supportPct.toFixed(1)}%, n=${r.samples})`
  )
  .join('\n')}

${userQuestion ? `Pregunta o enfoque específico solicitado por el usuario: "${String(userQuestion)}"` : ''}

Asegúrate de citar exactamente las variables y umbrales que descubrió el árbol en los segmentos, proponer tácticas concretas de marketing (oferta, precios, retención o conversión), mensajes y canales de comunicación diferenciados por segmento, y KPIs medibles.`;

    const text = await generateJsonWithResilience(ai, prompt, {
      type: Type.OBJECT,
      properties: {
        executiveSummary: { type: Type.STRING },
        modelTrustAssessment: { type: Type.STRING },
        segments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              segmentName: { type: Type.STRING },
              treeRule: { type: Type.STRING },
              predictedOutcome: { type: Type.STRING },
              volumeShare: { type: Type.STRING },
              marketingAngle: { type: Type.STRING },
              communicationChannel: { type: Type.STRING },
              keyMessage: { type: Type.STRING },
            },
            required: [
              'segmentName',
              'treeRule',
              'predictedOutcome',
              'volumeShare',
              'marketingAngle',
              'communicationChannel',
              'keyMessage',
            ],
          },
        },
        marketingStrategies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              objective: { type: Type.STRING },
              tactic: { type: Type.STRING },
              expectedImpact: { type: Type.STRING },
            },
            required: ['title', 'objective', 'tactic', 'expectedImpact'],
          },
        },
        communicationPlan: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              audience: { type: Type.STRING },
              toneAndNarrative: { type: Type.STRING },
              channels: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              callToAction: { type: Type.STRING },
            },
            required: ['audience', 'toneAndNarrative', 'channels', 'callToAction'],
          },
        },
        actionPlan: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              horizon: { type: Type.STRING },
              action: { type: Type.STRING },
              kpi: { type: Type.STRING },
            },
            required: ['horizon', 'action', 'kpi'],
          },
        },
      },
      required: [
        'executiveSummary',
        'modelTrustAssessment',
        'segments',
        'marketingStrategies',
        'communicationPlan',
        'actionPlan',
      ],
    });

    res.json(JSON.parse(text));
  } catch (error) {
    console.error('Error en /api/business-strategy:', error);
    const { status, message } = formatGeminiError(error);
    res.status(status).json({ error: message });
  }
});

app.post('/api/error-impact', async (req, res) => {
  try {
    const {
      sectorContext,
      datasetName,
      targetColumn,
      positiveClass,
      totalTest,
      tp,
      fp,
      fn,
      tn,
      accuracy,
      weightedF1,
    } = req.body ?? {};

    if (!targetColumn || !positiveClass) {
      res.status(400).json({ error: 'Se requiere la variable objetivo y la clase foco.' });
      return;
    }

    const ai = getGeminiClient();

    const prompt = `Eres un consultor senior de ciencia de datos aplicada y economía de negocio. Interpreta exclusivamente las consecuencias comerciales, económicas y operativas de los errores reales de clasificación obtenidos en la matriz de confusión sobre el 30% de prueba.

Contexto del negocio:
- Sector: ${sectorContext || 'General'}
- Dataset: ${datasetName || 'Dataset'}
- Variable objetivo: ${targetColumn}
- Clase positiva / foco analizada: "${positiveClass}"
- Total registros en prueba (30%): ${totalTest}
- Verdaderos Positivos (VP): ${tp}
- Falsos Positivos (FP - predijo "${positiveClass}", pero realmente no lo era): ${fp}
- Falsos Negativos (FN - no predijo "${positiveClass}", pero realmente sí lo era): ${fn}
- Verdaderos Negativos (VN): ${tn}
- Accuracy en prueba: ${((Number(accuracy) || 0) * 100).toFixed(1)}%
- F1-Score ponderado en prueba: ${((Number(weightedF1) || 0) * 100).toFixed(1)}%

Explica en español claro, directo y aterrizado al sector:
1. Qué significa exactamente un Falso Positivo en este negocio (con los ${fp} casos reales detectados) y qué costo comercial, económico u operativo implica.
2. Qué significa exactamente un Falso Negativo en este negocio (con los ${fn} casos reales detectados) y qué costo comercial, económico u operativo implica.
3. Cuál de los dos errores resulta más crítico mitigar en este sector y qué ajuste operativo o de equilibrio recomiendas.`;

    const text = await generateJsonWithResilience(ai, prompt, {
      type: Type.OBJECT,
      properties: {
        falsePositiveImpact: { type: Type.STRING },
        falseNegativeImpact: { type: Type.STRING },
        balanceRecommendation: { type: Type.STRING },
        priorityErrorType: {
          type: Type.STRING,
          description: 'Must be FP, FN, or Equilibrado',
        },
      },
      required: [
        'falsePositiveImpact',
        'falseNegativeImpact',
        'balanceRecommendation',
        'priorityErrorType',
      ],
    });

    res.json(JSON.parse(text));
  } catch (error) {
    console.error('Error en /api/error-impact:', error);
    const { status, message } = formatGeminiError(error);
    res.status(status).json({ error: message });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Árbol Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
