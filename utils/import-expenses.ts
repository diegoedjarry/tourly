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

// ─── Month helpers ────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan:1, january:1, ene:1, enero:1,
  feb:2, february:2, febrero:2,
  mar:3, march:3, marzo:3,
  apr:4, april:4, abr:4, abril:4,
  may:5, mayo:5,
  jun:6, june:6, junio:6,
  jul:7, july:7, julio:7,
  aug:8, august:8, ago:8, agosto:8,
  sep:9, september:9, septiembre:9, sept:9,
  oct:10, october:10, octubre:10,
  nov:11, november:11, noviembre:11,
  dec:12, december:12, dic:12, diciembre:12,
};

function monthIndex(h: string): number | null {
  const key = h.toLowerCase().trim().replace(/[^a-záéíóúñ]/g, '');
  return MONTH_NAMES[key] ?? null;
}

const QUARTER_MAP: Record<string, number[]> = {
  q1: [1,2,3], q2: [4,5,6], q3: [7,8,9], q4: [10,11,12],
  t1: [1,2,3], t2: [4,5,6], t3: [7,8,9], t4: [10,11,12],
};

function guessYearFromRows(rows: string[][]): number {
  const cur = new Date().getFullYear();
  for (const row of rows.slice(0, 5)) {
    for (const cell of row) {
      const m = String(cell).match(/\b(20\d{2})\b/);
      if (m) return parseInt(m[1]);
    }
  }
  return cur;
}

// ─── Format detection ─────────────────────────────────────────────────────────

type FileFormat =
  | 'row-per-expense'     // standard: date, amount, category per row
  | 'monthly-pivot'       // category rows × month columns
  | 'quarterly-pivot'     // category rows × Q1-Q4 columns
  | 'bank-statement'      // date, description, debit, credit
  | 'simple-list';        // amount + description only

function detectFormat(headers: string[]): FileFormat {
  const lower = headers.map(h => h.toLowerCase().trim());

  // Monthly pivot: 3+ columns are month names
  const monthCols = lower.filter(h => monthIndex(h) !== null).length;
  if (monthCols >= 3) return 'monthly-pivot';

  // Quarterly pivot: at least 2 quarter columns
  const qCols = lower.filter(h => QUARTER_MAP[h.replace(/[^a-z0-9]/g, '')] !== undefined).length;
  if (qCols >= 2) return 'quarterly-pivot';

  // Bank statement: has debit or credit column
  if (lower.some(h => h.includes('debit') || h.includes('credit') || h.includes('cargo') || h.includes('abono'))) {
    return 'bank-statement';
  }

  // Row-per-expense: has a recognisable date or amount column
  const hasDate = lower.some(h => h.includes('date') || h.includes('fecha'));
  const hasAmount = lower.some(h => h.includes('amount') || h.includes('monto') || h.includes('total') || h.includes('cost'));
  if (hasDate || hasAmount) return 'row-per-expense';

  return 'simple-list';
}

// ─── Per-format parsers ───────────────────────────────────────────────────────

function parseMonthlyPivot(headers: string[], rows: string[][], year: number): ImportResult {
  const mapped: MappedExpense[] = [];
  let unmapped = 0;

  // Find the category column (first non-month, non-total column)
  const catColIdx = headers.findIndex(h => {
    const l = h.toLowerCase().trim();
    return monthIndex(l) === null && !l.includes('total') && !l.includes('anual') && l.length > 0;
  });

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const nonEmpty = row.filter(c => String(c).trim()).length;
    if (nonEmpty === 0) continue;

    const category = catColIdx >= 0 ? String(row[catColIdx] ?? '').trim() : 'Other';
    if (!category) { unmapped++; continue; }

    let rowHadAny = false;
    for (let i = 0; i < headers.length; i++) {
      const mIdx = monthIndex(headers[i]);
      if (mIdx === null) continue;

      const amount = parseAmount(row[i]);
      if (amount == null || amount === 0) continue;

      const mm = String(mIdx).padStart(2, '0');
      mapped.push({
        category,
        amount,
        date: `${year}-${mm}-01`,
        note: null,
        tournament_name: null,
      });
      rowHadAny = true;
    }
    if (!rowHadAny) unmapped++;
  }

  return { mapped, unmapped, columns: headers };
}

function parseQuarterlyPivot(headers: string[], rows: string[][], year: number): ImportResult {
  const mapped: MappedExpense[] = [];
  let unmapped = 0;

  const catColIdx = headers.findIndex(h => {
    const l = h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    return QUARTER_MAP[l] === undefined && !l.includes('total') && l.length > 0;
  });

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const nonEmpty = row.filter(c => String(c).trim()).length;
    if (nonEmpty === 0) continue;

    const category = catColIdx >= 0 ? String(row[catColIdx] ?? '').trim() : 'Other';
    if (!category) { unmapped++; continue; }

    let rowHadAny = false;
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i].toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      const months = QUARTER_MAP[key];
      if (!months) continue;

      const amount = parseAmount(row[i]);
      if (amount == null || amount === 0) continue;

      // Spread quarter amount evenly across its first month
      const mm = String(months[0]).padStart(2, '0');
      mapped.push({
        category,
        amount,
        date: `${year}-${mm}-01`,
        note: `${headers[i].toUpperCase()} total`,
        tournament_name: null,
      });
      rowHadAny = true;
    }
    if (!rowHadAny) unmapped++;
  }

  return { mapped, unmapped, columns: headers };
}

function parseBankStatement(headers: string[], rows: string[][]): ImportResult {
  const lower = headers.map(h => h.toLowerCase().trim());
  const dateIdx = lower.findIndex(h => h.includes('date') || h.includes('fecha'));
  const descIdx = lower.findIndex(h => h.includes('desc') || h.includes('memo') || h.includes('concept') || h.includes('merchant') || h.includes('payee'));
  const debitIdx = lower.findIndex(h => h.includes('debit') || h.includes('cargo') || h.includes('withdrawal') || h.includes('out'));
  const creditIdx = lower.findIndex(h => h.includes('credit') || h.includes('abono') || h.includes('deposit') || h.includes('in'));
  // If no explicit debit/credit, fall back to a generic amount column
  const amtIdx = lower.findIndex(h => h.includes('amount') || h.includes('monto') || h.includes('total'));

  const mapped: MappedExpense[] = [];
  let unmapped = 0;
  const today = new Date().toISOString().split('T')[0];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const nonEmpty = row.filter(c => String(c).trim()).length;
    if (nonEmpty === 0) continue;

    let amount: number | null = null;
    if (debitIdx >= 0) amount = parseAmount(row[debitIdx]);
    if (amount == null && amtIdx >= 0) amount = parseAmount(row[amtIdx]);
    // Skip credits (deposits/income) — only import debits/expenses
    if (amount == null) { unmapped++; continue; }

    const desc = descIdx >= 0 ? String(row[descIdx] ?? '').trim() : '';
    const date = dateIdx >= 0 ? parseDate(row[dateIdx]) : null;

    mapped.push({
      category: inferCategoryFromText(desc),
      amount,
      date: date ?? today,
      note: desc || null,
      tournament_name: null,
    });
  }

  return { mapped, unmapped, columns: headers };
}

function parseSimpleList(headers: string[], rows: string[][]): ImportResult {
  // Best-effort: find any numeric column as amount, rest as description
  const mapped: MappedExpense[] = [];
  let unmapped = 0;
  const today = new Date().toISOString().split('T')[0];

  // Find the column with the most numeric values
  let amtColIdx = -1;
  let maxNumeric = 0;
  for (let i = 0; i < headers.length; i++) {
    const count = rows.filter(r => parseAmount(r[i]) !== null).length;
    if (count > maxNumeric) { maxNumeric = count; amtColIdx = i; }
  }
  if (amtColIdx < 0) return { mapped: [], unmapped: rows.length, columns: headers };

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const nonEmpty = row.filter(c => String(c).trim()).length;
    if (nonEmpty === 0) continue;

    const amount = parseAmount(row[amtColIdx]);
    if (amount == null) { unmapped++; continue; }

    const desc = row.filter((_, i) => i !== amtColIdx).map(c => String(c).trim()).filter(Boolean).join(' — ');
    const date = row.map(c => parseDate(c)).find(d => d !== null) ?? today;

    mapped.push({
      category: inferCategoryFromText(desc),
      amount,
      date,
      note: desc || null,
      tournament_name: null,
    });
  }

  return { mapped, unmapped, columns: headers };
}

function inferCategoryFromText(text: string): string {
  return inferCategory([text]);
}

// ─── Main smart parser — replaces applyMapping for new callers ────────────────

export function smartParse(headers: string[], rows: string[][]): ImportResult {
  const format = detectFormat(headers);
  const year = guessYearFromRows([headers, ...rows.slice(0, 3)]);

  switch (format) {
    case 'monthly-pivot':   return parseMonthlyPivot(headers, rows, year);
    case 'quarterly-pivot': return parseQuarterlyPivot(headers, rows, year);
    case 'bank-statement':  return parseBankStatement(headers, rows);
    case 'simple-list':     return parseSimpleList(headers, rows);
    default:                break; // fall through to row-per-expense below
  }

  // row-per-expense: use existing column-mapping logic
  const mapping = mapColumnsLocal(headers);
  return applyMapping(rows, headers, mapping);
}

// ─── Original keyword map (kept for row-per-expense path) ────────────────────

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
