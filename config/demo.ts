// Set EXPO_PUBLIC_DEMO_MODE=true in .env.local for local development.
// Never set this in production builds.
// __DEV__ gate: a stray EXPO_PUBLIC_DEMO_MODE=true in a production build must
// never ship an auth-bypassed app. Demo TestFlight builds need a deliberate
// code change here, which is the point.
export const DEMO_MODE = __DEV__ && process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

const T1 = 'd-t1'; // M25 Cuiabá    — ACTIVE today
const T2 = 'd-t2'; // M25 Buenos Aires
const T3 = 'd-t3'; // M15 Lakewood
const T4 = 'd-t4'; // M25 Madrid
const T5 = 'd-t5'; // M25 Melbourne
const T6 = 'd-t6'; // M25 Paris      — PAST
const T7 = 'd-t7'; // M15 Rome       — PAST

const tournaments = [
  {
    id: T1, name: 'M25 Cuiabá', country: 'BR', city: 'Cuiabá',
    surface: 'clay', category: 'M25',
    startDate: '2026-06-09', endDate: '2026-06-15',
    signUpDeadline: '2026-06-03', withdrawalDeadline: '2026-06-12', freezeDeadline: '2026-06-13',
    status: 'active', isRegistered: true, isWithdrawn: false, isInMyList: true,
    prizeMoney: 360, singlesPrizeMoney: 360, doublesPrizeMoney: 0,
  },
  {
    id: T2, name: 'M25 Buenos Aires', country: 'AR', city: 'Buenos Aires',
    surface: 'clay', category: 'M25',
    startDate: '2026-06-16', endDate: '2026-06-22',
    signUpDeadline: '2026-06-10', withdrawalDeadline: '2026-06-19', freezeDeadline: '2026-06-20',
    status: 'upcoming', isRegistered: true, isWithdrawn: false, isInMyList: true,
    prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
  },
  {
    id: T3, name: 'M15 Lakewood', country: 'US', city: 'Lakewood',
    surface: 'hard', category: 'M15',
    startDate: '2026-06-23', endDate: '2026-06-29',
    signUpDeadline: '2026-06-19', withdrawalDeadline: '2026-06-26', freezeDeadline: '2026-06-27',
    status: 'upcoming', isRegistered: false, isWithdrawn: false, isInMyList: true,
    prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
  },
  {
    id: T4, name: 'M25 Madrid', country: 'ES', city: 'Madrid',
    surface: 'clay', category: 'M25',
    startDate: '2026-06-30', endDate: '2026-07-06',
    signUpDeadline: '2026-06-24', withdrawalDeadline: '2026-07-03', freezeDeadline: '2026-07-04',
    status: 'upcoming', isRegistered: false, isWithdrawn: false, isInMyList: true,
    prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
  },
  {
    id: T5, name: 'M25 Melbourne', country: 'AU', city: 'Melbourne',
    surface: 'hard', category: 'M25',
    startDate: '2026-07-07', endDate: '2026-07-13',
    signUpDeadline: '2026-07-01', withdrawalDeadline: '2026-07-10', freezeDeadline: '2026-07-11',
    status: 'upcoming', isRegistered: true, isWithdrawn: false, isInMyList: true,
    prizeMoney: 0, singlesPrizeMoney: 0, doublesPrizeMoney: 0,
  },
  {
    id: T6, name: 'M25 Paris', country: 'FR', city: 'Paris',
    surface: 'clay', category: 'M25',
    startDate: '2026-05-27', endDate: '2026-06-02',
    signUpDeadline: '2026-05-21', withdrawalDeadline: '2026-05-30', freezeDeadline: '2026-05-31',
    status: 'past', isRegistered: true, isWithdrawn: false, isInMyList: true,
    prizeMoney: 360, singlesPrizeMoney: 360, doublesPrizeMoney: 0,
  },
  {
    id: T7, name: 'M15 Rome', country: 'IT', city: 'Rome',
    surface: 'clay', category: 'M15',
    startDate: '2026-05-20', endDate: '2026-05-26',
    signUpDeadline: '2026-05-14', withdrawalDeadline: '2026-05-23', freezeDeadline: '2026-05-24',
    status: 'past', isRegistered: true, isWithdrawn: false, isInMyList: true,
    prizeMoney: 180, singlesPrizeMoney: 180, doublesPrizeMoney: 0,
  },
];

const expenses = [
  // Paris
  { id: 'e-1',  tournamentId: T6, category: 'flight',         amount: 680, note: 'SCL → CDG · LATAM',        date: '2026-05-27', isCoachExpense: false },
  { id: 'e-2',  tournamentId: T6, category: 'hotel',          amount: 420, note: '7 nights · Hôtel du Sport', date: '2026-05-27', isCoachExpense: false },
  { id: 'e-3',  tournamentId: T6, category: 'meals',          amount: 280, note: '',                          date: '2026-05-28', isCoachExpense: false },
  { id: 'e-4',  tournamentId: T6, category: 'transport',      amount: 95,  note: 'Metro + Uber',              date: '2026-05-29', isCoachExpense: false },
  { id: 'e-5',  tournamentId: T6, category: 'strings & grip', amount: 45,  note: 'Luxilon ALU Power',         date: '2026-05-30', isCoachExpense: false },
  // Rome
  { id: 'e-6',  tournamentId: T7, category: 'flight',         amount: 520, note: 'SCL → FCO · Iberia',       date: '2026-05-20', isCoachExpense: false },
  { id: 'e-7',  tournamentId: T7, category: 'hotel',          amount: 350, note: '6 nights · Hotel Roma',    date: '2026-05-20', isCoachExpense: false },
  { id: 'e-8',  tournamentId: T7, category: 'meals',          amount: 210, note: '',                         date: '2026-05-21', isCoachExpense: false },
  { id: 'e-9',  tournamentId: T7, category: 'transport',      amount: 55,  note: 'Airport taxi',             date: '2026-05-20', isCoachExpense: false },
  // Cuiabá (active)
  { id: 'e-10', tournamentId: T1, category: 'flight',         amount: 750, note: 'SCL → CGB · LATAM',        date: '2026-06-09', isCoachExpense: false },
  { id: 'e-11', tournamentId: T1, category: 'hotel',          amount: 310, note: '6 nights · Comfort Hotel', date: '2026-06-09', isCoachExpense: false },
  { id: 'e-12', tournamentId: T1, category: 'meals',          amount: 145, note: '',                         date: '2026-06-10', isCoachExpense: false },
  { id: 'e-13', tournamentId: T1, category: 'transport',      amount: 40,  note: 'Airport + courts',         date: '2026-06-09', isCoachExpense: false },
  { id: 'e-14', tournamentId: T1, category: 'strings & grip', amount: 30,  note: '',                         date: '2026-06-10', isCoachExpense: false },
];

export const DEMO_DATA = {
  tournaments,
  expenses,
  monthlyExpenses: [],
  devices: [],
  users: [],
};
