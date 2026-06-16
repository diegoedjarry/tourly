// ITF World Tennis Tour deadline formulas.
// All tournaments start on Monday; deadlines are fixed offsets from startDate.
//   Singles entry:    Thursday 18 days before = startDate - 18 (lands on Thursday)
//   Withdrawal:       Tuesday  13 days before = startDate - 13 (lands on Tuesday)
//   Freeze / doubles: Thursday  4 days before = startDate -  4 (lands on Thursday)

function subtractDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function calcDeadlines(startDateStr: string): {
  signUpDeadline: string;
  withdrawalDeadline: string;
  freezeDeadline: string;
} {
  return {
    signUpDeadline: subtractDays(startDateStr, 18),
    withdrawalDeadline: subtractDays(startDateStr, 13),
    freezeDeadline: subtractDays(startDateStr, 4),
  };
}

export function fmtDeadline(dateStr: string): string {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]} at 14:00 GMT`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Format a YYYY-MM-DD date as "15 Jun" (or "15 Jun 2025" when year differs from current).
export function fmtDate(dateStr: string | undefined, currentYear?: number): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const thisYear = currentYear ?? new Date().getFullYear();
  return y !== thisYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

// Format a date range as "15–22 Jun", "28 May – 3 Jun", or with year when needed.
export function fmtDateRange(
  start: string | undefined,
  end: string | undefined,
  currentYear?: number,
): string {
  if (!start) return '';
  const thisYear = currentYear ?? new Date().getFullYear();
  const [sy, sm, sd] = start.split('-').map(Number);
  if (!end) {
    return sy !== thisYear ? `${sd} ${MONTHS[sm - 1]} ${sy}` : `${sd} ${MONTHS[sm - 1]}`;
  }
  const [ey, em, ed] = end.split('-').map(Number);
  const needsYear = sy !== thisYear || ey !== thisYear;
  if (sy === ey && sm === em) {
    return `${sd}–${ed} ${MONTHS[sm - 1]}${needsYear ? ` ${ey}` : ''}`;
  }
  if (sy === ey) {
    return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}${needsYear ? ` ${ey}` : ''}`;
  }
  return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}
