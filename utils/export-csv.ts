import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { EXPORT_CATEGORIES as CATEGORIES, normalizeCategory } from '@/utils/categories';
import { totalPrizeMoney } from '@/utils/prize-money';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Numeric cells (rounded to cents) so exported amounts are summable in Excel
// and re-import cleanly. Column headers carry the USD label.
function fmt(n: number): number {
  return Math.round(n * 100) / 100;
}

// Effective USD spend for an expense — mirrors utils/export-pdf.ts's
// effectiveSpend(): reimbursed rows are 0 (never counted as real spend),
// otherwise (amountUsd ?? amount) scaled by the user's ownership share.
// Foreign-currency expenses with no USD conversion on record (FX rate was
// unavailable at entry time) also contribute 0 — never their raw
// foreign-currency amount (e.g. 5000 CLP must not export as $5,000). Mirrors
// the same guard in app/(tabs)/expenses.tsx and app/insights.tsx. Keeping
// this identical to the PDF's rule means the CSV/XLSX export, the season
// statement PDF, and the in-app totals never disagree with each other.
function effectiveSpend(e: any): number {
  if (e.isReimbursed) return 0;
  if (e.currency && e.currency !== 'USD' && e.amountUsd == null) return 0;
  const base = e.amountUsd ?? e.amount ?? 0;
  const share = (e.sharePct ?? 100) / 100;
  return base * share;
}

function buildMonthlySummarySheet(expenses: any[], year: number): XLSX.WorkSheet {
  const grid: Record<string, number[]> = {};
  for (const cat of CATEGORIES) {
    grid[cat] = new Array(12).fill(0);
  }

  for (const e of expenses) {
    const d = e.date ?? '';
    const eYear = parseInt(d.slice(0, 4), 10);
    if (eYear !== year) continue;
    const monthIdx = parseInt(d.slice(5, 7), 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) continue;
    const cat = normalizeCategory(e.category);
    grid[cat][monthIdx] += effectiveSpend(e);
  }

  const rows: any[][] = [];
  rows.push([`MONTHLY EXPENSE SUMMARY — ${year}`]);
  rows.push(['Category', ...MONTHS, 'TOTAL']);

  for (const cat of CATEGORIES) {
    const monthVals = grid[cat];
    const total = monthVals.reduce((a, b) => a + b, 0);
    rows.push([cat, ...monthVals.map(fmt), fmt(total)]);
  }

  const grandTotals = new Array(12).fill(0);
  for (const cat of CATEGORIES) {
    for (let m = 0; m < 12; m++) grandTotals[m] += grid[cat][m];
  }
  const grandTotal = grandTotals.reduce((a, b) => a + b, 0);
  rows.push(['GRAND TOTAL', ...grandTotals.map(fmt), fmt(grandTotal)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [{ wch: 18 }, ...new Array(13).fill({ wch: 12 })];

  return ws;
}

function buildIndividualExpensesSheet(expenses: any[], tournaments: any[]): XLSX.WorkSheet {
  const tMap = new Map(tournaments.map((t: any) => [t.id, t]));

  const sorted = [...expenses].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  const rows: any[][] = [];
  // Amount is the original transaction amount in its original Currency —
  // never converted. Amount (USD) is the effective value actually counted
  // toward totals (0 when Reimbursed, scaled by Share % otherwise) so it
  // always matches the season statement PDF and the in-app totals. Reimbursed
  // and Share % are called out explicitly rather than silently zeroing or
  // scaling the USD column, so a reader isn't left guessing why it differs
  // from Amount.
  rows.push(['Date', 'Category', 'Sub-Category', 'Description', 'Payment Method', 'Amount', 'Currency', 'Amount (USD)', 'Reimbursed', 'Share %', 'Notes']);

  for (const e of sorted) {
    const t = tMap.get(e.tournamentId);
    const cat = normalizeCategory(e.category);
    rows.push([
      e.date ?? '',
      cat,
      e.isCoachExpense ? 'Coach' : '',
      t?.name ?? '',
      '',
      fmt(e.amount ?? 0),
      e.currency ?? 'USD',
      fmt(effectiveSpend(e)),
      e.isReimbursed ? 'Yes' : 'No',
      e.sharePct ?? 100,
      e.note ?? '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 14 },
    { wch: 28 },
    { wch: 16 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 12 },
    { wch: 10 },
    { wch: 30 },
  ];
  return ws;
}

// Distinct years present in the expense data (fallback: current year).
function expenseYears(expenses: any[]): number[] {
  const years = new Set<number>();
  for (const e of expenses) {
    const y = parseInt(String(e.date ?? '').slice(0, 4), 10);
    if (y >= 2000 && y <= 2100) years.add(y);
  }
  if (years.size === 0) years.add(new Date().getFullYear());
  return [...years].sort();
}

function buildTournamentsSheet(tournaments: any[]): XLSX.WorkSheet {
  const rows: any[][] = [
    ['Name', 'Country', 'City', 'Surface', 'Category', 'Start Date', 'End Date', 'Singles Prize', 'Doubles Prize', 'Total Prize', 'Status', 'Registered', 'Withdrawn'],
  ];
  for (const t of tournaments) {
    rows.push([
      t.name, t.country, t.city, t.surface, t.category,
      t.startDate, t.endDate,
      t.singlesPrizeMoney ?? 0,
      t.doublesPrizeMoney ?? 0,
      // Total column is the source of truth for prize money — falls back to
      // the legacy `prizeMoney` field when the singles/doubles split is empty,
      // so imported legacy rows don't silently report $0 (previously the
      // Singles column alone carried that fallback, which dropped doubles
      // whenever both split fields were explicitly 0 instead of null).
      totalPrizeMoney(t),
      t.status, t.isRegistered ? 'Yes' : 'No', t.isWithdrawn ? 'Yes' : 'No',
    ]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

export async function exportAllCsv(tournaments: any[], expenses: any[]) {
  const year = new Date().getFullYear();
  const wb = XLSX.utils.book_new();

  // Detail sheet first — the importer reads it back row-per-expense, so
  // export → re-import round-trips without creating aggregate duplicates.
  const detailSheet = buildIndividualExpensesSheet(expenses, tournaments);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Expenses');

  for (const y of expenseYears(expenses)) {
    XLSX.utils.book_append_sheet(wb, buildMonthlySummarySheet(expenses, y), `Summary ${y}`);
  }

  XLSX.utils.book_append_sheet(wb, buildTournamentsSheet(tournaments), 'Tournaments');

  const wbOut = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const fileName = `Tourly_Expenses_${year}.xlsx`;
  const filePath = `${cacheDirectory}${fileName}`;
  await writeAsStringAsync(filePath, wbOut, { encoding: EncodingType.Base64 });

  await Sharing.shareAsync(filePath, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: 'Export Expenses',
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
  });
}

export async function exportTournamentsCsv(tournaments: any[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildTournamentsSheet(tournaments), 'Tournaments');

  const wbOut = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const filePath = `${cacheDirectory}Tourly_Tournaments.xlsx`;
  await writeAsStringAsync(filePath, wbOut, { encoding: EncodingType.Base64 });

  await Sharing.shareAsync(filePath, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: 'Export Tournaments',
  });
}

export async function exportExpensesCsv(expenses: any[], tournaments: any[]) {
  const year = new Date().getFullYear();
  const wb = XLSX.utils.book_new();

  // Detail sheet first / named "Expenses" — see exportAllCsv.
  const detailSheet = buildIndividualExpensesSheet(expenses, tournaments);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Expenses');

  for (const y of expenseYears(expenses)) {
    XLSX.utils.book_append_sheet(wb, buildMonthlySummarySheet(expenses, y), `Summary ${y}`);
  }

  const wbOut = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const fileName = `Tourly_Expenses_${year}.xlsx`;
  const filePath = `${cacheDirectory}${fileName}`;
  await writeAsStringAsync(filePath, wbOut, { encoding: EncodingType.Base64 });

  await Sharing.shareAsync(filePath, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: 'Export Expenses',
  });
}
