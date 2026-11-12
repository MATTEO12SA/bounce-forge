/**
 * Whether an admin is signed in on this device, shared by every screen (settings, community,
 * pause menu). supabase-js is only loaded when an admin session was saved before, so ordinary
 * players never download it for this.
 */

export interface AdminState {
  email: string;
  isAdmin: boolean;
}

/** Where supabase-js keeps the admin session (see `storageKey` in admin.ts). */
export const ADMIN_STORAGE_KEY = 'bounce-forge.admin';

let current: AdminState | null = null;
let pending: Promise<AdminState | null> | null = null;
const listeners = new Set<(state: AdminState | null) => void>();

function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(ADMIN_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** The admin state known right now (null until checked, or when nobody is signed in). */
export function adminNow(): AdminState | null {
  return current;
}

/** True when a signed-in admin can use the admin tools. */
export function isAdminNow(): boolean {
  return current?.isAdmin === true;
}

export function setAdminState(state: AdminState | null): void {
  current = state;
  pending = Promise.resolve(state);
  listeners.forEach((listener) => listener(state));
}

/** Checks the saved admin session once (cached); resolves to null when there is none. */
export function adminStatus(): Promise<AdminState | null> {
  if (pending) return pending;
  if (!hasStoredSession()) {
    pending = Promise.resolve(null);
    return pending;
  }
  pending = import('./admin')
    .then(({ adminSession }) => adminSession())
    .then((state) => {
      setAdminState(state);
      return state;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

export function onAdminChange(listener: (state: AdminState | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
