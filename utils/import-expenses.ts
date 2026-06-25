import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

export interface MappedExpense {
  category: string;
  amount: number;
  date: string;
  note: string | null;
  tournament_name: string | null;
}

export interface ImportResult {
  mapped: MappedExpense[];
  unmapped: number;
  columns: string[];
}

async function readFileContent(uri: string, name: string): Promise<string[][]> {
  const lowerName = name.toLowerCase();

  if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv') || lowerName.endsWith('.txt')) {
    const text = await readAsStringAsync(uri);
    if (!text) throw new Error('File is empty');
    const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
    return parsed.data;
  }

  // Parse Excel locally using xlsx library
  let base64: string;
  try {
    base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  } catch (readErr: any) {
    throw new Error(`Could not read file: ${readErr?.message ?? 'unknown error'}`);
  }
  if (!base64 || base64.length === 0) throw new Error('File is empty or could not be read');

  try {
    const workbook = XLSX.read(base64, { type: 'base64' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('No sheets found in workbook');
    const sheet = workbook.Sheets[sheetName];
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    if (rows.length === 0) throw new Error('No data found in file');
    return rows;
  } catch (xlsxErr: any) {
    throw new Error(`Could not parse Excel file: ${xlsxErr?.message ?? 'unknown error'}`);
  }
}

export async function pickAndParseFile(): Promise<{ rows: string[][]; fileName: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'text/csv',
      'text/comma-separated-values',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      '*/*',
    ],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const file = result.assets[0];
  const rows = await readFileContent(file.uri, file.name);

  if (!rows || rows.length < 2) throw new Error('File needs at least a header row and one data row');
  if (!Array.isArray(rows[0])) throw new Error(`Unexpected row format: ${JSON.stringify(rows[0]).slice(0, 200)}`);

  return { rows, fileName: file.name };
}

const FIELD_KEYWORDS: Record<string, string[]> = {
  amount: ['amount', 'monto', 'total', 'cost', 'price', 'valor', 'gasto', 'expense', 'usd', 'dollars', 'money', 'sum', 'costo', 'importe', 'fee', 'charge', 'debit', 'credit', 'pago', 'paid', 'spend', 'spent'],
  date: ['date', 'fecha', 'day', 'dia', 'when', 'periodo', 'period', 'mes', 'month', 'transaction date', 'posting date', 'fecha de transaccion'],
  category: ['category', 'categoria', 'type', 'tipo', 'kind', 'class', 'rubro', 'concepto', 'item', 'merchant', 'vendor', 'comercio', 'payee'],
  note: ['note', 'nota', 'notes', 'notas', 'description', 'descripcion', 'detail', 'detalle', 'comment', 'comentario', 'memo', 'obs', 'observacion', 'reference', 'referencia', 'concept'],
  tournament: ['tournament', 'torneo', 'event', 'evento', 'competition', 'competencia', 'comp', 'location', 'lugar', 'city', 'ciudad', 'venue', 'sede'],
};

function scoreRow(row: string[]): number {
  let hits = 0;
  for (const cell of row) {
    const h = String(cell).toLowerCase().trim();
    if (!h) continue;
    for (const keywords of Object.values(FIELD_KEYWORDS)) {
      if (keywords.some(kw => h === kw || h.includes(kw))) { hits++; break; }
    }
  }
  return hits;
}

export function detectHeaderRow(rows: string[][]): { headerIdx: number; headers: string[]; dataRows: string[][] } {
  let bestIdx = 0;
  let bestScore = 0;

  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 2) continue;
    const score = scoreRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  // If no header was found by keywords, use the first row as header
  const headers = rows[bestIdx].map(h => String(h).trim());
  const dataRows = rows.slice(bestIdx + 1);
  return { headerIdx: bestIdx, headers, dataRows };
}

export function mapColumnsLocal(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<number>();

  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i].toLowerCase().trim();
      if (!h) continue;

      for (const kw of keywords) {
        if (h === kw) {
          if (10 > bestScore) { bestScore = 10; bestIdx = i; }
        } else if (h.includes(kw)) {
          const score = kw.length;
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
      }
    }

    if (bestIdx !== -1) {
      mapping[field] = headers[bestIdx];
      used.add(bestIdx);
    }
  }

  // Fallback: if no amount column found, look for a column with numeric data
  if (!mapping.amount) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i].toLowerCase().trim();
      if (/\$|usd|clp|eur|amount|total|price|cost/i.test(h) || /^\d/.test(h)) {
        mapping.amount = headers[i];
        used.add(i);
        break;
      }
    }
  }

  return mapping;
}

function parseDate(val: any): string | null {
  if (val == null) return null;

  // Handle Excel serial date numbers
  if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val.trim()) && parseInt(val) > 30000 && parseInt(val) < 60000)) {
    const num = typeof val === 'number' ? val : parseInt(val);
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  }

  const str = String(val).trim();
  if (!str) return null;

  // ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or MM/DD/YYYY — use heuristic for South American format (DD/MM)
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) {
    const parts = str.split('/');
    const a = parseInt(parts[0]);
    const b = parseInt(parts[1]);
    let y = parts[2];
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;

    // If first number > 12, it must be a day (DD/MM/YYYY)
    if (a > 12 && b <= 12) {
      return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    // If second number > 12, it must be a day (MM/DD/YYYY)
    if (b > 12 && a <= 12) {
      return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    // Ambiguous — default to DD/MM/YYYY (South American standard)
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }

  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(str)) {
    const parts = str.split('-');
    const a = parseInt(parts[0]);
    const b = parseInt(parts[1]);
    let y = parts[2];
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;

    if (a > 12 && b <= 12) {
      return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    if (b > 12 && a <= 12) {
      return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }

  // DD.MM.YYYY
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(str)) {
    const parts = str.split('.');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    return `${y}-${m}-${d}`;
  }

  // Try native Date parse as last resort
  const d = new Date(str);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
    return d.toISOString().split('T')[0];
  }

  return null;
}

function parseAmount(val: any): number | null {
  if (val == null) return null;
  const str = String(val)
    .replace(/[$€£¥₡]/g, '')
    .replace(/\s/g, '')
    .trim();

  // Handle thousand separators: "1.500,50" (European/SA) or "1,500.50" (US)
  let normalized = str;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(str)) {
    // European/SA: 1.500,50 → 1500.50
    normalized = str.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(str)) {
    // US: 1,500.50 → 1500.50
    normalized = str.replace(/,/g, '');
  } else {
    // Simple comma as decimal: "500,50" → "500.50"
    normalized = str.replace(',', '.');
  }

  const num = parseFloat(normalized);
  return isNaN(num) || num === 0 ? null : Math.abs(num);
}

const EXPENSE_CATEGORIES: Record<string, string[]> = {
  'Travel': ['flight', 'vuelo', 'plane', 'avion', 'airline', 'uber', 'taxi', 'bus', 'train', 'tren', 'gas', 'transport', 'transporte', 'lyft', 'rental', 'toll', 'peaje', 'parking'],
  'Accommodation': ['hotel', 'airbnb', 'hostel', 'room', 'habitacion', 'alojamiento', 'accommodation', 'lodge', 'rent', 'arriendo', 'booking', 'hospedaje'],
  'Food': ['meal', 'comida', 'food', 'dinner', 'cena', 'lunch', 'almuerzo', 'breakfast', 'desayuno', 'restaurant', 'coffee', 'cafe', 'snack', 'grocery', 'supermercado'],
  'Equipment': ['racket', 'raqueta', 'string', 'cuerda', 'encordado', 'grip', 'shoes', 'zapatillas', 'clothes', 'ropa', 'bag', 'gear', 'equipment', 'equipo'],
  'Entry Fee': ['entry', 'inscripcion', 'registration', 'registro', 'sign up', 'entry fee', 'tournament fee'],
  'Coaching': ['coach', 'coaching', 'entrenador', 'trainer', 'training', 'entrenamiento', 'lesson', 'clase', 'academy'],
  'Physio': ['physio', 'physiotherapy', 'kinesiolog', 'massage', 'masaje', 'doctor', 'medical', 'medico', 'therapy', 'terapia'],
};

function inferCategory(row: string[]): string {
  const text = row.join(' ').toLowerCase();
  let bestCat = 'Other';
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(EXPENSE_CATEGORIES)) {
    for (const kw of keywords) {
      if (text.includes(kw) && kw.length > bestScore) {
        bestScore = kw.length;
        bestCat = cat;
      }
    }
  }
  return bestCat;
}

export function applyMapping(
  rows: string[][],
  headers: string[],
  mapping: Record<string, string>,
): ImportResult {
  if (!mapping || typeof mapping !== 'object') {
    return { mapped: [], unmapped: rows.length, columns: headers };
  }

  const colIndex: Record<string, number> = {};
  for (const [ourField, theirCol] of Object.entries(mapping)) {
    if (!theirCol) continue;
    const idx = headers.findIndex(h => h.toLowerCase().trim() === theirCol.toLowerCase().trim());
    if (idx !== -1) colIndex[ourField] = idx;
  }

  // If no amount column was mapped, try to find one by scanning data
  if (colIndex['amount'] === undefined) {
    for (let i = 0; i < headers.length; i++) {
      if (Object.values(colIndex).includes(i)) continue;
      const sampleVals = rows.slice(0, 5).map(r => r[i]);
      const numericCount = sampleVals.filter(v => {
        if (!v) return false;
        const cleaned = String(v).replace(/[$€£,.\s]/g, '').trim();
        return /^\d+$/.test(cleaned);
      }).length;
      if (numericCount >= 3) {
        colIndex['amount'] = i;
        break;
      }
    }
  }

  // If no date column was mapped, try to find one by scanning data
  if (colIndex['date'] === undefined) {
    for (let i = 0; i < headers.length; i++) {
      if (Object.values(colIndex).includes(i)) continue;
      const sampleVals = rows.slice(0, 5).map(r => r[i]);
      const dateCount = sampleVals.filter(v => parseDate(v) !== null).length;
      if (dateCount >= 3) {
        colIndex['date'] = i;
        break;
      }
    }
  }

  const mapped: MappedExpense[] = [];
  let unmapped = 0;
  const today = new Date().toISOString().split('T')[0];

  for (const row of rows) {
    if (!Array.isArray(row)) { unmapped++; continue; }

    // Skip empty rows
    const nonEmpty = row.filter(c => String(c).trim()).length;
    if (nonEmpty === 0) continue;

    const amount = parseAmount(row[colIndex['amount']]);
    if (amount == null) { unmapped++; continue; }

    // Date is optional — use today if not available
    const date = colIndex['date'] !== undefined ? parseDate(row[colIndex['date']]) : null;

    const categoryVal = colIndex['category'] !== undefined ? row[colIndex['category']]?.trim() : '';
    const category = categoryVal || inferCategory(row);

    mapped.push({
      category,
      amount,
      date: date ?? today,
      note: colIndex['note'] !== undefined ? row[colIndex['note']]?.trim() || null : null,
      tournament_name: colIndex['tournament'] !== undefined ? row[colIndex['tournament']]?.trim() || null : null,
    });
  }

  return { mapped, unmapped, columns: headers };
}

export async function insertExpenses(
  expenses: MappedExpense[],
  tournamentMap: Record<string, string>,
): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const rows = expenses.map(e => ({
    user_id: user.id,
    category: e.category,
    amount: e.amount,
    date: e.date,
    note: e.note,
    tournament_id: e.tournament_name ? tournamentMap[e.tournament_name.toLowerCase()] ?? null : null,
  }));

  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('expenses').insert(batch);
    if (error) throw error;
    inserted += batch.length;
  }

  return inserted;
}
