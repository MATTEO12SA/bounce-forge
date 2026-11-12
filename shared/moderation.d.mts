export function normalizeForModeration(text: unknown): string;
export const BANNED_WORDS: readonly (readonly [string, boolean])[];
export function isOffensive(text: unknown): boolean;
export function hasLink(text: unknown): boolean;
