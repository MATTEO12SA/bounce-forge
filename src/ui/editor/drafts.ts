/**
 * Unsaved editor drafts, one per creative slot, kept in localStorage so nothing is lost when the
 * player tests a level, reloads the page or leaves by accident.
 */

import { sanitizeLevelOptions, type LevelOptions } from '../../game/levels/levelOptions';

export interface EditorDraft {
  name: string;
  rows: string[];
  options?: LevelOptions;
  /** Set when the draft was just created from the workshop (no "restored" message). */
  fresh?: boolean;
}

const PREFIX = 'bounce-forge.editor-draft.v1.';

export function readDraft(slotIndex: number): EditorDraft | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + slotIndex);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorDraft>;
    if (!Array.isArray(parsed.rows) || typeof parsed.name !== 'string') return null;
    return {
      name: parsed.name.slice(0, 120),
      rows: parsed.rows.filter((row): row is string => typeof row === 'string'),
      options: sanitizeLevelOptions(parsed.options),
      fresh: parsed.fresh === true
    };
  } catch {
    return null;
  }
}

export function writeDraft(slotIndex: number, draft: EditorDraft): void {
  try {
    window.localStorage.setItem(PREFIX + slotIndex, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the editor keeps working, only the safety net is missing.
  }
}

export function clearDraft(slotIndex: number): void {
  try {
    window.localStorage.removeItem(PREFIX + slotIndex);
  } catch {
    // Ignore blocked storage.
  }
}

export function hasDraft(slotIndex: number): boolean {
  return readDraft(slotIndex) !== null;
}
