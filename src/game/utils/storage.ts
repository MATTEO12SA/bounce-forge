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
    const storage = window.localStorage;
    const probe = '__bounce-forge-probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Volatile storage used when the browser refuses persistent storage. */
export function createMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
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
