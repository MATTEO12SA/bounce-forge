/**
 * Which Workshop slot was published as which creation, so "Publish" can offer an update.
 * Kept in localStorage next to the community session.
 */

const KEY = 'bounce-forge.community.published';
const SESSION_KEY = 'bounce-forge.community';

function read(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
}

function write(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Storage blocked: updates fall back to new publications.
  }
}

export function publicationOf(slotIndex: number): string | undefined {
  return read()[String(slotIndex)];
}

export function rememberPublication(slotIndex: number, id: string): void {
  write({ ...read(), [String(slotIndex)]: id });
}

export function forgetPublication(id: string): void {
  write(Object.fromEntries(Object.entries(read()).filter(([, value]) => value !== id)));
}

/** True once this browser has a community account (it has published, liked or played). */
export function hasCommunitySession(): boolean {
  try {
    return window.localStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}
