import { Booking, EditorLock, ImportHistoryEntry, MarkupItem, SharedBoardFile } from '../types';

const SHARED_FILE_FORMAT = 'whiteboard-shared-board';

export function createSharedFile(
  bookings: Booking[],
  revision: number,
  history: ImportHistoryEntry[],
  markup: MarkupItem[],
  editorLock?: EditorLock | null
): SharedBoardFile {
  return {
    format: SHARED_FILE_FORMAT,
    version: 1,
    revision,
    exportedAt: new Date().toISOString(),
    bookings,
    history,
    markup,
    editorLock: editorLock ?? null
  };
}

export function parseSharedFile(text: string): SharedBoardFile {
  const parsed = JSON.parse(text) as SharedBoardFile;
  if (parsed?.format !== SHARED_FILE_FORMAT || parsed.version !== 1) {
    throw new Error('This file is not a compatible Whiteboard published-board file.');
  }
  if (!Array.isArray(parsed.bookings)) {
    throw new Error('The published-board file is missing bookings.');
  }
  // A board file can carry two notes with the same id — a TimeTarget
  // import that ran before the import deduped by key left one in a
  // real board. Two notes with one id make React's keyed
  // reconciliation duplicate the note on every render, which the
  // MarkupLayer observer then chases forever. Keep the first copy.
  const seen = new Set<string>();
  const markup = (Array.isArray(parsed.markup) ? parsed.markup : []).filter(m => {
    if (!m || typeof m.id !== 'string') return true;
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  return {
    ...parsed,
    revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    markup,
    editorLock: parsed.editorLock && typeof parsed.editorLock === 'object' && typeof parsed.editorLock.id === 'string' && typeof parsed.editorLock.at === 'number' ? parsed.editorLock : null
  };
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadSharedFile(file: SharedBoardFile) {
  downloadJson(file, `whiteboard-published-rev${file.revision}-${new Date().toISOString().slice(0, 10)}.json`);
}

// The File System Access API (desktop Chrome/Edge) lets the app write
// back to the SAME file it opened, instead of downloading a new copy
// each time. A handle is kept in a ref in App.tsx; the three files the
// board links — the bookings export, the venue YAML and the board JSON —
// are written back through these helpers whenever they change, and the
// Save and refresh button writes then re-reads them.
export type LinkedFileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
};
// A stored file handle, with the permission methods the File System
// Access API provides. The raw handle carries these; LinkedFileHandle
// is the structural shape the app uses day to day.
export type StoredFileHandle = LinkedFileHandle & {
  queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
};
// Linked handles, kept across sessions. A file handle cannot go in
// localStorage (it is not a string), but IndexedDB can hold it, so the
// links survive a reload and a new version of the app. The handles are
// keyed by which file they are: board, yaml, bookings.
const LINKED_DB = 'whiteboard-linked-files';
const LINKED_STORE = 'handles';
function openLinkedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LINKED_DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(LINKED_STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveLinkedHandle(key: string, handle: LinkedFileHandle): Promise<void> {
  const db = await openLinkedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LINKED_STORE, 'readwrite');
    tx.objectStore(LINKED_STORE).put(handle, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function loadLinkedHandle(key: string): Promise<LinkedFileHandle | null> {
  const db = await openLinkedDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(LINKED_STORE, 'readonly').objectStore(LINKED_STORE).get(key);
    request.onsuccess = () => { db.close(); resolve((request.result as LinkedFileHandle) || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}
export async function pickLinkedFile(options: { types: { description: string; accept: Record<string, string[]> }[]; multiple?: boolean }): Promise<LinkedFileHandle | null> {
  const w = window as unknown as { showOpenFilePicker: (o: unknown) => Promise<LinkedFileHandle[]> };
  const [handle] = await w.showOpenFilePicker({ ...options, multiple: false });
  return handle || null;
}
export async function pickLinkedFileToSave(suggestedName: string, description: string, accept: Record<string, string[]> = { 'application/json': ['.json'] }): Promise<LinkedFileHandle | null> {
  const w = window as unknown as { showSaveFilePicker: (o: unknown) => Promise<LinkedFileHandle> };
  return await w.showSaveFilePicker({ suggestedName, types: [{ description, accept }] });
}
export async function writeLinkedFile(handle: LinkedFileHandle, text: string, mime = 'application/json'): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(new Blob([text], { type: mime }));
  await writable.close();
}
export async function readLinkedFile(handle: LinkedFileHandle): Promise<string> {
  return await (await handle.getFile()).text();
}
export function serializeSharedFile(file: SharedBoardFile): string {
  return JSON.stringify(file, null, 2);
}
export async function writeSharedFileToHandle(handle: LinkedFileHandle, file: SharedBoardFile): Promise<void> {
  await writeLinkedFile(handle, serializeSharedFile(file));
}
export async function readSharedFileFromHandle(handle: LinkedFileHandle): Promise<SharedBoardFile> {
  return parseSharedFile(await readLinkedFile(handle));
}
