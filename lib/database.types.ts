export interface Tournament {
  id: string;
  user_id: string;
  name: string;
  country: string | null;
  city: string | null;
  surface: 'clay' | 'hard' | 'grass' | null;
  category: string | null;
  start_date: string;       // YYYY-MM-DD
  end_date: string | null;
  sign_up_deadline: string | null;
  withdrawal_deadline: string | null;
  freeze_deadline: string | null;
  is_registered: boolean;
  is_withdrawn: boolean;
  is_in_my_list: boolean;
  prize_money: number;
  singles_prize_money: number;
  doubles_prize_money: number;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrainingBlock {
  id: string;
  user_id: string;
  title: string;
  start_date: string;       // YYYY-MM-DD
  end_date: string;         // YYYY-MM-DD
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  tournament_id: string | null;
  category: string;
  amount: number;
  date: string;             // YYYY-MM-DD
  note: string | null;
  is_coach_expense: boolean | null;
  created_at: string;
}
