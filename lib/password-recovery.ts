// Cross-module flag for an in-flight password recovery. Set when a recovery
// deep link (or PASSWORD_RECOVERY auth event) is detected, cleared when the
// reset-password screen saves or unmounts. The AuthGate in app/_layout.tsx
// checks it so the recovery session's SIGNED_IN transition doesn't redirect
// the user away from /reset-password before they can set a new password.
// Module-level (not persisted) on purpose: a killed app should never resume
// into a half-finished recovery.
let recoveryInProgress = false;

export function setRecoveryInProgress(value: boolean): void {
  recoveryInProgress = value;
}

export function isRecoveryInProgress(): boolean {
  return recoveryInProgress;
}
