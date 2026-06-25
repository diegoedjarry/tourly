import { Redirect } from 'expo-router';

// Legacy InstantDB welcome/OAuth screen — replaced by the Supabase /auth screen.
export default function WelcomeScreen() {
  return <Redirect href="/auth" />;
}
