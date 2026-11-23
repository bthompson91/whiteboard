import { Booking, EditorLock, JobEntry, MarkupItem, SharedBoardFile } from '../types';

const SHARED_FILE_FORMAT = 'whiteboard-shared-board';

export function createSharedFile(
  bookings: Booking[],
  revision: number,
  markup: MarkupItem[],
  editorLock?: EditorLock | null,
  jobs?: JobEntry[],
  jobsImportedAt?: string | null
): SharedBoardFile {
  return {
    format: SHARED_FILE_FORMAT,
    version: 1,
    revision,
    exportedAt: new Date().toISOString(),
    bookings,
    markup,
    editorLock: editorLock ?? null,
    // The jobs list is only written when it is non-empty, so clearing
    // it removes it from the file instead of leaving an empty list.
    ...(jobs && jobs.length ? { jobs, jobsImportedAt: jobsImportedAt ?? undefined } : {})
  };
}

// The board file is gzipped JSON, not pretty text: the history is gone
// but a 1,500-booking board is still ~500KB of JSON, and gzip takes it
// to ~150KB. The bytes are self-describing — gzip starts with 0x1f
// 0x8b — so parseSharedFile still reads an old plain .json file too.
const GZIP_MAGIC = [0x1f, 0x8b];
const isGzip = (bytes: Uint8Array): boolean =>
  bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
async function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function parseSharedFile(text: string): SharedBoardFile;
export function parseSharedFile(data: ArrayBuffer | Uint8Array): Promise<SharedBoardFile>;
export function parseSharedFile(data: string | ArrayBuffer | Uint8Array): SharedBoardFile | Promise<SharedBoardFile> {
  // A plain string is an old uncompressed board file, read as text.
  // Bytes are the current format: gzip when they start with the gzip
  // magic, otherwise plain JSON (an old .json read as bytes).
  if (typeof data === 'string') return parseBoardText(data);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isGzip(bytes)) return parseBoardText(new TextDecoder().decode(bytes));
  return gunzipBytes(bytes).then(b => parseBoardText(new TextDecoder().decode(b)));
}
function parseBoardText(text: string): SharedBoardFile {
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
  // An old board file still carries its import history; it is dropped
  // on load, not carried into the new file (createSharedFile never
  // writes it), so the history leaves the board for good.
  const { history: _droppedHistory, ...rest } = parsed as SharedBoardFile & { history?: unknown };
  // The jobs list, if the file carries one: keep only rows that look
  // like a job (an Order Id, a Description and two dates), so a
  // hand-edited file cannot smuggle a malformed entry into the
  // inspector. An old file has no jobs field at all.
  const jobs = Array.isArray(parsed.jobs)
    ? (parsed.jobs as JobEntry[]).filter(j => j && typeof j.orderId === 'string' && j.orderId && typeof j.description === 'string' && typeof j.startDate === 'string' && typeof j.endDate === 'string')
    : [];
  return {
    ...rest,
    revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
    markup,
    editorLock: parsed.editorLock && typeof parsed.editorLock === 'object' && typeof parsed.editorLock.id === 'string' && typeof parsed.editorLock.at === 'number' ? parsed.editorLock : null,
    ...(jobs.length ? { jobs, jobsImportedAt: typeof parsed.jobsImportedAt === 'string' ? parsed.jobsImportedAt : undefined } : {})
  };
}

function downloadBytes(data: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadSharedFile(file: SharedBoardFile) {
  downloadBytes(await serializeSharedFile(file), `whiteboard-published-rev${file.revision}-${new Date().toISOString().slice(0, 10)}.json.gz`, 'application/gzip');
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
// Delinking a venue forgets its file handles, so a later save cannot
// write to the old venue's files. Deleting a key that was never linked
// is a no-op.
export async function deleteLinkedHandle(key: string): Promise<void> {
  const db = await openLinkedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LINKED_STORE, 'readwrite');
    tx.objectStore(LINKED_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}
export async function pickLinkedFile(options: { types?: { description: string; accept: Record<string, string[]> }[]; multiple?: boolean } = {}): Promise<LinkedFileHandle | null> {
  const w = window as unknown as { showOpenFilePicker: (o: unknown) => Promise<LinkedFileHandle[]> };
  // No types means no filter: the picker shows every file. The bookings
  // export can be any file type, so its pickers pass no types at all.
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
async function writeLinkedBytes(handle: LinkedFileHandle, bytes: Uint8Array, mime = 'application/gzip'): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(new Blob([bytes as BlobPart], { type: mime }));
  await writable.close();
}
export async function readLinkedFile(handle: LinkedFileHandle): Promise<ArrayBuffer> {
  return await (await handle.getFile()).arrayBuffer();
}
// The board file as gzipped bytes: compact JSON (no pretty-printing,
// it is not meant to be read by hand) through gzip.
export async function serializeSharedFile(file: SharedBoardFile): Promise<Uint8Array> {
  return gzipBytes(new TextEncoder().encode(JSON.stringify(file)));
}
export async function writeSharedFileToHandle(handle: LinkedFileHandle, file: SharedBoardFile): Promise<void> {
  await writeLinkedBytes(handle, await serializeSharedFile(file));
}
export async function readSharedFileFromHandle(handle: LinkedFileHandle): Promise<SharedBoardFile> {
  return parseSharedFile(await readLinkedFile(handle));
}
