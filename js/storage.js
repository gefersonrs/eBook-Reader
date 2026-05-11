/**
 * storage.js
 * Handles all persistence using IndexedDB (books) + localStorage (settings).
 */

const Storage = (() => {
  const DB_NAME    = 'FolioReader';
  const DB_VERSION = 1;
  const STORE      = 'books';
  let db = null;

  /** Open / upgrade IndexedDB */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(STORE)) {
          const store = idb.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('dateAdded', 'dateAdded', { unique: false });
          store.createIndex('title',    'title',    { unique: false });
          store.createIndex('author',   'author',   { unique: false });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  /** Save a complete book record (including ArrayBuffer data) */
  async function saveBook(book) {
    const idb   = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(book);
      tx.oncomplete = () => resolve(book);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  /** Get all books (without heavy arrayBuffer to keep it fast) */
  async function getAllBooks() {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
      const tx      = idb.transaction(STORE, 'readonly');
      const req     = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  }

  /** Get a single book by id (with full data) */
  async function getBook(id) {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
      const tx      = idb.transaction(STORE, 'readonly');
      const req     = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  /** Delete a book by id */
  async function deleteBook(id) {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
      const tx      = idb.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  /** Update reading progress for a book */
  async function updateProgress(id, cfi, progress, chapterTitle) {
    const book = await getBook(id);
    if (!book) return;
    book.currentCfi    = cfi;
    book.progress      = Math.min(100, Math.max(0, Math.round(progress)));
    book.chapterTitle  = chapterTitle || book.chapterTitle;
    book.lastRead      = Date.now();
    return saveBook(book);
  }

  /** Bookmarks: stored per-book in localStorage for speed */
  function getBookmarks(bookId) {
    const raw = localStorage.getItem(`folio-bm-${bookId}`);
    return raw ? JSON.parse(raw) : [];
  }

  function saveBookmarks(bookId, bookmarks) {
    localStorage.setItem(`folio-bm-${bookId}`, JSON.stringify(bookmarks));
  }

  function addBookmark(bookId, cfi, label) {
    const bm = getBookmarks(bookId);
    if (bm.find(b => b.cfi === cfi)) return; // already exists
    bm.unshift({ cfi, label, date: Date.now() });
    saveBookmarks(bookId, bm);
    return bm;
  }

  function removeBookmark(bookId, cfi) {
    const bm = getBookmarks(bookId).filter(b => b.cfi !== cfi);
    saveBookmarks(bookId, bm);
    return bm;
  }

  /** Reader settings: stored in localStorage */
  function getSettings() {
    const defaults = {
      theme:      'dark',
      font:       'Lora',
      fontSize:   100,
      lineHeight: 1.6,
      margin:     60,
    };
    const raw = localStorage.getItem('folio-settings');
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  }

  function saveSettings(settings) {
    localStorage.setItem('folio-settings', JSON.stringify(settings));
  }

  /** Reading stats */
  function getStats() {
    const raw = localStorage.getItem('folio-stats');
    return raw ? JSON.parse(raw) : { totalBooks: 0, totalMinutes: 0, sessions: [] };
  }

  function recordSession(bookId, minutes) {
    const stats = getStats();
    stats.sessions.push({ bookId, minutes, date: Date.now() });
    stats.totalMinutes = (stats.totalMinutes || 0) + minutes;
    localStorage.setItem('folio-stats', JSON.stringify(stats));
  }

  return {
    openDB, saveBook, getAllBooks, getBook, deleteBook, updateProgress,
    getBookmarks, addBookmark, removeBookmark, getSettings, saveSettings,
    recordSession, getStats,
  };
})();
