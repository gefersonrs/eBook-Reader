/**
 * epub-handler.js
 * Handles loading EPUB files, extracting metadata, cover image, and TOC.
 */

const EpubHandler = (() => {

  /**
   * Load an EPUB from a File object, extract metadata, and return a book record.
   * @param {File} file
   * @param {Function} onProgress  callback(0-100)
   * @returns {Promise<Object>} book record ready to be saved
   */
  async function processFile(file, onProgress) {
    onProgress(10);

    // Read file as ArrayBuffer
    const buffer = await readFileAsArrayBuffer(file);
    onProgress(30);

    // Open with epub.js (in memory, no rendering)
    const epub = ePub(buffer.slice(0));
    await epub.ready;
    onProgress(50);

    // Extract metadata
    const meta   = await epub.loaded.metadata;
    const title  = meta.title  || file.name.replace(/\.epub$/i, '');
    const author = meta.creator || 'Unknown Author';
    onProgress(65);

    // Extract cover
    let coverUrl = null;
    try {
      coverUrl = await epub.coverUrl();
    } catch (_) { /* no cover */ }

    // Convert cover URL to base64 for storage
    let coverBase64 = null;
    if (coverUrl) {
      try {
        coverBase64 = await urlToBase64(coverUrl);
      } catch (_) { /* skip */ }
    }
    onProgress(80);

    // Extract TOC
    let toc = [];
    try {
      const nav = await epub.loaded.navigation;
      toc = flattenToc(nav.toc || []);
    } catch (_) { /* skip */ }

    onProgress(95);

    // Destroy this ephemeral instance
    epub.destroy();

    const id = generateId(file.name, file.size);

    onProgress(100);

    return {
      id,
      title,
      author,
      coverBase64,
      toc,
      fileName:    file.name,
      fileSize:    file.size,
      data:        buffer,          // raw ArrayBuffer stored in IndexedDB
      progress:    0,
      currentCfi:  null,
      chapterTitle: toc[0]?.label || '',
      dateAdded:   Date.now(),
      lastRead:    null,
    };
  }

  /** Flatten nested TOC into a simple list with depth info */
  function flattenToc(items, depth = 1) {
    const result = [];
    for (const item of items) {
      result.push({ label: item.label.trim(), href: item.href, depth });
      if (item.subitems && item.subitems.length) {
        result.push(...flattenToc(item.subitems, depth + 1));
      }
    }
    return result;
  }

  /** Read file as ArrayBuffer */
  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = e => reject(e);
      reader.readAsArrayBuffer(file);
    });
  }

  /** Convert a URL (blob or http) to base64 data URL */
  async function urlToBase64(url) {
    const resp   = await fetch(url);
    const blob   = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /** Generate a stable ID from filename + size */
  function generateId(name, size) {
    let hash = 0;
    const str = name + size;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'book_' + Math.abs(hash).toString(36) + '_' + size.toString(36);
  }

  /**
   * Open an epub.js book instance from stored ArrayBuffer.
   * @param {ArrayBuffer} buffer
   * @returns {ePub}
   */
  function openBook(buffer) {
    return ePub(buffer.slice(0));
  }

  return { processFile, openBook, flattenToc };
})();
