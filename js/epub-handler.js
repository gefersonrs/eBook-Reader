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
  /**
   * Load a file (EPUB, PDF, AZW3, or MOBI) and return a book record.
   */
  async function processFile(file, onProgress) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext === 'pdf') {
      return processPdfFile(file, onProgress);
    } else if (ext === 'azw3' || ext === 'mobi') {
      return processMobiFile(file, onProgress, ext);
    } else {
      return processEpubFile(file, onProgress);
    }
  }

  /** Read PDF and render first page thumbnail cover */
  async function processPdfFile(file, onProgress) {
    onProgress(10);
    const buffer = await readFileAsArrayBuffer(file);
    onProgress(35);

    // Initialize pdfjs-dist with cross-origin worker bypass
    try {
      const workerCode = `importScripts("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js");`;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (_) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    onProgress(60);

    // Extract metadata
    const meta = await pdf.getMetadata().catch(() => ({ info: {} }));
    const title = meta.info?.Title || file.name.replace(/\.pdf$/i, '');
    const author = meta.info?.Author || 'Unknown Author';
    onProgress(75);

    // Render cover from first page
    let coverBase64 = null;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.4 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({ canvasContext: context, viewport }).promise;
      coverBase64 = canvas.toDataURL('image/jpeg', 0.85);
    } catch (err) {
      console.error("Failed to generate PDF cover:", err);
    }
    onProgress(90);

    // Extract outline as TOC
    let toc = [];
    try {
      const outline = await pdf.getOutline();
      if (outline) {
        toc = outline.map(item => ({
          label: item.title || 'Section',
          href: String(item.dest || '1'),
          depth: 1
        }));
      }
    } catch (_) {}
    onProgress(98);

    const id = generateId(file.name, file.size);
    onProgress(100);

    return {
      id,
      title,
      author,
      coverBase64,
      toc,
      fileName: file.name,
      fileSize: file.size,
      data: buffer,
      format: 'pdf',
      locations: null,
      progress: 0,
      currentCfi: '1', // page number
      chapterTitle: '',
      dateAdded: Date.now(),
      lastRead: null
    };
  }

  /** Read AZW3 or MOBI Kindle file */
  async function processMobiFile(file, onProgress, format) {
    onProgress(10);
    const buffer = await readFileAsArrayBuffer(file);
    onProgress(35);

    // Load mobi-parser module
    const mobiParser = await import('https://cdn.jsdelivr.net/npm/@lingo-reader/mobi-parser/+esm');
    onProgress(60);

    let doc = null;
    try {
      if (format === 'azw3') {
        doc = await mobiParser.initKf8File(file);
      } else {
        doc = await mobiParser.initMobiFile(file);
      }
    } catch (err) {
      console.error("Failed to parse Mobi/KF8 database:", err);
      throw new Error("Unable to open Kindle format file. It might be DRM encrypted.");
    }
    onProgress(80);

    const meta = doc.getMetadata();
    const title = meta.title || file.name.replace(/\.(azw3|mobi)$/i, '');
    const author = meta.creator || 'Unknown Author';
    onProgress(90);

    // Extract cover image if available
    let coverBase64 = null;
    try {
      const coverResource = await doc.getCoverImage?.();
      if (coverResource) {
        const blob = new Blob([coverResource], { type: 'image/jpeg' });
        coverBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    } catch (_) {}

    const spine = doc.getSpine() || [];
    const toc = spine.map((item, idx) => ({
      label: item.title || `Chapter ${idx + 1}`,
      href: String(item.id),
      depth: 1
    }));
    onProgress(98);

    const id = generateId(file.name, file.size);
    onProgress(100);

    return {
      id,
      title,
      author,
      coverBase64,
      toc,
      fileName: file.name,
      fileSize: file.size,
      data: buffer,
      format,
      locations: null,
      progress: 0,
      currentCfi: spine[0] ? String(spine[0].id) : '0',
      chapterTitle: toc[0]?.label || '',
      dateAdded: Date.now(),
      lastRead: null
    };
  }

  /** Original EPUB processor */
  async function processEpubFile(file, onProgress) {
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

    onProgress(90);

    // Generate locations
    let locations = null;
    try {
      let step = 1000;
      const sizeMb = file.size / (1024 * 1024);
      if (sizeMb > 5) step = 4000;
      else if (sizeMb > 2) step = 2000;
      else if (sizeMb > 1) step = 1500;

      await epub.locations.generate(step);
      locations = epub.locations.export();
    } catch (err) {
      console.error("Failed to generate locations during import:", err);
    }

    onProgress(98);

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
      locations,
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
