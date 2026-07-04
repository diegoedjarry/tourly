import * as Sharing from 'expo-sharing';
import { writeAsStringAsync, cacheDirectory } from 'expo-file-system/legacy';

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
}

export function buildWeekSummaryText(tournaments: any[], expenses: any[]): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dayOfWeek = (now.getDay() + 6) % 7;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const activeTournaments = tournaments.filter(t => {
    const start = parseLocalDate(t.startDate);
    const end = t.endDate ? parseLocalDate(t.endDate) : new Date(start.getTime() + 6 * 86400000);
    return start <= weekEnd && end >= weekStart;
  });

  const weekExpenses = expenses.filter(e => {
    if (!e.date) return false;
    const d = parseLocalDate(e.date);
    return d >= weekStart && d <= weekEnd;
  });

  const totalSpent = weekExpenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const byCategory = new Map<string, number>();
  weekExpenses.forEach(e => {
    const cat = e.category ?? 'Other';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + (e.amount ?? 0));
  });

  const totalPrize = activeTournaments.reduce((sum, t) => {
    const prize = (t.singlesPrizeMoney ?? 0) + (t.doublesPrizeMoney ?? 0);
    return sum + (prize > 0 ? prize : (t.prizeMoney ?? 0));
  }, 0);

  const lines: string[] = [
    `🎾 TOURLY — Week Summary`,
    `${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`,
    '',
  ];

  if (activeTournaments.length > 0) {
    lines.push(`📍 Tournaments this week:`);
    activeTournaments.forEach(t => {
      const flag = t.country ?? '';
      lines.push(`   • ${t.name} (${flag}) — ${t.surface}`);
    });
    lines.push('');
  } else {
    lines.push(`📍 No tournaments this week`, '');
  }

  lines.push(`💰 Prize money: ${fmtMoney(totalPrize)}`);
  lines.push(`💸 Total spent: ${fmtMoney(totalSpent)}`);

  if (byCategory.size > 0) {
    lines.push(`   Breakdown:`);
    for (const [cat, amt] of Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`   • ${cat}: ${fmtMoney(amt)}`);
    }
  }

  const net = totalPrize - totalSpent;
  lines.push('');
  lines.push(`${net >= 0 ? '📈' : '📉'} Net: ${net >= 0 ? '+' : ''}${fmtMoney(net)}`);
  lines.push('');
  lines.push(`— Sent from Tourly`);

  return lines.join('\n');
}

export async function shareWeekSummary(tournaments: any[], expenses: any[]) {
  const text = buildWeekSummaryText(tournaments, expenses);
  const uri = `${cacheDirectory}tourly_week_summary.txt`;
  await writeAsStringAsync(uri, text);
  await Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: 'Share Week Summary' });
}

export function buildTournamentSummaryText(tournament: any, expenses: any[]): string {
  const tExpenses = expenses.filter(e => e.tournamentId === tournament.id);
  const totalSpent = tExpenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const prize = ((tournament.singlesPrizeMoney ?? 0) + (tournament.doublesPrizeMoney ?? 0)) || (tournament.prizeMoney ?? 0);
  const net = prize - totalSpent;

  const byCategory = new Map<string, number>();
  tExpenses.forEach(e => {
    const cat = e.category ?? 'Other';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + (e.amount ?? 0));
  });

  const lines = [
    `🎾 ${tournament.name}`,
    `📍 ${tournament.city}, ${tournament.country} — ${tournament.surface}`,
    `📅 ${tournament.startDate}${tournament.endDate ? ` to ${tournament.endDate}` : ''}`,
    '',
    `💰 Prize money: ${fmtMoney(prize)}`,
    `💸 Total expenses: ${fmtMoney(totalSpent)}`,
  ];

  if (byCategory.size > 0) {
    for (const [cat, amt] of Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])) {
      lines.push(`   • ${cat}: ${fmtMoney(amt)}`);
    }
  }

  lines.push('');
  lines.push(`${net >= 0 ? '📈' : '📉'} Net: ${net >= 0 ? '+' : ''}${fmtMoney(net)}`);
  lines.push('');
  lines.push(`— Sent from Tourly`);
  return lines.join('\n');
}

export async function shareTournamentSummary(tournament: any, expenses: any[]) {
  const text = buildTournamentSummaryText(tournament, expenses);
  const uri = `${cacheDirectory}tourly_tournament_summary.txt`;
  await writeAsStringAsync(uri, text);
  await Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: 'Share Tournament Summary' });
}
