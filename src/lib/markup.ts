// Bulk markup operations: clearing all notation (text notes) or all
// arrows. Each clears only its own kind — clearing notes keeps the
// arrows, and clearing arrows keeps the notes. TimeTarget setup notes
// are text items, so they go with the rest of the notes; re-import the
// TimeTarget file to restore them.
import type { MarkupItem } from '../types';

export const countMarkupOfType = (markup: MarkupItem[], type: 'text' | 'arrow'): number =>
  markup.filter(m => m.type === type).length;

export const clearMarkupOfType = (markup: MarkupItem[], type: 'text' | 'arrow'): MarkupItem[] =>
  markup.filter(m => m.type !== type);
