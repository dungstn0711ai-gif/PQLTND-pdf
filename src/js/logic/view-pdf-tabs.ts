// Pure helpers for the viewer's tab strip. No DOM here, so they are easy to test.

/** Same name, size and modified time: treated as the same file. */
export function fileKey(file: {
  name: string;
  size: number;
  lastModified: number;
}): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/**
 * Which tab to show once `closedId` is gone. Closing a tab other than the
 * active one changes nothing; closing the active one moves to the tab that
 * took its place (the one to its right), or to the last tab if it was last.
 * `ids` is the tab order before the tab is removed.
 */
export function pickAfterClose(
  ids: readonly number[],
  closedId: number,
  activeId: number | null
): number | null {
  const remaining = ids.filter((id) => id !== closedId);
  if (remaining.length === 0) return null;
  if (activeId !== closedId) return activeId;
  const index = ids.indexOf(closedId);
  return remaining[Math.min(index, remaining.length - 1)];
}

/** The tab `step` places away from the active one, wrapping at the ends. */
export function cycleId(
  ids: readonly number[],
  activeId: number | null,
  step: 1 | -1
): number | null {
  if (ids.length === 0) return null;
  const index = activeId === null ? -1 : ids.indexOf(activeId);
  if (index === -1) return ids[step === 1 ? 0 : ids.length - 1];
  return ids[(index + step + ids.length) % ids.length];
}

export type TabShortcut = 'close' | 'next' | 'previous';

/** Foxit/browser-style keys: Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageUp/Down. */
export function tabShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): TabShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'w' && !event.shiftKey) return 'close';
  if (key === 'tab') return event.shiftKey ? 'previous' : 'next';
  if (key === 'pagedown' && !event.shiftKey) return 'next';
  if (key === 'pageup' && !event.shiftKey) return 'previous';
  return null;
}
