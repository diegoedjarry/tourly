import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CATEGORIES = [
  'Equipment',
  'Travel Coach',
  'Academy',
  'Physiotherapy',
  'Flights',
  'Transportation',
  'Hotels',
  'Meals',
  'Physical Trainer',
  'Strings & Grip',
  'Stringing Fee',
  'Other',
];

function normalizeCategory(raw: string): string {
  const lower = (raw ?? '').toLowerCase().trim();
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase() === lower) return cat;
  }
  const map: Record<string, string> = {
    travel: 'Transportation',
    flight: 'Flights',
    hotel: 'Hotels',
    accommodation: 'Hotels',
    food: 'Meals',
    coaching: 'Academy',
    physio: 'Physiotherapy',
    'entry fee': 'Other',
    equipment: 'Equipment',
    strings: 'Strings & Grip',
    stringing: 'Stringing Fee',
  };
  return map[lower] ?? 'Other';
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
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
    grid[cat][monthIdx] += (e.amount ?? 0);
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
  rows.push(['Date', 'Category', 'Sub-Category', 'Description', 'Payment Method', 'Amount (USD)', 'Notes']);

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
    { wch: 14 },
    { wch: 30 },
  ];
  return ws;
}

export async function exportAllCsv(tournaments: any[], expenses: any[]) {
  const year = new Date().getFullYear();
  const wb = XLSX.utils.book_new();

  const summarySheet = buildMonthlySummarySheet(expenses, year);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Monthly Summary');

  const detailSheet = buildIndividualExpensesSheet(expenses, tournaments);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Individual Expenses');

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
  const rows: any[][] = [
    ['Name', 'Country', 'City', 'Surface', 'Category', 'Start Date', 'End Date', 'Singles Prize', 'Doubles Prize', 'Status', 'Registered', 'Withdrawn'],
  ];
  for (const t of tournaments) {
    rows.push([
      t.name, t.country, t.city, t.surface, t.category,
      t.startDate, t.endDate,
      t.singlesPrizeMoney ?? t.prizeMoney ?? 0,
      t.doublesPrizeMoney ?? 0,
      t.status, t.isRegistered ? 'Yes' : 'No', t.isWithdrawn ? 'Yes' : 'No',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Tournaments');

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

  const summarySheet = buildMonthlySummarySheet(expenses, year);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Monthly Summary');

  const detailSheet = buildIndividualExpensesSheet(expenses, tournaments);
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Individual Expenses');

  const wbOut = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const fileName = `Tourly_Expenses_${year}.xlsx`;
  const filePath = `${cacheDirectory}${fileName}`;
  await writeAsStringAsync(filePath, wbOut, { encoding: EncodingType.Base64 });

  await Sharing.shareAsync(filePath, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: 'Export Expenses',
  });
}
