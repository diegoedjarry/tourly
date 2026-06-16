import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bpxcizhgntucuhhyykqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweGNpemhnbnR1Y3VoaHl5a3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mzg4NDgsImV4cCI6MjA5NzIxNDg0OH0.H4nyd-JmwhXfizxSEpEz8K5mY7_YrgnrsKpeIHQM6gc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
