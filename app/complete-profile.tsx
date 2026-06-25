import { Redirect } from 'expo-router';

// Legacy InstantDB complete-profile screen — replaced by the Supabase onboarding flow.
export default function CompleteProfileScreen() {
  return <Redirect href="/(tabs)" />;
}
