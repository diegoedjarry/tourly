import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { totalPrizeMoney } from '@/utils/prize-money';

type Lang = 'en' | 'es';

// Brand colors — print media, light background, navy headings.
const NAVY = '#0A1128';
const EMERALD = '#00A86B';
const AMBER = '#D97706';
const OFFWHITE = '#F8F9FA';
const RED = '#E24B4A';

const DICT: Record<string, { en: string; es: string }> = {
  title: { en: 'Season Statement', es: 'Estado de Temporada' },
  taxReportTitle: { en: 'Tax Report', es: 'Informe Fiscal' },
  allAmountsUsd: { en: 'All amounts in USD', es: 'Todos los montos en USD' },
  expensesSection: { en: 'Expenses', es: 'Gastos' },
  incomeSection: { en: 'Income', es: 'Ingresos' },
  numExpenses: { en: '# Expenses', es: '# Gastos' },
  total: { en: 'Total', es: 'Total' },
  grandTotal: { en: 'Grand Total', es: 'Total General' },
  dates: { en: 'Dates', es: 'Fechas' },
  singles: { en: 'Singles', es: 'Singles' },
  doubles: { en: 'Doubles', es: 'Dobles' },
  noExpensesYear: { en: 'No deductible expenses recorded for this year.', es: 'Sin gastos deducibles registrados para este año.' },
  noIncomeYear: { en: 'No prize money recorded for this year.', es: 'Sin premios registrados para este año.' },
  taxDisclaimer: {
    en: 'This document is a summary of recorded data and does not constitute tax advice.',
    es: 'Este documento es un resumen de los datos registrados y no constituye asesoría tributaria.',
  },
  generated: { en: 'Generated', es: 'Generado' },
  totalSpend: { en: 'Total Spend', es: 'Gasto Total' },
  grossPrize: { en: 'Gross Prize Money', es: 'Premios Brutos' },
  netPrize: { en: 'Net Prize Money', es: 'Premios Netos' },
  netPosition: { en: 'Net Position', es: 'Posición Neta' },
  tournamentsPlayed: { en: 'Tournaments Played', es: 'Torneos Jugados' },
  date: { en: 'Date', es: 'Fecha' },
  tournament: { en: 'Tournament', es: 'Torneo' },
  country: { en: 'Country', es: 'País' },
  category: { en: 'Category', es: 'Categoría' },
  spend: { en: 'Spend', es: 'Gasto' },
  gross: { en: 'Gross', es: 'Bruto' },
  net: { en: 'Net', es: 'Neto' },
  netCol: { en: 'Net', es: 'Neto' },
  withdrawn: { en: 'Withdrawn', es: 'Retirado' },
  noTournaments: { en: 'No tournament activity this season.', es: 'Sin actividad de torneos esta temporada.' },
  expensesByCategory: { en: 'Expenses by Category', es: 'Gastos por Categoría' },
  noExpenses: { en: 'No expenses recorded this season.', es: 'Sin gastos registrados esta temporada.' },
  footer: {
    en: 'Indicative FX rates applied to non-USD expenses; original currencies preserved in the app.',
    es: 'Se aplicaron tipos de cambio indicativos a los gastos en moneda distinta de USD; las monedas originales se conservan en la app.',
  },
};

function tr(key: string, lang: Lang): string {
  return DICT[key]?.[lang] ?? key;
}

// USD with thousands separators; negatives rendered in red parentheses.
function fmtUSD(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (neg) {
    return `<span style="color:${RED}">($${formatted})</span>`;
  }
  return `$${formatted}`;
}

function fmtUSDPlain(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return neg ? `($${formatted})` : `$${formatted}`;
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Effective spend for an expense: (amountUsd ?? amount) * (sharePct/100),
// excluding reimbursed rows. Foreign-currency expenses with no USD conversion
// on record (FX rate was unavailable at entry time) also contribute 0 — never
// their raw foreign-currency amount (e.g. 5000 CLP must not report as $5,000).
// Mirrors the same guard in app/(tabs)/expenses.tsx and app/insights.tsx.
function effectiveSpend(e: any): number {
  if (e.isReimbursed) return 0;
  if (e.currency && e.currency !== 'USD' && e.amountUsd == null) return 0;
  const base = e.amountUsd ?? e.amount ?? 0;
  const share = (e.sharePct ?? 100) / 100;
  return base * share;
}

// Gross prize: singles + doubles, falling back to legacy prizeMoney (never additive with legacy).
function grossPrize(t: any): number {
  return totalPrizeMoney(t);
}

function netPrize(t: any): number {
  const gross = grossPrize(t);
  const pct = t.taxWithholdingPct;
  if (pct === null || pct === undefined) return gross;
  return gross * (1 - pct / 100);
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function fmtShortDate(dateStr: string, lang: Lang): string {
  if (!dateStr) return '';
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US', { month: 'short', day: 'numeric' });
}

export async function exportSeasonStatementPdf(
  year: number,
  tournaments: any[],
  expenses: any[],
  playerName: string | undefined,
  lang: Lang,
) {
  const yearExpenses = (expenses ?? []).filter(e => String(e.date ?? '').slice(0, 4) === String(year));
  const spendByTournament = new Map<string, number>();
  for (const e of yearExpenses) {
    const spend = effectiveSpend(e);
    if (e.tournamentId) {
      spendByTournament.set(e.tournamentId, (spendByTournament.get(e.tournamentId) ?? 0) + spend);
    }
  }

  const yearTournaments = (tournaments ?? []).filter(t => String(t.startDate ?? '').slice(0, 4) === String(year));

  const rows = yearTournaments
    .map(t => {
      const spend = spendByTournament.get(t.id) ?? 0;
      const gross = grossPrize(t);
      const net = netPrize(t);
      return { t, spend, gross, net };
    })
    .filter(r => r.spend > 0 || r.gross > 0)
    .sort((a, b) => String(a.t.startDate ?? '').localeCompare(String(b.t.startDate ?? '')));

  const totalSpend = rows.reduce((sum, r) => sum + r.spend, 0);
  const totalGross = rows.reduce((sum, r) => sum + r.gross, 0);
  const totalNet = rows.reduce((sum, r) => sum + r.net, 0);
  const netPosition = totalNet - totalSpend;
  const tournamentsPlayedCount = rows.length;

  const tournamentRowsHtml = rows.length
    ? rows
        .map(({ t, spend, gross, net }) => {
          const netVal = net - spend;
          return `
            <tr>
              <td>${escapeHtml(fmtShortDate(t.startDate, lang))}</td>
              <td>${escapeHtml(t.name ?? '')}${t.isWithdrawn ? ` <span class="badge">${tr('withdrawn', lang)}</span>` : ''}</td>
              <td>${escapeHtml(t.country ?? '')}</td>
              <td>${escapeHtml(t.category ?? '')}</td>
              <td class="num">${fmtUSD(-spend)}</td>
              <td class="num">${fmtUSD(gross)}</td>
              <td class="num">${fmtUSD(net)}</td>
              <td class="num">${fmtUSD(netVal)}</td>
            </tr>`;
        })
        .join('')
    : `<tr><td colspan="8" class="empty">${tr('noTournaments', lang)}</td></tr>`;

  // Expenses by category (effective spend, excluding reimbursed).
  const catTotals = new Map<string, number>();
  for (const e of yearExpenses) {
    const spend = effectiveSpend(e);
    if (spend <= 0 && e.isReimbursed) continue;
    const cat = e.category || (lang === 'es' ? 'Otro' : 'Other');
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + spend);
  }
  const catRows = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const catRowsHtml = catRows.length
    ? catRows.map(([cat, total]) => `
        <tr>
          <td>${escapeHtml(cat)}</td>
          <td class="num">${fmtUSD(-total)}</td>
        </tr>`).join('')
    : `<tr><td colspan="2" class="empty">${tr('noExpenses', lang)}</td></tr>`;

  const generatedDate = new Date().toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const netPositionColor = netPosition >= 0 ? EMERALD : RED;

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    background: ${OFFWHITE};
    color: ${NAVY};
    margin: 0;
    padding: 28px 32px;
    font-size: 11px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2px solid ${NAVY};
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .wordmark {
    font-size: 20px;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.5px;
  }
  .wordmark span { color: ${EMERALD}; }
  .subtitle {
    font-size: 15px;
    font-weight: 700;
    color: ${NAVY};
    margin-top: 2px;
  }
  .meta {
    text-align: right;
    font-size: 10px;
    color: #555;
  }
  .player {
    font-size: 12px;
    font-weight: 600;
    color: ${NAVY};
  }
  .summary {
    display: flex;
    gap: 10px;
    margin-bottom: 18px;
  }
  .stat {
    flex: 1;
    background: #fff;
    border: 1px solid #E3E5E8;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .stat-label {
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #6B7280;
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 15px;
    font-weight: 700;
    color: ${NAVY};
  }
  h2 {
    font-size: 12px;
    color: ${NAVY};
    border-bottom: 1px solid #D7DAE0;
    padding-bottom: 4px;
    margin: 18px 0 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6px;
  }
  th {
    text-align: left;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: #6B7280;
    padding: 6px 8px;
    border-bottom: 1px solid #D7DAE0;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid #EEF0F2;
    font-size: 10.5px;
  }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; color: #9CA3AF; padding: 14px; }
  .badge {
    display: inline-block;
    font-size: 8px;
    color: ${AMBER};
    border: 1px solid ${AMBER};
    border-radius: 4px;
    padding: 1px 4px;
    margin-left: 4px;
  }
  .cat-table { width: 60%; }
  .footer {
    margin-top: 22px;
    padding-top: 8px;
    border-top: 1px solid #D7DAE0;
    font-size: 8.5px;
    color: #6B7280;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="wordmark">Tour<span>ly</span></div>
      <div class="subtitle">${tr('title', lang)} ${year}</div>
    </div>
    <div class="meta">
      ${playerName ? `<div class="player">${escapeHtml(playerName)}</div>` : ''}
      <div>${tr('generated', lang)}: ${generatedDate}</div>
    </div>
  </div>

  <div class="summary">
    <div class="stat">
      <div class="stat-label">${tr('totalSpend', lang)}</div>
      <div class="stat-value">${fmtUSDPlain(totalSpend)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('grossPrize', lang)}</div>
      <div class="stat-value">${fmtUSDPlain(totalGross)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('netPrize', lang)}</div>
      <div class="stat-value">${fmtUSDPlain(totalNet)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('netPosition', lang)}</div>
      <div class="stat-value" style="color:${netPositionColor}">${fmtUSDPlain(netPosition)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('tournamentsPlayed', lang)}</div>
      <div class="stat-value">${tournamentsPlayedCount}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>${tr('date', lang)}</th>
        <th>${tr('tournament', lang)}</th>
        <th>${tr('country', lang)}</th>
        <th>${tr('category', lang)}</th>
        <th class="num">${tr('spend', lang)}</th>
        <th class="num">${tr('gross', lang)}</th>
        <th class="num">${tr('net', lang)}</th>
        <th class="num">${tr('netCol', lang)}</th>
      </tr>
    </thead>
    <tbody>
      ${tournamentRowsHtml}
    </tbody>
  </table>

  <h2>${tr('expensesByCategory', lang)}</h2>
  <table class="cat-table">
    <tbody>
      ${catRowsHtml}
    </tbody>
  </table>

  <div class="footer">${tr('footer', lang)}</div>
</body>
</html>`;

  const { uri } = await Print.printToFileAsync({ html, base64: false });

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `${tr('title', lang)} ${year}`,
    UTI: 'com.adobe.pdf',
  });
}

export async function exportTaxReportPdf(
  year: number,
  tournaments: any[],
  expenses: any[],
  playerName: string | undefined,
  lang: Lang,
) {
  // Expense rules: skip reimbursed rows; effective = (amountUsd ?? amount) * (sharePct/100); only this calendar year.
  const yearExpenses = (expenses ?? []).filter(e => String(e.date ?? '').slice(0, 4) === String(year) && !e.isReimbursed);

  const catTotals = new Map<string, { count: number; total: number }>();
  for (const e of yearExpenses) {
    const amount = effectiveSpend(e);
    const cat = e.category || (lang === 'es' ? 'Otro' : 'Other');
    const entry = catTotals.get(cat) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += amount;
    catTotals.set(cat, entry);
  }
  const catRows = [...catTotals.entries()].sort((a, b) => b[1].total - a[1].total);
  const totalExpenses = catRows.reduce((sum, [, v]) => sum + v.total, 0);

  const expenseRowsHtml = catRows.length
    ? catRows.map(([cat, v]) => `
        <tr>
          <td>${escapeHtml(cat)}</td>
          <td class="num">${v.count}</td>
          <td class="num">${fmtUSD(-v.total)}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" class="empty">${tr('noExpensesYear', lang)}</td></tr>`;

  // Income: prize money per tournament this year, only registered & not withdrawn.
  const yearTournaments = (tournaments ?? []).filter(
    t => String(t.startDate ?? '').slice(0, 4) === String(year) && t.isRegistered && !t.isWithdrawn,
  );
  const incomeRows = yearTournaments
    .map(t => {
      const gross = totalPrizeMoney(t);
      return { t, gross };
    })
    .filter(r => r.gross > 0)
    .sort((a, b) => String(a.t.startDate ?? '').localeCompare(String(b.t.startDate ?? '')));
  const totalIncome = incomeRows.reduce((sum, r) => sum + r.gross, 0);

  const incomeRowsHtml = incomeRows.length
    ? incomeRows.map(({ t, gross }) => `
        <tr>
          <td>${escapeHtml(t.name ?? '')}</td>
          <td>${escapeHtml(fmtShortDate(t.startDate, lang))}${t.endDate ? ` – ${escapeHtml(fmtShortDate(t.endDate, lang))}` : ''}</td>
          <td class="num">${fmtUSD(gross)}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" class="empty">${tr('noIncomeYear', lang)}</td></tr>`;

  const generatedDate = new Date().toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    background: ${OFFWHITE};
    color: ${NAVY};
    margin: 0;
    padding: 28px 32px;
    font-size: 11px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2px solid ${NAVY};
    padding-bottom: 10px;
    margin-bottom: 16px;
  }
  .wordmark {
    font-size: 20px;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.5px;
  }
  .wordmark span { color: ${EMERALD}; }
  .subtitle {
    font-size: 15px;
    font-weight: 700;
    color: ${NAVY};
    margin-top: 2px;
  }
  .meta {
    text-align: right;
    font-size: 10px;
    color: #555;
  }
  .player {
    font-size: 12px;
    font-weight: 600;
    color: ${NAVY};
  }
  .usdNote {
    font-size: 9.5px;
    color: #6B7280;
    margin-top: 1px;
  }
  .summary {
    display: flex;
    gap: 10px;
    margin-bottom: 18px;
  }
  .stat {
    flex: 1;
    background: #fff;
    border: 1px solid #E3E5E8;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .stat-label {
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #6B7280;
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 15px;
    font-weight: 700;
    color: ${NAVY};
  }
  h2 {
    font-size: 12px;
    color: ${NAVY};
    border-bottom: 1px solid #D7DAE0;
    padding-bottom: 4px;
    margin: 18px 0 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6px;
  }
  th {
    text-align: left;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: #6B7280;
    padding: 6px 8px;
    border-bottom: 1px solid #D7DAE0;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid #EEF0F2;
    font-size: 10.5px;
  }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; color: #9CA3AF; padding: 14px; }
  tr.grand td {
    font-weight: 700;
    border-top: 1.5px solid ${NAVY};
    border-bottom: none;
  }
  .footer {
    margin-top: 22px;
    padding-top: 8px;
    border-top: 1px solid #D7DAE0;
    font-size: 8.5px;
    color: #6B7280;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="wordmark">Tour<span>ly</span></div>
      <div class="subtitle">${tr('taxReportTitle', lang)} — ${year}</div>
    </div>
    <div class="meta">
      ${playerName ? `<div class="player">${escapeHtml(playerName)}</div>` : ''}
      <div>${tr('generated', lang)}: ${generatedDate}</div>
      <div class="usdNote">${tr('allAmountsUsd', lang)}</div>
    </div>
  </div>

  <div class="summary">
    <div class="stat">
      <div class="stat-label">${tr('expensesSection', lang)}</div>
      <div class="stat-value">${fmtUSDPlain(-totalExpenses)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('incomeSection', lang)}</div>
      <div class="stat-value">${fmtUSDPlain(totalIncome)}</div>
    </div>
  </div>

  <h2>${tr('expensesSection', lang)}</h2>
  <table>
    <thead>
      <tr>
        <th>${tr('category', lang)}</th>
        <th class="num">${tr('numExpenses', lang)}</th>
        <th class="num">${tr('total', lang)}</th>
      </tr>
    </thead>
    <tbody>
      ${expenseRowsHtml}
      ${catRows.length ? `<tr class="grand"><td>${tr('grandTotal', lang)}</td><td class="num"></td><td class="num">${fmtUSD(-totalExpenses)}</td></tr>` : ''}
    </tbody>
  </table>

  <h2>${tr('incomeSection', lang)}</h2>
  <table>
    <thead>
      <tr>
        <th>${tr('tournament', lang)}</th>
        <th>${tr('dates', lang)}</th>
        <th class="num">${tr('total', lang)}</th>
      </tr>
    </thead>
    <tbody>
      ${incomeRowsHtml}
      ${incomeRows.length ? `<tr class="grand"><td>${tr('grandTotal', lang)}</td><td></td><td class="num">${fmtUSD(totalIncome)}</td></tr>` : ''}
    </tbody>
  </table>

  <div class="footer">${tr('taxDisclaimer', lang)}</div>
</body>
</html>`;

  const { uri } = await Print.printToFileAsync({ html, base64: false });

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `${tr('taxReportTitle', lang)} ${year}`,
    UTI: 'com.adobe.pdf',
  });

  return { expenseCount: yearExpenses.length, incomeCount: incomeRows.length };
}
