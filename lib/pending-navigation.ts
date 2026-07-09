// Tiny module-level holder for a notification-tap deep link that arrives
// before the app is ready to navigate (e.g. cold start, while AuthGate is
// still resolving auth/profile and may concurrently redirect to /auth or
// /onboarding). The notification response listener in useNotificationSetup
// writes here instead of navigating immediately; AuthGate consumes it once
// the user is signed in and onboarded, replaying the navigation.
//
// Deliberately minimal: one setter, one consume-once getter. Not a queue —
// only the most recent pending link is kept, matching how a user only taps
// one notification at a time.
export type PendingDeepLink =
  | { target: 'calendar' }
  | { target: 'tournament'; tournamentId: string };

let pending: PendingDeepLink | null = null;

export function setPendingDeepLink(link: PendingDeepLink): void {
  pending = link;
}

// Returns the pending link (if any) and clears it — a link is replayed at
// most once, so a second consumer (e.g. a re-render of AuthGate) doesn't
// re-navigate to a stale target.
export function consumePendingDeepLink(): PendingDeepLink | null {
  const link = pending;
  pending = null;
  return link;
}
