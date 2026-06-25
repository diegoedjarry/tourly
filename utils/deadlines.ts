// Deadline formulas for ITF and ATP Challenger circuits.
// All tournaments start on Monday; deadlines are fixed offsets from startDate.
//
// ── ITF (M15, M25, W15–W100) — times in GMT ──
//   Singles entry:           Thu, 18 days before Monday at 14:00 GMT
//   Withdrawal:              Tue, 13 days before Monday at 14:00 GMT
//   Freeze list:             Thu,  4 days before Monday at 14:00 GMT
//   Qualifying sign-in:      Sat,  2 days before Monday at 18:00 Local
//   Main draw doubles entry: Mon,  tournament start day at 14:00 Local
//
// ── ATP Challenger (50/75/100/125/175) — advance deadlines in ET ──
//   Main Draw Singles:        Mon, 21 days before Monday at 12:00 PM ET
//   Qualifying Draw:          Wed, 19 days before Monday at 12:00 PM ET
//   Doubles advance entry:    Mon,  7 days before Monday at 12:00 PM ET
//   Withdrawal / Freeze:      Fri,  3 days before Monday at 10:00 AM ET
//   Doubles entry (on-site):  Sat,  2 days before Monday at 12:00 Local
//   Sign-in / Eligibility:    Sat,  2 days before Monday 16:00–18:00 Local

const ITF_CATEGORIES = ['M15', 'M25', 'W15', 'W25', 'W35', 'W50', 'W75', 'W100'];
const CHALLENGER_CATEGORIES = ['Challenger 50', 'Challenger 75', 'Challenger 100', 'Challenger 125', 'Challenger 175'];

export type Circuit = 'itf' | 'challenger' | 'atp' | 'unknown';

export function getCircuit(category: string | undefined): Circuit {
  if (!category) return 'unknown';
  if (ITF_CATEGORIES.includes(category)) return 'itf';
  if (CHALLENGER_CATEGORIES.includes(category) || category.toLowerCase().startsWith('challenger')) return 'challenger';
  if (['ATP 250', 'ATP 500', 'Masters 1000', 'Grand Slam'].includes(category)) return 'atp';
  return 'unknown';
}

function subtractDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// The 3 storable/overridable deadlines (persisted in DB)
export interface DeadlineSet {
  signUpDeadline: string;
  withdrawalDeadline: string;
  freezeDeadline: string;
}

// All deadlines including calculated-only ones
export type DeadlineField =
  | 'signUpDeadline'
  | 'withdrawalDeadline'
  | 'freezeDeadline'
  | 'qualifyingDraw'
  | 'qualifyingSignIn'
  | 'doublesOnSite';

export interface DeadlineLabel {
  field: DeadlineField;
  label: string;
  time: string;
  dateStr: string;
  stored: boolean; // true = persisted in DB and overridable
}

interface DeadlineDef {
  field: DeadlineField;
  label: string;
  offset: number; // days before tournament Monday
  time: string;
  stored: boolean;
}

const ITF_DEADLINES: DeadlineDef[] = [
  { field: 'signUpDeadline',      label: 'Singles entry',       offset: 18, time: '14:00 GMT',   stored: true },
  { field: 'withdrawalDeadline',  label: 'Withdrawal',          offset: 13, time: '14:00 GMT',   stored: true },
  { field: 'freezeDeadline',      label: 'Freeze list',         offset: 4,  time: '14:00 GMT',   stored: true },
  { field: 'qualifyingSignIn',    label: 'Qualifying sign-in',  offset: 2,  time: '18:00 Local', stored: false },
  { field: 'doublesOnSite',       label: 'Doubles entry',       offset: 0,  time: '14:00 Local', stored: false },
];

const CHALLENGER_DEADLINES: DeadlineDef[] = [
  { field: 'signUpDeadline',      label: 'Main Draw Singles',       offset: 21, time: '12:00 PM ET',       stored: true },
  { field: 'qualifyingDraw',      label: 'Qualifying Draw',         offset: 19, time: '12:00 PM ET',       stored: false },
  { field: 'freezeDeadline',      label: 'Doubles advance entry',   offset: 7,  time: '12:00 PM ET',       stored: true },
  { field: 'withdrawalDeadline',  label: 'Withdrawal / Freeze',     offset: 3,  time: '10:00 AM ET',       stored: true },
];

export interface OnsiteDeadlineLabel {
  label: string;
  time: string;
  dateStr: string;
  refHour: number;
}

export function getOnsiteDeadlines(startDate: string, category: string | undefined): OnsiteDeadlineLabel[] {
  const circuit = getCircuit(category);

  if (circuit === 'itf') {
    const saturday = subtractDays(startDate, 2);
    return [
      { label: 'Qualifying sign-in', time: '18:00 local', dateStr: saturday, refHour: 18 },
      { label: 'Doubles on-site entry', time: '14:00 local', dateStr: startDate, refHour: 14 },
    ];
  }

  if (circuit === 'challenger') {
    const saturday = subtractDays(startDate, 2);
    const sunday = subtractDays(startDate, 1);
    return [
      { label: 'Main Draw Doubles', time: '12:00 noon local', dateStr: saturday, refHour: 12 },
      { label: 'Preserved Eligibility sign-in', time: '4:00–6:00 PM local', dateStr: saturday, refHour: 17 },
      { label: 'Alternate Sign-in for Qualifying', time: '4:00–6:00 PM local', dateStr: saturday, refHour: 17 },
      { label: 'On-site Alternate Sign-in', time: '30 min before first match', dateStr: sunday, refHour: 9 },
    ];
  }

  return [];
}

function getDeadlineDefs(category: string | undefined): DeadlineDef[] {
  const circuit = getCircuit(category);
  if (circuit === 'challenger') return CHALLENGER_DEADLINES;
  return ITF_DEADLINES;
}

export function calcDeadlines(startDateStr: string, category?: string): DeadlineSet {
  const circuit = getCircuit(category);

  if (circuit === 'challenger') {
    return {
      signUpDeadline: subtractDays(startDateStr, 21),
      freezeDeadline: subtractDays(startDateStr, 7),
      withdrawalDeadline: subtractDays(startDateStr, 3),
    };
  }

  // ITF / default
  return {
    signUpDeadline: subtractDays(startDateStr, 18),
    withdrawalDeadline: subtractDays(startDateStr, 13),
    freezeDeadline: subtractDays(startDateStr, 4),
  };
}

// Returns all 5 deadlines sorted chronologically by actual date
export function getDeadlineLabels(category: string | undefined, deadlines?: DeadlineSet, startDate?: string): DeadlineLabel[] {
  const defs = getDeadlineDefs(category);
  const start = startDate ?? '';

  return defs.map(def => {
    let dateStr = '';
    if (def.stored && deadlines) {
      dateStr = deadlines[def.field as keyof DeadlineSet] ?? '';
    } else if (start) {
      dateStr = subtractDays(start, def.offset);
    }
    return { field: def.field, label: def.label, time: def.time, dateStr, stored: def.stored };
  }).sort((a, b) => (a.dateStr || 'z').localeCompare(b.dateStr || 'z'));
}

// Kept for backward compatibility — returns only the 3 storable fields
export function getStoredDeadlineFields(category: string | undefined): { field: keyof DeadlineSet; label: string }[] {
  return getDeadlineDefs(category)
    .filter(d => d.stored)
    .map(d => ({ field: d.field as keyof DeadlineSet, label: d.label }));
}

export function fmtDeadline(dateStr: string, time?: string): string {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayName = DAYS[date.getUTCDay()];
  return time
    ? `${dayName} ${d} ${MO[m - 1]} · ${time}`
    : `${dayName} ${d} ${MO[m - 1]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(dateStr: string | undefined, currentYear?: number): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const thisYear = currentYear ?? new Date().getFullYear();
  return y !== thisYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

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
