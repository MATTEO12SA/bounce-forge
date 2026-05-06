export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getBrowserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadJson<T>(
  storage: KeyValueStorage | null,
  key: string,
  fallback: T,
  validate: (value: unknown) => value is T
): T {
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);

    if (!raw) {
      return fallback;
    }

    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson<T>(storage: KeyValueStorage | null, key: string, value: T): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Browsers can reject storage writes in private mode or when quota is full.
  }
}
