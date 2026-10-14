import { describe, it, expect } from 'vitest';
import {
  cycleId,
  fileKey,
  pickAfterClose,
  tabShortcut,
} from '@/js/logic/view-pdf-tabs';

describe('fileKey', () => {
  it('is the same for the same file and differs when anything changes', () => {
    const a = { name: 'a.pdf', size: 10, lastModified: 1 };
    expect(fileKey(a)).toBe(fileKey({ ...a }));
    expect(fileKey(a)).not.toBe(fileKey({ ...a, name: 'b.pdf' }));
    expect(fileKey(a)).not.toBe(fileKey({ ...a, size: 11 }));
    expect(fileKey(a)).not.toBe(fileKey({ ...a, lastModified: 2 }));
  });
});

describe('pickAfterClose', () => {
  const ids = [1, 2, 3, 4];

  it('keeps the active tab when another tab is closed', () => {
    expect(pickAfterClose(ids, 3, 2)).toBe(2);
    expect(pickAfterClose(ids, 1, 4)).toBe(4);
  });

  it('moves to the tab on the right when the active one is closed', () => {
    expect(pickAfterClose(ids, 2, 2)).toBe(3);
    expect(pickAfterClose(ids, 1, 1)).toBe(2);
  });

  it('moves to the last tab when the last one is closed', () => {
    expect(pickAfterClose(ids, 4, 4)).toBe(3);
  });

  it('returns null once nothing is left', () => {
    expect(pickAfterClose([7], 7, 7)).toBeNull();
    expect(pickAfterClose([], 1, null)).toBeNull();
  });
});

describe('cycleId', () => {
  const ids = [1, 2, 3];

  it('steps forward and back, wrapping around', () => {
    expect(cycleId(ids, 1, 1)).toBe(2);
    expect(cycleId(ids, 3, 1)).toBe(1);
    expect(cycleId(ids, 1, -1)).toBe(3);
    expect(cycleId(ids, 2, -1)).toBe(1);
  });

  it('starts from an end when nothing is active', () => {
    expect(cycleId(ids, null, 1)).toBe(1);
    expect(cycleId(ids, null, -1)).toBe(3);
  });

  it('stays put with a single tab and returns null with none', () => {
    expect(cycleId([5], 5, 1)).toBe(5);
    expect(cycleId([], null, 1)).toBeNull();
  });
});

describe('tabShortcut', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it('recognises the tab keys', () => {
    expect(tabShortcut(key('w'))).toBe('close');
    expect(tabShortcut(key('W'))).toBe('close');
    expect(tabShortcut(key('Tab'))).toBe('next');
    expect(tabShortcut(key('Tab', { shiftKey: true }))).toBe('previous');
    expect(tabShortcut(key('PageDown'))).toBe('next');
    expect(tabShortcut(key('PageUp'))).toBe('previous');
    expect(tabShortcut(key('w', { ctrlKey: false, metaKey: true }))).toBe(
      'close'
    );
  });

  it('ignores keys without Ctrl/Cmd and other combinations', () => {
    expect(tabShortcut(key('w', { ctrlKey: false }))).toBeNull();
    expect(tabShortcut(key('Tab', { ctrlKey: false }))).toBeNull();
    expect(tabShortcut(key('w', { altKey: true }))).toBeNull();
    expect(tabShortcut(key('p'))).toBeNull();
  });
});
