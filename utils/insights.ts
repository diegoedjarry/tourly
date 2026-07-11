// Rule-based financial insight engine — no external API needed.
// All calculations run locally from the player's Supabase data.

export interface InsightResult {
  text: string;
  type: string;
  label: string;
}

function fmt(n: number): string {
  return '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}

function parseLocal(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getPrize(t: any): number {
  const s = t.singlesPrizeMoney ?? 0;
  const d = t.doublesPrizeMoney ?? 0;
  return s + d > 0 ? s + d : (t.prizeMoney ?? 0);
}

function tSpend(t: any, expenses: any[]): number {
  return expenses
    .filter((e: any) => e.tournamentId === t.id)
    .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ─── Individual generators ───────────────────────────────────────────────────
// Each returns null if there isn't enough data to produce a meaningful insight.

function weeklyRecap(tournaments: any[], expenses: any[]): InsightResult | null {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const lastMon = new Date(monday); lastMon.setDate(monday.getDate() - 7);
  const lastSun = new Date(monday); lastSun.setDate(monday.getDate() - 1);

  const lastWeekExp = expenses.filter((e: any) => {
    const d = parseLocal(e.date ?? '');
    return d && d >= lastMon && d <= lastSun;
  });
  if (lastWeekExp.length === 0) return null;

  const total = lastWeekExp.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const byCategory: Record<string, number> = {};
  for (const e of lastWeekExp) {
    const cat = e.category ?? 'Other';
    byCategory[cat] = (byCategory[cat] ?? 0) + (e.amount ?? 0);
  }
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  const lastWeekTournaments = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return d && d >= lastMon && d <= lastSun;
  });
  const location = lastWeekTournaments[0]?.city ?? lastWeekTournaments[0]?.country ?? 'last week';

  return {
    type: 'weekly_recap',
    label: 'WEEKLY RECAP',
    text: `Last week in ${location} you spent ${fmt(total)}. Your biggest cost was ${topCat[0]} at ${fmt(topCat[1])}.`,
  };
}

function tournamentROI(tournaments: any[], expenses: any[]): InsightResult | null {
  const now = new Date();
  const recent = tournaments.find((t: any) => {
    if (t.isWithdrawn || !t.endDate) return false;
    const end = parseLocal(t.endDate);
    if (!end) return false;
    const hrs = (now.getTime() - end.getTime()) / 3600000;
    return hrs >= 0 && hrs <= 72;
  });
  if (!recent) return null;

  const spent = tSpend(recent, expenses);
  if (spent === 0) return null;
  const prize = getPrize(recent);
  const net = prize - spent;

  return {
    type: 'tournament_roi',
    label: 'TOURNAMENT ROI',
    text: `${recent.name} cost you ${fmt(spent)}. You earned ${fmt(prize)} in prize money. Net result: ${net >= 0 ? '+' : '-'}${fmt(Math.abs(net))}.`,
  };
}

function seasonNetPosition(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const played = tournaments.filter((t: any) => {
    if (t.isWithdrawn) return false;
    const d = parseLocal(t.startDate ?? '');
    return d && d <= today && d.getFullYear() === year;
  });
  if (played.length < 2) return null;

  const totalSpent = played.reduce((s: number, t: any) => s + tSpend(t, expenses), 0);
  const totalPrize = played.reduce((s: number, t: any) => s + getPrize(t), 0);
  const net = totalPrize - totalSpent;
  const avgNet = net / played.length;

  return {
    type: 'season_net_position',
    label: 'SEASON NET',
    text: `You are ${fmt(Math.abs(net))} ${net >= 0 ? 'up' : 'down'} this season across ${played.length} tournaments. Average net per tournament: ${avgNet >= 0 ? '+' : '-'}${fmt(Math.abs(avgNet))}.`,
  };
}

function monthlyBurnRate(expenses: any[]): InsightResult | null {
  const today = new Date();
  const year = today.getFullYear();
  const byMonth: Record<number, number> = {};

  for (const e of expenses) {
    const d = parseLocal(e.date ?? '');
    if (!d || d.getFullYear() !== year) continue;
    const m = d.getMonth();
    byMonth[m] = (byMonth[m] ?? 0) + (e.amount ?? 0);
  }
  const months = Object.values(byMonth);
  if (months.length < 2) return null;

  const monthAvg = avg(months);
  const remaining = 11 - today.getMonth();
  const projection = months.reduce((a, b) => a + b, 0) + monthAvg * remaining;

  return {
    type: 'monthly_burn_rate',
    label: 'BURN RATE',
    text: `You are spending an average of ${fmt(monthAvg)} per month. At this rate you will spend around ${fmt(projection)} by December.`,
  };
}

function prizeCoveragePercent(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const played = tournaments.filter((t: any) => {
    if (t.isWithdrawn) return false;
    const d = parseLocal(t.startDate ?? '');
    return d && d <= today;
  });
  if (played.length < 2) return null;

  const totalSpent = played.reduce((s: number, t: any) => s + tSpend(t, expenses), 0);
  if (totalSpent === 0) return null;
  const totalPrize = played.reduce((s: number, t: any) => s + getPrize(t), 0);
  const pct = Math.round((totalPrize / totalSpent) * 100);

  return {
    type: 'prize_coverage',
    label: 'PRIZE COVERAGE',
    text: `Prize money covers ${pct}% of your total expenses this season. You have earned ${fmt(totalPrize)} against ${fmt(totalSpent)} in costs.`,
  };
}

function biggestCostCategory(expenses: any[]): InsightResult | null {
  if (expenses.length < 5) return null;
  const total = expenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  if (total === 0) return null;

  const byCategory: Record<string, number> = {};
  for (const e of expenses) {
    const cat = e.category ?? 'Other';
    byCategory[cat] = (byCategory[cat] ?? 0) + (e.amount ?? 0);
  }
  const [topCat, topAmt] = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  const pct = Math.round((topAmt / total) * 100);

  return {
    type: 'biggest_cost_category',
    label: 'SPENDING PATTERN',
    text: `${topCat} is your biggest expense at ${pct}% of total spending — ${fmt(topAmt)} this season.`,
  };
}

function coachTravelImpact(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const played = tournaments.filter((t: any) => {
    if (t.isWithdrawn) return false;
    const d = parseLocal(t.startDate ?? '');
    return d && d <= today;
  });

  const withCoach = played.filter((t: any) => {
    const tExp = expenses.filter((e: any) => e.tournamentId === t.id);
    return tExp.some((e: any) => e.isCoachExpense) || t.traveledWithCoach;
  });
  const solo = played.filter((t: any) => {
    const tExp = expenses.filter((e: any) => e.tournamentId === t.id);
    return !tExp.some((e: any) => e.isCoachExpense) && !t.traveledWithCoach;
  });

  if (withCoach.length === 0 || solo.length === 0) return null;

  const avgWith = avg(withCoach.map((t: any) => tSpend(t, expenses)));
  const avgSolo = avg(solo.map((t: any) => tSpend(t, expenses)));
  if (avgWith === 0 || avgSolo === 0) return null;
  const diff = avgWith - avgSolo;

  return {
    type: 'coach_travel_impact',
    label: 'COACH IMPACT',
    text: `Weeks with your coach cost an average of ${fmt(avgWith)} vs ${fmt(avgSolo)} solo. Coach travel adds ${fmt(Math.abs(diff))} per week.`,
  };
}

function spendingSpike(tournaments: any[], expenses: any[]): InsightResult | null {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);

  const thisWeekExp = expenses.filter((e: any) => {
    const d = parseLocal(e.date ?? '');
    return d && d >= weekAgo && d <= now;
  });
  if (thisWeekExp.length === 0) return null;

  const thisWeekTotal = thisWeekExp.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);

  // get previous 4 weeks average
  const weeklyTotals: number[] = [];
  for (let w = 1; w <= 4; w++) {
    const wStart = new Date(now); wStart.setDate(now.getDate() - (w + 1) * 7);
    const wEnd = new Date(now); wEnd.setDate(now.getDate() - w * 7);
    const wExp = expenses.filter((e: any) => {
      const d = parseLocal(e.date ?? '');
      return d && d >= wStart && d <= wEnd;
    });
    const wTotal = wExp.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    if (wTotal > 0) weeklyTotals.push(wTotal);
  }
  if (weeklyTotals.length < 2) return null;

  const weeklyAvg = avg(weeklyTotals);
  const pctAbove = Math.round(((thisWeekTotal - weeklyAvg) / weeklyAvg) * 100);
  if (pctAbove < 30) return null;

  const byCategory: Record<string, number> = {};
  for (const e of thisWeekExp) {
    const cat = e.category ?? 'Other';
    byCategory[cat] = (byCategory[cat] ?? 0) + (e.amount ?? 0);
  }
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0][0];

  return {
    type: 'spending_spike',
    label: 'SPENDING SPIKE',
    text: `This week you spent ${fmt(thisWeekTotal)} — ${pctAbove}% above your weekly average of ${fmt(weeklyAvg)}. ${topCat} was the main driver.`,
  };
}

function surfaceCostEfficiency(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const surfaces = ['clay', 'hard', 'grass'];
  const surfData = surfaces.map(s => {
    const ts = tournaments.filter((t: any) => t.surface === s && !t.isWithdrawn && parseLocal(t.startDate ?? '')! <= today);
    if (ts.length < 2) return null;
    const avgSpend = avg(ts.map((t: any) => tSpend(t, expenses)));
    return { surface: s, avgSpend, count: ts.length };
  }).filter(Boolean) as { surface: string; avgSpend: number; count: number }[];

  if (surfData.length < 2) return null;

  surfData.sort((a, b) => a.avgSpend - b.avgSpend);
  const cheapest = surfData[0];
  const priciest = surfData[surfData.length - 1];

  return {
    type: 'surface_cost_efficiency',
    label: 'SURFACE COST',
    text: `${cheapest.surface.charAt(0).toUpperCase() + cheapest.surface.slice(1)} is your most affordable surface at ${fmt(cheapest.avgSpend)} average vs ${fmt(priciest.avgSpend)} on ${priciest.surface}.`,
  };
}

function costPerPoint(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const played = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return d && d <= today && !t.isWithdrawn && (t.pointsEarned ?? 0) > 0;
  });
  if (played.length < 2) return null;

  const totalPoints = played.reduce((s: number, t: any) => s + (t.pointsEarned ?? 0), 0);
  const totalSpent = played.reduce((s: number, t: any) => s + tSpend(t, expenses), 0);
  if (totalSpent === 0) return null;

  const cpp = totalSpent / totalPoints;
  return {
    type: 'cost_per_point',
    label: 'COST PER POINT',
    text: `You are spending ${fmt(cpp)} per ranking point this season — ${fmt(totalSpent)} invested for ${totalPoints} points across ${played.length} tournaments.`,
  };
}

function pointsDefenseWarning(tournaments: any[]): InsightResult | null {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
  const lastYear = new Date(now); lastYear.setFullYear(now.getFullYear() - 1);
  const lastYearEnd = new Date(weekEnd); lastYearEnd.setFullYear(weekEnd.getFullYear() - 1);

  const expiring = tournaments.filter((t: any) => {
    if (!t.pointsEarned || t.pointsEarned === 0) return false;
    const d = parseLocal(t.startDate ?? '');
    return d && d >= lastYear && d <= lastYearEnd;
  });
  if (expiring.length === 0) return null;

  const totalExpiring = expiring.reduce((s: number, t: any) => s + (t.pointsEarned ?? 0), 0);
  const names = expiring.map((t: any) => t.name).join(', ');

  return {
    type: 'points_defense',
    label: 'POINTS EXPIRING',
    text: `You have ${totalExpiring} points expiring this week from ${names}. You need to match those results to maintain your ranking.`,
  };
}

function upcomingCostEstimate(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = tournaments
    .filter((t: any) => {
      const d = parseLocal(t.startDate ?? '');
      return d && d > today && !t.isWithdrawn;
    })
    .sort((a: any, b: any) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0];

  if (!upcoming) return null;

  const sameCountry = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return t.country === upcoming.country && d && d <= today && !t.isWithdrawn && tSpend(t, expenses) > 0;
  });
  if (sameCountry.length === 0) return null;

  const estimate = avg(sameCountry.map((t: any) => tSpend(t, expenses)));

  return {
    type: 'upcoming_cost_estimate',
    label: 'UPCOMING TRIP',
    text: `Based on your history in ${upcoming.country}, ${upcoming.name} will likely cost around ${fmt(estimate)}. Your ${upcoming.country} average is ${fmt(estimate)}.`,
  };
}

function seasonEndProjection(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const played = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return d && d <= today && d.getFullYear() === year && !t.isWithdrawn;
  });
  if (played.length < 3) return null;

  const totalSpent = played.reduce((s: number, t: any) => s + tSpend(t, expenses), 0);
  const avgPerTournament = totalSpent / played.length;

  const remaining = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return d && d > today && d.getFullYear() === year && !t.isWithdrawn;
  }).length;

  const projection = totalSpent + avgPerTournament * remaining;

  return {
    type: 'season_end_projection',
    label: 'SEASON PROJECTION',
    text: `At your current pace you will spend around ${fmt(projection)} this season. You have ${remaining} more tournaments scheduled at ${fmt(avgPerTournament)} average each.`,
  };
}

function geographicEfficiency(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const played = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return d && d <= today && !t.isWithdrawn && tSpend(t, expenses) > 0;
  });

  const byCountry: Record<string, { spent: number[]; prize: number[] }> = {};
  for (const t of played) {
    const country = t.country ?? 'Unknown';
    if (!byCountry[country]) byCountry[country] = { spent: [], prize: [] };
    byCountry[country].spent.push(tSpend(t, expenses));
    byCountry[country].prize.push(getPrize(t));
  }

  const countries = Object.entries(byCountry)
    .filter(([, v]) => v.spent.length >= 2)
    .map(([country, v]) => ({
      country,
      avgSpent: avg(v.spent),
      avgPrize: avg(v.prize),
    }));

  if (countries.length < 2) return null;

  countries.sort((a, b) => a.avgSpent - b.avgSpent);
  const cheapest = countries[0];
  const priciest = countries[countries.length - 1];

  return {
    type: 'geographic_efficiency',
    label: 'GEOGRAPHIC ROI',
    text: `${cheapest.country} is your most affordable destination averaging ${fmt(cheapest.avgSpent)} per trip vs ${fmt(priciest.avgSpent)} in ${priciest.country}.`,
  };
}

function trackingStreak(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past = tournaments
    .filter((t: any) => {
      if (t.isWithdrawn) return false;
      const d = parseLocal(t.startDate ?? '');
      return d && d <= today;
    })
    .sort((a: any, b: any) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));

  let streak = 0;
  for (const t of past) {
    if (expenses.some((e: any) => e.tournamentId === t.id)) streak++;
    else break;
  }
  if (streak < 3) return null;

  return {
    type: 'tracking_streak',
    label: 'TRACKING STREAK',
    text: `You have logged expenses for ${streak} consecutive tournaments. Complete data makes your financial insights more accurate.`,
  };
}

function budgetRunway(tournaments: any[], expenses: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();

  const yearExpenses = expenses.filter((e: any) => {
    const d = parseLocal(e.date ?? '');
    return d && d.getFullYear() === year;
  });
  if (yearExpenses.length < 5) return null;

  const yearTotal = yearExpenses.reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  const played = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return d && d <= today && d.getFullYear() === year && !t.isWithdrawn;
  }).length;
  if (played === 0) return null;

  const avgPerTournament = yearTotal / played;
  const remaining = tournaments.filter((t: any) => {
    const d = parseLocal(t.startDate ?? '');
    return d && d > today && d.getFullYear() === year && !t.isWithdrawn;
  }).length;

  if (remaining === 0) return null;

  return {
    type: 'budget_runway',
    label: 'BUDGET RUNWAY',
    text: `At ${fmt(avgPerTournament)} average per tournament, you have ${remaining} more tournaments scheduled this season. Estimated remaining spend: ${fmt(avgPerTournament * remaining)}.`,
  };
}

function fixedVsVariable(expenses: any[]): InsightResult | null {
  const fixed = expenses.filter((e: any) => e.isMonthlyFixed);
  const variable = expenses.filter((e: any) => !e.isMonthlyFixed);
  if (fixed.length === 0 || variable.length === 0) return null;

  const today = new Date();
  const year = today.getFullYear();
  const monthsElapsed = today.getMonth() + 1;

  const fixedTotal = fixed
    .filter((e: any) => {
      const d = parseLocal(e.date ?? '');
      return d && d.getFullYear() === year;
    })
    .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);

  const variableTotal = variable
    .filter((e: any) => {
      const d = parseLocal(e.date ?? '');
      return d && d.getFullYear() === year;
    })
    .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);

  if (fixedTotal === 0 || variableTotal === 0) return null;
  const fixedMonthly = fixedTotal / monthsElapsed;

  return {
    type: 'fixed_vs_variable',
    label: 'FIXED VS VARIABLE',
    text: `Your fixed monthly costs average ${fmt(fixedMonthly)}/month. Tournament travel adds ${fmt(variableTotal)} in variable costs so far this season.`,
  };
}

function entryDeadlineUrgency(tournaments: any[]): InsightResult | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7Days = new Date(today); in7Days.setDate(today.getDate() + 7);

  const urgent = tournaments.filter((t: any) => {
    if (t.isWithdrawn) return false;
    const start = parseLocal(t.startDate ?? '');
    if (!start) return false;
    // Singles entry deadline is 18 days before start
    const deadline = new Date(start); deadline.setDate(start.getDate() - 18);
    return deadline >= today && deadline <= in7Days;
  });

  if (urgent.length === 0) return null;

  return {
    type: 'entry_deadline_urgency',
    label: 'ENTRY DEADLINE',
    text: `${urgent.length} tournament${urgent.length > 1 ? 's have' : ' has'} an entry deadline in the next 7 days: ${urgent.map((t: any) => t.name).join(', ')}.`,
  };
}

// ─── Priority selector ───────────────────────────────────────────────────────

const INSIGHT_GENERATORS: {
  type: string;
  fn: (t: any[], e: any[]) => InsightResult | null;
  minCooldownHours: number;
}[] = [
  { type: 'tournament_roi',          fn: tournamentROI,          minCooldownHours: 0 },
  { type: 'points_defense',          fn: (t) => pointsDefenseWarning(t), minCooldownHours: 24 },
  { type: 'spending_spike',          fn: spendingSpike,          minCooldownHours: 72 },
  { type: 'entry_deadline_urgency',  fn: (t) => entryDeadlineUrgency(t), minCooldownHours: 48 },
  { type: 'weekly_recap',            fn: weeklyRecap,            minCooldownHours: 120 },
  { type: 'season_net_position',     fn: seasonNetPosition,      minCooldownHours: 72 },
  { type: 'biggest_cost_category',   fn: biggestCostCategory,    minCooldownHours: 72 },
  { type: 'prize_coverage',          fn: prizeCoveragePercent,   minCooldownHours: 72 },
  { type: 'surface_cost_efficiency', fn: surfaceCostEfficiency,  minCooldownHours: 96 },
  { type: 'coach_travel_impact',     fn: coachTravelImpact,      minCooldownHours: 96 },
  { type: 'monthly_burn_rate',       fn: (_, e) => monthlyBurnRate(e), minCooldownHours: 96 },
  { type: 'cost_per_point',          fn: costPerPoint,           minCooldownHours: 96 },
  { type: 'geographic_efficiency',   fn: geographicEfficiency,   minCooldownHours: 96 },
  { type: 'upcoming_cost_estimate',  fn: upcomingCostEstimate,   minCooldownHours: 72 },
  { type: 'season_end_projection',   fn: seasonEndProjection,    minCooldownHours: 120 },
  { type: 'tracking_streak',         fn: trackingStreak,         minCooldownHours: 120 },
  { type: 'fixed_vs_variable',       fn: (_, e) => fixedVsVariable(e), minCooldownHours: 120 },
  { type: 'budget_runway',           fn: budgetRunway,           minCooldownHours: 120 },
];

export function selectInsight(
  tournaments: any[],
  expenses: any[],
  recentInsights: { type: string; generated_at: string }[],
  forceMonday = false,
): InsightResult | null {
  const now = new Date();
  const isMonday = forceMonday || now.getDay() === 1;

  function cooledDown(type: string, minHours: number): boolean {
    const last = recentInsights.find(i => i.type === type);
    if (!last) return true;
    const hrs = (now.getTime() - new Date(last.generated_at).getTime()) / 3600000;
    return hrs >= minHours;
  }

  // Monday always tries weekly recap first
  if (isMonday && cooledDown('weekly_recap', 100)) {
    const result = weeklyRecap(tournaments, expenses);
    if (result) return result;
  }

  for (const g of INSIGHT_GENERATORS) {
    if (!cooledDown(g.type, g.minCooldownHours)) continue;
    try {
      const result = g.fn(tournaments, expenses);
      if (result) return result;
    } catch {
      // skip on error, never surface broken insight
    }
  }

  return null;
}

export function hasEnoughData(tournaments: any[], expenses: any[]): boolean {
  // Each generator guards its own data requirements and returns null when unmet.
  // This gate only blocks the API call when the user has entered nothing at all.
  return tournaments.length >= 1 || expenses.length >= 1;
}
