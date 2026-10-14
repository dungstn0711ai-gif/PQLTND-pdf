// PDF viewer page: shows PDFs in the embedded PDF.js viewer, read-only. Any
// number of files can be open at once, one tab each (like Foxit or a browser).
import { showAlert } from '../ui.js';
import { getLanguageFromUrl, t } from '../i18n/i18n.js';
import { getBridge } from '../desktop/bridge.js';
import { THEME_EVENT } from '../desktop/theme.js';
import type { PrintSource } from '../desktop/print-dialog.js';
import {
  applyViewerChrome,
  applyViewerTheme,
  pdfjsLocale,
} from './pdf-viewer-chrome.js';
import {
  VIEWER_TOOLS_EVENT,
  type ViewerToolsDetail,
} from './view-pdf-events.js';
import {
  cycleId,
  fileKey,
  pickAfterClose,
  tabShortcut,
} from './view-pdf-tabs.js';

interface ViewerOptions {
  set(name: string, value: unknown): void;
}

interface ViewerWindow extends Window {
  PDFViewerApplicationOptions?: ViewerOptions;
  PDFViewerApplication?: {
    pdfDocument?: PrintSource['pdfDocument'] | null;
    page?: number;
  };
}

interface ViewerTab {
  id: number;
  file: File;
  key: string;
  blobUrl: string;
  /** Created the first time the tab is shown, so opening 20 files at once
   *  does not start 20 viewers. Kept afterwards, so page and zoom survive. */
  iframe: HTMLIFrameElement | null;
  tabEl: HTMLElement;
}

const tabs: ViewerTab[] = [];
let activeId: number | null = null;
let nextTabId = 1;

function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function getFileInput(): HTMLInputElement | null {
  return document.getElementById('file-input') as HTMLInputElement | null;
}

function activeTab(): ViewerTab | undefined {
  return tabs.find((tab) => tab.id === activeId);
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Desktop: route the viewer's print button and Ctrl+P to the app's own print
 * dialog, since the system dialog cannot show a preview for Electron.
 */
function installDesktopPrint(iframe: HTMLIFrameElement) {
  const viewer = iframe.contentWindow as ViewerWindow | null;
  if (!viewer || typeof getBridge()?.print !== 'function') return;

  const systemPrint = viewer.print.bind(viewer);
  viewer.print = () => {
    const app = viewer.PDFViewerApplication;
    const pdfDocument = app?.pdfDocument;
    const fontDocument = iframe.contentDocument;
    if (!pdfDocument || !fontDocument) return;
    void import('../desktop/print-dialog.js').then(({ openPrintDialog }) =>
      openPrintDialog({
        pdfDocument,
        fontDocument,
        currentPage: app.page ?? 1,
        systemPrint,
      })
    );
  };
}

function createFrame(tab: ViewerTab): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.className = 'h-full w-full border-0';
  iframe.title = tab.file.name;
  iframe.src = `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html?file=${encodeURIComponent(tab.blobUrl)}`;
  iframe.addEventListener('load', () => {
    if (__DESKTOP__) installDesktopPrint(iframe);
    watchFrame(iframe);
    void applyViewerChrome(iframe, {
      fileName: tab.file.name,
      closeLabel: t('tools:viewPdf.closeTab'),
      twoPagesLabel: t('tools:viewPdf.twoPages'),
      onClose: () => closeTab(tab.id),
      tools: __DESKTOP__
        ? {
            label: t('tools:viewPdf.tools'),
            onClick: () =>
              document.dispatchEvent(
                new CustomEvent<ViewerToolsDetail>(VIEWER_TOOLS_EVENT, {
                  detail: { file: tab.file },
                })
              ),
          }
        : undefined,
    });
    // Keep the keyboard (arrows, PageDown, Ctrl+F) with the file just shown.
    if (activeId === tab.id) iframe.contentWindow?.focus();
  });
  return iframe;
}

/** An X drawn inline, so it shows even where the icon font is missing. */
function closeIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M3.5 3.5l9 9m0-9l-9 9');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}

function buildTabElement(tab: ViewerTab): HTMLElement {
  const el = document.createElement('div');
  el.className = 'viewer-tab';
  el.setAttribute('role', 'tab');
  el.setAttribute('aria-selected', 'false');
  el.tabIndex = -1;
  el.title = tab.file.name;

  const title = document.createElement('span');
  title.className = 'viewer-tab-title';
  title.textContent = tab.file.name;
  title.setAttribute('data-no-translate', '');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'viewer-tab-close';
  close.title = t('tools:viewPdf.closeTab');
  close.setAttribute('aria-label', t('tools:viewPdf.closeTab'));
  close.append(closeIcon());

  el.append(title, close);

  el.addEventListener('click', () => activate(tab.id));
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeTab(tab.id);
  });
  // Middle click closes, as in a browser.
  el.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  el.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    closeTab(tab.id);
  });
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showTabMenu(event.clientX, event.clientY, tab.id);
  });
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate(tab.id);
  });
  return el;
}

function addTab(file: File): ViewerTab {
  const tab: ViewerTab = {
    id: nextTabId++,
    file,
    key: fileKey(file),
    blobUrl: URL.createObjectURL(file),
    iframe: null,
    tabEl: document.createElement('div'),
  };
  tab.tabEl = buildTabElement(tab);
  tabs.push(tab);
  document.getElementById('viewer-tab-list')?.append(tab.tabEl);
  return tab;
}

function activate(id: number) {
  const tab = tabs.find((candidate) => candidate.id === id);
  const container = document.getElementById('pdf-viewer-container');
  if (!tab || !container) return;

  activeId = id;
  if (!tab.iframe) {
    tab.iframe = createFrame(tab);
    container.append(tab.iframe);
  }
  for (const other of tabs) {
    const selected = other.id === id;
    other.tabEl.setAttribute('aria-selected', String(selected));
    other.tabEl.tabIndex = selected ? 0 : -1;
    other.iframe?.classList.toggle('viewer-frame-hidden', !selected);
  }
  tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // Already loaded (switching back to it): hand it the keyboard straight away.
  if (tab.iframe.contentDocument?.readyState === 'complete') {
    tab.iframe.contentWindow?.focus();
  }

  document.getElementById('uploader')?.classList.add('hidden');
  document.getElementById('viewer-panel')?.classList.remove('hidden');
}

function disposeTab(tab: ViewerTab) {
  URL.revokeObjectURL(tab.blobUrl);
  tab.iframe?.remove();
  tab.tabEl.remove();
}

function showUploader() {
  activeId = null;
  document.getElementById('viewer-panel')?.classList.add('hidden');
  document.getElementById('uploader')?.classList.remove('hidden');
  const input = getFileInput();
  if (input) input.value = '';
}

function closeTab(id: number | null) {
  if (id === null) return;
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const next = pickAfterClose(
    tabs.map((tab) => tab.id),
    id,
    activeId
  );
  disposeTab(tabs[index]);
  tabs.splice(index, 1);
  if (next === null) showUploader();
  else if (next !== activeId) activate(next);
}

function closeOthers(id: number) {
  for (const tab of tabs.filter((candidate) => candidate.id !== id)) {
    disposeTab(tab);
    tabs.splice(tabs.indexOf(tab), 1);
  }
  activate(id);
}

function closeAll() {
  for (const tab of tabs) disposeTab(tab);
  tabs.length = 0;
  showUploader();
}

/** Open each PDF in its own tab and show the first; one already open is reused. */
function openFiles(files: File[]) {
  const pdfs = files.filter(isPdf);
  const skipped = files.length - pdfs.length;

  let first: ViewerTab | undefined;
  for (const file of pdfs) {
    const key = fileKey(file);
    const tab = tabs.find((candidate) => candidate.key === key) ?? addTab(file);
    first ??= tab;
  }
  if (first) activate(first.id);

  if (pdfs.length === 0 && skipped > 0) {
    showAlert(t('alert.title'), t('tools:viewPdf.invalidFile'));
  } else if (skipped > 0) {
    showAlert(
      t('alert.title'),
      t('tools:viewPdf.someInvalid', { count: skipped })
    );
  }
}

function switchTab(step: 1 | -1) {
  const id = cycleId(
    tabs.map((tab) => tab.id),
    activeId,
    step
  );
  if (id !== null && id !== activeId) activate(id);
}

function handleTabKeys(event: KeyboardEvent) {
  if (tabs.length === 0) return;
  const action = tabShortcut(event);
  if (!action) return;
  // Also stops the app menu's own Ctrl+W from closing the whole window.
  event.preventDefault();
  if (action === 'close') closeTab(activeId);
  else switchTab(action === 'next' ? 1 : -1);
}

// ---- Tab context menu ----

let tabMenu: HTMLElement | null = null;

function hideTabMenu() {
  tabMenu?.remove();
  tabMenu = null;
}

function showTabMenu(x: number, y: number, id: number) {
  hideTabMenu();
  const menu = document.createElement('div');
  menu.className = 'viewer-tab-menu';
  menu.setAttribute('role', 'menu');

  const entries: Array<[string, () => void, boolean]> = [
    [t('tools:viewPdf.closeTab'), () => closeTab(id), false],
    [t('tools:viewPdf.closeOthers'), () => closeOthers(id), tabs.length < 2],
    [t('tools:viewPdf.closeAll'), closeAll, false],
  ];
  for (const [label, run, disabled] of entries) {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    item.disabled = disabled;
    item.addEventListener('click', () => {
      hideTabMenu();
      run();
    });
    menu.append(item);
  }

  document.body.append(menu);
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - width))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - height))}px`;
  tabMenu = menu;
}

document.addEventListener(
  'pointerdown',
  (event) => {
    if (tabMenu && !tabMenu.contains(event.target as Node)) hideTabMenu();
  },
  true
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideTabMenu();
});
// A click inside a viewer frame never reaches this document.
window.addEventListener('blur', hideTabMenu);

// ---- Drag and drop: files dropped anywhere on the window open as tabs ----

function setDropOverlay(visible: boolean) {
  if (visible && tabs.length === 0) return;
  document
    .getElementById('viewer-drop-overlay')
    ?.classList.toggle('hidden', !visible);
}

/** Viewer frames swallow drag events, so they report them to this page. */
function watchFrame(iframe: HTMLIFrameElement) {
  const win = iframe.contentWindow;
  if (!win) return;
  win.addEventListener('keydown', handleTabKeys);
  win.addEventListener('dragenter', (event) => {
    if (hasFiles(event)) setDropOverlay(true);
  });
  // Without this the frame would navigate to a dropped file.
  win.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  win.addEventListener('drop', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
}

// The viewer announces itself on the parent document before it reads its
// options, which is the only point where editing can be switched off.
document.addEventListener('webviewerloaded', (event) => {
  const source = (event as CustomEvent<{ source: ViewerWindow }>).detail
    ?.source;
  const options = source?.PDFViewerApplicationOptions;
  if (!options) return;
  options.set('disablePreferences', true);
  options.set('annotationEditorMode', -1);
  // Without this PDF.js follows the OS language, not the app's.
  options.set('localeProperties', { lang: pdfjsLocale(getLanguageFromUrl()) });
});

// Follow the app's light/dark switch while a file is open.
document.addEventListener(THEME_EVENT, () => {
  for (const tab of tabs) {
    const doc = tab.iframe?.contentDocument;
    if (doc) applyViewerTheme(doc);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = getFileInput();
  const dropZone = document.getElementById('drop-zone');

  const tabList = document.getElementById('viewer-tab-list');
  tabList?.setAttribute('aria-label', t('tools:viewPdf.tabs'));

  fileInput?.addEventListener('change', () => {
    // Copy first: clearing the input (so the same file can be picked again)
    // empties its list.
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    if (files.length > 0) openFiles(files);
  });

  document
    .getElementById('viewer-tab-add')
    ?.addEventListener('click', () => fileInput?.click());

  dropZone?.addEventListener('dragover', () => {
    dropZone.classList.add('border-indigo-500');
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-500');
  });

  // One place handles every drop, on the upload box, the tab strip or a frame.
  window.addEventListener('dragenter', (event) => {
    if (hasFiles(event)) setDropOverlay(true);
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropZone?.classList.remove('border-indigo-500');
    setDropOverlay(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) openFiles(files);
  });
  window.addEventListener('dragend', () => setDropOverlay(false));
  document
    .getElementById('viewer-drop-overlay')
    ?.addEventListener('dragleave', () => setDropOverlay(false));

  window.addEventListener('keydown', handleTabKeys);

  // Ctrl+P while focus is outside the viewer frame.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'p') return;
    const frame = activeTab()?.iframe;
    if (!frame?.contentWindow) return;
    e.preventDefault();
    frame.contentWindow.print();
  });

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });
});

window.addEventListener('beforeunload', () => {
  for (const tab of tabs) URL.revokeObjectURL(tab.blobUrl);
});
