import * as XLSX from 'xlsx';
import type {
  CategoricalDistribution,
  ColumnSchema,
  DataRow,
  DataValue,
  DatasetState,
  NumericStats,
  TargetSuggestion,
  VariableType,
} from '../types/analytics';

function normalizeCellValue(raw: unknown): DataValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'boolean') {
    return raw ? 'Sí' : 'No';
  }
  const str = String(raw).trim();
  if (
    str === '' ||
    str.toLowerCase() === 'null' ||
    str.toLowerCase() === 'na' ||
    str.toLowerCase() === 'n/a' ||
    str.toLowerCase() === 'nan' ||
    str.toLowerCase() === 'undefined'
  ) {
    return null;
  }

  // Handle numeric strings with optional comma decimal or standard dot decimal
  const cleanedNumber = str.replace(/\s+/g, '');
  if (/^-?\d+(\.\d+)?$/.test(cleanedNumber)) {
    const parsed = Number(cleanedNumber);
    return Number.isFinite(parsed) ? parsed : str;
  }
  // European decimal like 123,45 (single comma, no dots)
  if (/^-?\d+,\d{1,4}$/.test(cleanedNumber)) {
    const parsed = Number(cleanedNumber.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }

  return str;
}

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ',';

  const candidates = [',', ';', '\t', '|'];
  let bestDelim = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = lines.map((line) => {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes && ch === delim) count++;
      }
      return count;
    });
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (avg > 0) {
      const consistencyBonus = minCount === maxCount ? 2 : 0;
      const score = avg + consistencyBonus;
      if (score > bestScore) {
        bestScore = score;
        bestDelim = delim;
      }
    }
  }
  return bestDelim;
}

function parseDelimitedText(text: string): { headers: string[]; rows: DataRow[] } {
  const cleanText = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(cleanText);

  const parsedLines: string[][] = [];
  let currentField = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentField);
        currentField = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentField);
        if (currentRow.some((cell) => cell.trim() !== '')) {
          parsedLines.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField);
        if (currentRow.some((cell) => cell.trim() !== '')) {
          parsedLines.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((cell) => cell.trim() !== '')) {
      parsedLines.push(currentRow);
    }
  }

  if (parsedLines.length < 2) {
    throw new Error('El archivo debe contener encabezados y al menos una fila de datos.');
  }

  const rawHeaders = parsedLines[0].map((h, idx) => {
    const clean = h.trim();
    return clean.length > 0 ? clean : `columna_${idx + 1}`;
  });

  // Ensure unique header names
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const count = seen.get(h) ?? 0;
    seen.set(h, count + 1);
    return count === 0 ? h : `${h}_${count + 1}`;
  });

  const rows: DataRow[] = [];
  for (let r = 1; r < parsedLines.length; r++) {
    const line = parsedLines[r];
    if (line.length === 1 && line[0].trim() === '') continue;
    const row: DataRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = normalizeCellValue(line[c] ?? null);
    }
    rows.push(row);
  }

  return { headers, rows };
}

export function inferColumnSchemas(headers: string[], rows: DataRow[]): ColumnSchema[] {
  return headers.map((name) => {
    let missingCount = 0;
    let numericCount = 0;
    const uniqueValues = new Set<string>();
    const sampleValues: DataValue[] = [];

    for (const row of rows) {
      const val = row[name];
      if (val === null || val === undefined || val === '') {
        missingCount++;
      } else {
        if (typeof val === 'number') numericCount++;
        uniqueValues.add(String(val));
        if (sampleValues.length < 5) sampleValues.push(val);
      }
    }

    const validCount = rows.length - missingCount;
    const uniqueCount = uniqueValues.size;
    const lowerName = name.toLowerCase();

    let detectedType: VariableType = 'categorical';

    // Detect obvious ID columns
    const looksLikeId =
      (lowerName === 'id' ||
        lowerName.endsWith('_id') ||
        lowerName.startsWith('id_') ||
        lowerName === 'codigo' ||
        lowerName === 'uuid') &&
      uniqueCount >= rows.length * 0.85 &&
      rows.length >= 20;

    if (looksLikeId) {
      detectedType = 'ignored';
    } else if (validCount > 0 && numericCount / validCount >= 0.85) {
      // If numeric with very few distinct values (e.g., 0/1 binary flag or 1..4 code), keep numeric if >= 6 unique or non-integer, otherwise numeric unless clearly factor
      // Actually keep 0/1 or >= 5 unique as numeric by default; user can switch any variable to categorical (factor)!
      if (uniqueCount <= 2) {
        detectedType = 'categorical';
      } else {
        detectedType = 'numeric';
      }
    } else {
      detectedType = 'categorical';
    }

    return {
      name,
      detectedType,
      type: detectedType,
      uniqueCount,
      missingCount,
      sampleValues,
    };
  });
}

export async function parseUploadedFile(file: File): Promise<DatasetState> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('El archivo Excel no contiene hojas válidas.');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    if (jsonRows.length === 0) {
      throw new Error('La primera hoja del archivo Excel está vacía.');
    }

    const headers = Object.keys(jsonRows[0]);
    const rows: DataRow[] = jsonRows.map((raw) => {
      const clean: DataRow = {};
      for (const h of headers) {
        clean[h] = normalizeCellValue(raw[h]);
      }
      return clean;
    });

    const columns = inferColumnSchemas(headers, rows);
    return {
      name: file.name,
      source: 'upload',
      sectorContext: `Archivo Excel (${firstSheetName})`,
      rows,
      columns,
      fileFormat: ext.toUpperCase(),
    };
  }

  if (ext === 'json') {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const arr: Record<string, unknown>[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.rows)
          ? parsed.rows
          : [];
    if (arr.length === 0 || typeof arr[0] !== 'object' || arr[0] === null) {
      throw new Error('El JSON debe ser un arreglo de objetos con registros tabulares.');
    }
    const headerSet = new Set<string>();
    arr.slice(0, 50).forEach((item) => Object.keys(item).forEach((k) => headerSet.add(k)));
    const headers = Array.from(headerSet);
    const rows: DataRow[] = arr.map((raw) => {
      const clean: DataRow = {};
      for (const h of headers) {
        clean[h] = normalizeCellValue(raw[h]);
      }
      return clean;
    });
    const columns = inferColumnSchemas(headers, rows);
    return {
      name: file.name,
      source: 'upload',
      sectorContext: 'Archivo JSON estructurado',
      rows,
      columns,
      fileFormat: 'JSON',
    };
  }

  // Default: CSV, TXT, TSV, DAT
  const text = await file.text();
  const { headers, rows } = parseDelimitedText(text);
  if (rows.length < 15) {
    throw new Error('Se requieren al menos 15 registros para realizar un análisis y división 70/30 confiable.');
  }
  const columns = inferColumnSchemas(headers, rows);

  return {
    name: file.name,
    source: 'upload',
    sectorContext: `Archivo plano (${ext.toUpperCase() || 'CSV/TXT'})`,
    rows,
    columns,
    fileFormat: ext.toUpperCase() || 'CSV',
  };
}

export function computeNumericStats(rows: DataRow[], columns: ColumnSchema[]): NumericStats[] {
  const numericCols = columns.filter((c) => c.type === 'numeric');
  return numericCols.map((col) => {
    const values: number[] = [];
    let missing = 0;

    for (const row of rows) {
      const raw = row[col.name];
      if (raw === null || raw === undefined || raw === '') {
        missing++;
      } else {
        const num = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
        if (Number.isFinite(num)) {
          values.push(num);
        } else {
          missing++;
        }
      }
    }

    if (values.length === 0) {
      return {
        column: col.name,
        count: 0,
        missing,
        mean: 0,
        std: 0,
        min: 0,
        q1: 0,
        median: 0,
        q3: 0,
        max: 0,
        iqr: 0,
        skewness: 0,
      };
    }

    values.sort((a, b) => a - b);
    const n = values.length;
    const mean = values.reduce((acc, v) => acc + v, 0) / n;
    const variance =
      n > 1 ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
    const std = Math.sqrt(variance);

    const quantile = (p: number) => {
      const idx = (n - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return values[lo];
      return values[lo] + (values[hi] - values[lo]) * (idx - lo);
    };

    const min = values[0];
    const q1 = quantile(0.25);
    const median = quantile(0.5);
    const q3 = quantile(0.75);
    const max = values[n - 1];
    const iqr = q3 - q1;

    const skewness =
      std > 1e-9 && n > 2
        ? values.reduce((acc, v) => acc + ((v - mean) / std) ** 3, 0) / n
        : 0;

    return {
      column: col.name,
      count: n,
      missing,
      mean,
      std,
      min,
      q1,
      median,
      q3,
      max,
      iqr,
      skewness,
    };
  });
}

export function computeCategoricalDistribution(
  rows: DataRow[],
  columnName: string,
  targetColumn?: string
): CategoricalDistribution {
  const counts = new Map<string, number>();
  const targetBreakdown = new Map<string, Record<string, number>>();
  let missing = 0;
  let totalValid = 0;

  for (const row of rows) {
    const raw = row[columnName];
    if (raw === null || raw === undefined || raw === '') {
      missing++;
      continue;
    }
    const label = String(raw);
    totalValid++;
    counts.set(label, (counts.get(label) ?? 0) + 1);

    if (targetColumn && targetColumn !== columnName) {
      const tVal = row[targetColumn];
      const tLabel = tVal === null || tVal === undefined || tVal === '' ? '(Nulo)' : String(tVal);
      const existing = targetBreakdown.get(label) ?? {};
      existing[tLabel] = (existing[tLabel] ?? 0) + 1;
      targetBreakdown.set(label, existing);
    }
  }

  const buckets = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({
      value,
      count,
      percentage: totalValid > 0 ? (count / totalValid) * 100 : 0,
      byTarget: targetColumn && targetColumn !== columnName ? targetBreakdown.get(value) : undefined,
    }));

  return {
    column: columnName,
    totalValid,
    missing,
    uniqueCount: buckets.length,
    buckets,
  };
}

export function suggestTargetHeuristic(columns: ColumnSchema[], rows: DataRow[]): TargetSuggestion[] {
  const targetKeywords = [
    'target',
    'objetivo',
    'churn',
    'abandono',
    'fuga',
    'compra',
    'compro',
    'conversion',
    'convierte',
    'riesgo',
    'default',
    'mora',
    'incumplimiento',
    'aprobado',
    'fraude',
    'resultado',
    'clase',
    'label',
    'y',
    'diagnostico',
    'renueva',
    'responde',
    'suscripcion',
    'estado',
  ];

  const scored: { col: ColumnSchema; score: number; reason: string; positive?: string }[] = [];

  columns.forEach((col, index) => {
    if (col.type === 'ignored') return;
    let score = 0;
    const reasons: string[] = [];
    const lower = col.name.toLowerCase();

    if (targetKeywords.some((kw) => lower.includes(kw))) {
      score += 55;
      reasons.push('Nombre semánticamente asociado a variable de resultado');
    }

    if (index === columns.length - 1) {
      score += 20;
      reasons.push('Ubicada en la última columna del conjunto de datos');
    }

    if (col.type === 'categorical' && col.uniqueCount >= 2 && col.uniqueCount <= 6) {
      score += 30;
      reasons.push(`Categórica con ${col.uniqueCount} clases bien definidas`);
    } else if (col.type === 'categorical' && col.uniqueCount > 12) {
      score -= 30;
    } else if (col.type === 'numeric' && col.uniqueCount <= 5 && col.uniqueCount >= 2) {
      score += 15;
      reasons.push('Numérica discreta apta para clasificación');
    } else if (col.type === 'numeric' && col.uniqueCount > 15) {
      score -= 10;
      reasons.push('Variable continua (requerirá discretización por cuartiles/rangos para matriz de confusión)');
    }

    // Find recommended positive class
    let positive: string | undefined;
    if (col.uniqueCount >= 2 && col.uniqueCount <= 8) {
      const freq = new Map<string, number>();
      for (const r of rows) {
        const v = r[col.name];
        if (v !== null && v !== undefined && v !== '') {
          const s = String(v);
          freq.set(s, (freq.get(s) ?? 0) + 1);
        }
      }
      const sorted = Array.from(freq.entries()).sort((a, b) => a[1] - b[1]);
      const positiveHints = ['sí', 'si', 'yes', '1', 'true', 'alto', 'churn', 'fuga', 'mora', 'compra', 'positivo'];
      const hintMatch = sorted.find(([k]) => positiveHints.includes(k.toLowerCase()));
      positive = hintMatch ? hintMatch[0] : sorted[0]?.[0];
    }

    if (score > 0 || col.uniqueCount >= 2) {
      scored.push({
        col,
        score,
        reason: reasons.length > 0 ? reasons.join(' · ') : 'Variable candidata disponible para análisis',
        positive,
      });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map((item) => ({
    column: item.col.name,
    confidence: item.score >= 65 ? 'alta' : item.score >= 35 ? 'media' : 'baja',
    reason: item.reason,
    recommendedPositiveClass: item.positive,
  }));
}

export function discretizeNumericTarget(
  rows: DataRow[],
  targetCol: string,
  bins: 2 | 3 = 3
): { rows: DataRow[]; newColumnName: string; labels: string[] } {
  const validNums = rows
    .map((r) => Number(r[targetCol]))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (validNums.length === 0) {
    throw new Error('No hay valores numéricos válidos para discretizar.');
  }

  const quantile = (p: number) => validNums[Math.min(validNums.length - 1, Math.floor((validNums.length - 1) * p))];
  const newColumnName = `${targetCol}_segmento`;

  if (bins === 2) {
    const med = quantile(0.5);
    const lowLabel = `Bajo (≤ ${med.toFixed(1)})`;
    const highLabel = `Alto (> ${med.toFixed(1)})`;
    const newRows = rows.map((r) => {
      const val = Number(r[targetCol]);
      return {
        ...r,
        [newColumnName]: Number.isFinite(val) ? (val <= med ? lowLabel : highLabel) : null,
      };
    });
    return { rows: newRows, newColumnName, labels: [lowLabel, highLabel] };
  }

  const q33 = quantile(0.333);
  const q66 = quantile(0.666);
  const l1 = `Bajo (≤ ${q33.toFixed(1)})`;
  const l2 = `Medio (${q33.toFixed(1)}–${q66.toFixed(1)})`;
  const l3 = `Alto (> ${q66.toFixed(1)})`;
  const newRows = rows.map((r) => {
    const val = Number(r[targetCol]);
    let seg: string | null = null;
    if (Number.isFinite(val)) {
      if (val <= q33) seg = l1;
      else if (val <= q66) seg = l2;
      else seg = l3;
    }
    return { ...r, [newColumnName]: seg };
  });
  return { rows: newRows, newColumnName, labels: [l1, l2, l3] };
}

export function exportDatasetToCsv(rows: DataRow[], columns: ColumnSchema[], filename: string) {
  const headers = columns.map((c) => c.name);
  const escapeCsv = (v: DataValue) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Instant curated sample datasets for immediate testing
export interface PresetDatasetInfo {
  id: string;
  title: string;
  sector: string;
  description: string;
  rowCount: number;
  build: () => DatasetState;
}

function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const PRESET_DATASETS: PresetDatasetInfo[] = [
  {
    id: 'telecom_churn',
    title: 'Telecomunicaciones: Fuga de Clientes (Churn)',
    sector: 'Telecomunicaciones y Suscripciones',
    description: '400 clientes con antigüedad, plan, soporte técnico, tarifa mensual y abandono.',
    rowCount: 400,
    build: () => {
      const rand = seededRand(20261);
      const planes = ['Básico', 'Estándar', 'Premium', 'Empresarial'];
      const contratos = ['Mensual', 'Anual', 'Bianual'];
      const canales = ['App Móvil', 'Web', 'Tienda Física', 'Call Center'];
      const rows: DataRow[] = [];

      for (let i = 1; i <= 400; i++) {
        const contrato = contratos[rand() < 0.52 ? 0 : rand() < 0.78 ? 1 : 2];
        const plan = planes[Math.floor(rand() * planes.length)];
        const canal = canales[Math.floor(rand() * canales.length)];
        const antiguedadMeses = Math.round(
          contrato === 'Mensual' ? 1 + rand() * 30 : 6 + rand() * 60
        );
        const ticketsSoporte = Math.floor(rand() * 6);
        const gastoMensual = Math.round(
          (plan === 'Básico' ? 22 : plan === 'Estándar' ? 42 : plan === 'Premium' ? 68 : 95) +
            (rand() - 0.5) * 14
        );
        const usoDatosGb = Math.round(5 + rand() * 75);

        let churnProb = 0.08;
        if (contrato === 'Mensual') churnProb += 0.28;
        if (ticketsSoporte >= 3) churnProb += 0.34;
        if (antiguedadMeses <= 8) churnProb += 0.2;
        if (gastoMensual > 72 && plan !== 'Empresarial') churnProb += 0.14;
        if (contrato === 'Bianual') churnProb -= 0.12;

        const fuga = rand() < Math.min(0.92, Math.max(0.04, churnProb)) ? 'Sí' : 'No';
        rows.push({
          cliente_id: `CL-${1000 + i}`,
          tipo_contrato: contrato,
          plan_actual: plan,
          canal_alta: canal,
          antiguedad_meses: antiguedadMeses,
          tickets_soporte: ticketsSoporte,
          gasto_mensual_usd: gastoMensual,
          consumo_gb: usoDatosGb,
          abandono_churn: fuga,
        });
      }

      const headers = Object.keys(rows[0]);
      return {
        name: 'telecom_churn_400.csv',
        source: 'preset',
        sectorContext: 'Telecomunicaciones y Suscripciones',
        rows,
        columns: inferColumnSchemas(headers, rows),
        fileFormat: 'PRESET',
      };
    },
  },
  {
    id: 'ecommerce_conversion',
    title: 'E-commerce: Propensión de Compra',
    sector: 'Comercio Electrónico y Retail Digital',
    description: '360 sesiones de usuarios con origen de tráfico, dispositivo, tiempo en sitio y compra.',
    rowCount: 360,
    build: () => {
      const rand = seededRand(99412);
      const origenes = ['Orgánico', 'Paid Social', 'Google Ads', 'Email Marketing', 'Referido'];
      const dispositivos = ['Móvil', 'Escritorio', 'Tablet'];
      const segmentos = ['Nuevo', 'Recurrente', 'VIP'];
      const rows: DataRow[] = [];

      for (let i = 1; i <= 360; i++) {
        const origen = origenes[Math.floor(rand() * origenes.length)];
        const dispositivo = dispositivos[rand() < 0.58 ? 0 : rand() < 0.9 ? 1 : 2];
        const segmento = segmentos[rand() < 0.5 ? 0 : rand() < 0.85 ? 1 : 2];
        const paginasVistas = Math.max(1, Math.round(2 + rand() * 16));
        const tiempoMinutos = Number((0.8 + rand() * 14).toFixed(1));
        const descuentoPct = rand() < 0.4 ? Math.round((1 + Math.floor(rand() * 3)) * 10) : 0;
        const valorCarrito = Math.round(25 + rand() * 240);

        let prob = 0.1;
        if (tiempoMinutos >= 5.5) prob += 0.25;
        if (paginasVistas >= 7) prob += 0.2;
        if (segmento === 'VIP' || segmento === 'Recurrente') prob += 0.22;
        if (descuentoPct >= 20) prob += 0.18;
        if (origen === 'Email Marketing') prob += 0.15;
        if (dispositivo === 'Móvil' && valorCarrito > 180) prob -= 0.14;

        const compra = rand() < Math.min(0.94, Math.max(0.05, prob)) ? 'Compra' : 'No Compra';
        rows.push({
          canal_trafico: origen,
          dispositivo,
          segmento_cliente: segmento,
          paginas_vistas: paginasVistas,
          tiempo_sesion_min: tiempoMinutos,
          descuento_aplicado_pct: descuentoPct,
          valor_carrito_usd: valorCarrito,
          resultado_compra: compra,
        });
      }

      const headers = Object.keys(rows[0]);
      return {
        name: 'ecommerce_conversion_360.csv',
        source: 'preset',
        sectorContext: 'Comercio Electrónico y Retail Digital',
        rows,
        columns: inferColumnSchemas(headers, rows),
        fileFormat: 'PRESET',
      };
    },
  },
  {
    id: 'banca_credito',
    title: 'Banca: Evaluación de Riesgo Crediticio',
    sector: 'Banca y Servicios Financieros',
    description: '420 solicitudes de crédito con ingresos, historial, endeudamiento y estado de mora.',
    rowCount: 420,
    build: () => {
      const rand = seededRand(44801);
      const empleos = ['Dependiente', 'Independiente', 'Empresario', 'Temporal'];
      const propositos = ['Vivienda', 'Vehículo', 'Consumo', 'Educación', 'Negocio'];
      const historiales = ['Excelente', 'Regular', 'Con atrasos'];
      const rows: DataRow[] = [];

      for (let i = 1; i <= 420; i++) {
        const empleo = empleos[Math.floor(rand() * empleos.length)];
        const proposito = propositos[Math.floor(rand() * propositos.length)];
        const historial = historiales[rand() < 0.5 ? 0 : rand() < 0.82 ? 1 : 2];
        const ingresoMensual = Math.round(800 + rand() * 4800);
        const ratioDeudaPct = Math.round(10 + rand() * 65);
        const montoSolicitado = Math.round(1500 + rand() * 28000);
        const edad = Math.round(21 + rand() * 44);

        let riskProb = 0.07;
        if (historial === 'Con atrasos') riskProb += 0.42;
        else if (historial === 'Regular') riskProb += 0.16;
        if (ratioDeudaPct > 45) riskProb += 0.28;
        if (ingresoMensual < 1700 && montoSolicitado > 12000) riskProb += 0.22;
        if (empleo === 'Temporal') riskProb += 0.12;

        const riesgo = rand() < Math.min(0.93, Math.max(0.04, riskProb)) ? 'Alto Riesgo' : 'Bajo Riesgo';
        rows.push({
          tipo_empleo: empleo,
          proposito_credito: proposito,
          historial_crediticio: historial,
          edad,
          ingreso_mensual_usd: ingresoMensual,
          ratio_deuda_pct: ratioDeudaPct,
          monto_solicitado_usd: montoSolicitado,
          clasificacion_riesgo: riesgo,
        });
      }

      const headers = Object.keys(rows[0]);
      return {
        name: 'banca_riesgo_credito_420.csv',
        source: 'preset',
        sectorContext: 'Banca y Servicios Financieros',
        rows,
        columns: inferColumnSchemas(headers, rows),
        fileFormat: 'PRESET',
      };
    },
  },
];
