/**
 * reader.js
 * Reader interface: epub.js rendering, layout modes, themes, TOC, bookmarks, progress.
 */

const Reader = (() => {
  let book         = null;
  let rendition    = null;
  let bookRecord   = null;
  let settings     = {};
  let sessionStart = null;
  let currentCfi   = null;
  let tocOpen      = false;
  let panelOpen    = false;

  const readerView    = document.getElementById('reader-view');
  const epubContainer = document.getElementById('epub-container');
  const progressBar   = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const chapterLabel  = document.getElementById('chapter-label');
  const locationLabel = document.getElementById('location-label');
  const readerTitle   = document.getElementById('reader-title');
  const readerAuthor  = document.getElementById('reader-author');
  const tocSidebar    = document.getElementById('toc-sidebar');
  const tocList       = document.getElementById('toc-list');
  const settingsPanel = document.getElementById('settings-panel');
  const bookmarksPanel= document.getElementById('bookmarks-panel');

  let searchOpen   = false;
  let searchAbortController = null;
  let currentHighlight = null;

  let pdfDoc       = null;
  let currentPdfPage = 1;
  let mobiDoc      = null;
  let currentMobiChapterId = null;

  const searchSidebar = document.getElementById('search-sidebar');
  const searchInput   = document.getElementById('reader-search-input');
  const searchClear   = document.getElementById('reader-search-clear');
  const searchList    = document.getElementById('search-results-list');
  const searchMsg     = document.getElementById('search-placeholder-msg');

  /* ── Open ── */
  async function open(bookId) {
    bookRecord = await Storage.getBook(bookId);
    if (!bookRecord) { App.toast('Book not found', 'error'); return; }

    settings     = Storage.getSettings();
    sessionStart = Date.now();

    readerView.classList.remove('hidden');
    document.getElementById('library-view').classList.add('hidden');

    readerTitle.textContent  = bookRecord.title;
    readerAuthor.textContent = bookRecord.author;

    App.applyTheme(settings.theme);

    cleanupRenderers();

    const fmt = bookRecord.format;

    if (fmt === 'pdf') {
      await initPdfReader();
    } else if (fmt === 'azw3' || fmt === 'mobi') {
      await initMobiReader();
    } else {
      // EPUB
      book = EpubHandler.openBook(bookRecord.data);
      await book.ready;
      await createRendition();

      if (bookRecord.locations) {
        try {
          book.locations.load(bookRecord.locations);
        } catch (err) {
          console.error("Failed to load saved locations:", err);
        }
      }
    }

    buildToc();
    bindReaderEvents();
    updateProgressUI();
  }

  function cleanupRenderers() {
    if (rendition) { try { rendition.destroy(); } catch(_) {} rendition = null; }
    if (book) { try { book.destroy(); } catch(_) {} book = null; }
    pdfDoc = null;
    mobiDoc = null;
    epubContainer.innerHTML = '';
    epubContainer.style.overflowY = '';
  }

  /** Create (or recreate) the rendition with the current layout setting */
  async function createRendition(preserveCfi) {
    const cfi = preserveCfi || (rendition ? currentCfi : bookRecord.currentCfi);

    if (rendition) { try { rendition.destroy(); } catch(_) {} rendition = null; }
    epubContainer.innerHTML = '';

    const layout = settings.layout || 'single';
    let renderOpts;

    if (layout === 'double') {
      renderOpts = { width: '100%', height: '100%', flow: 'paginated', spread: 'always', minSpreadWidth: 0 };
    } else if (layout === 'scroll') {
      renderOpts = { width: '100%', flow: 'scrolled-continuous' };
      epubContainer.style.overflowY = 'auto';
    } else {
      epubContainer.style.overflowY = '';
      renderOpts = { width: '100%', height: '100%', flow: 'paginated', spread: 'none' };
    }

    rendition = book.renderTo(epubContainer, renderOpts);
    applyRenditionTheme();

    if (cfi) {
      await rendition.display(cfi).catch(() => rendition.display());
    } else {
      await rendition.display();
    }

    // Re-bind epub events after recreation
    rendition.on('relocated', () => updateProgressUI());
    rendition.on('rendered',  () => injectIframeKeyHandler());
  }

  /* ── Close ── */
  function close() {
    if (sessionStart) {
      const mins = Math.round((Date.now() - sessionStart) / 60000);
      if (mins > 0) Storage.recordSession(bookRecord.id, mins);
      sessionStart = null;
    }
    cleanupRenderers();

    closePanels();
    readerView.classList.add('hidden');
    document.getElementById('library-view').classList.remove('hidden');

    // Restore library theme
    App.applyTheme(settings.theme);
    Library.render();
  }

  /* ── TOC ── */
  function buildToc() {
    tocList.innerHTML = '';
    const toc = bookRecord.toc || [];
    if (!toc.length) { tocList.innerHTML = '<p class="text-xs p-3" style="color:var(--text-faint)">No table of contents</p>'; return; }
    
    toc.forEach(item => {
      const btn = document.createElement('button');
      btn.className = `toc-item level-${item.depth || 1}`;
      btn.textContent = item.label;
      btn.dataset.href = item.href;
      btn.addEventListener('click', () => {
        const fmt = bookRecord.format;
        if (fmt === 'pdf') {
          const pageNum = parseInt(item.href, 10);
          if (!isNaN(pageNum)) renderPdfPage(pageNum);
        } else if (fmt === 'azw3' || fmt === 'mobi') {
          renderMobiChapter(item.href);
        } else {
          rendition?.display(item.href).catch(() => {});
        }
        if (window.innerWidth < 640) toggleToc(false);
      });
      tocList.appendChild(btn);
    });
  }

  function highlightTocItem(href) {
    document.querySelectorAll('.toc-item').forEach(btn => {
      btn.classList.toggle('active', href && btn.dataset.href && btn.dataset.href.includes(href.split('#')[0]));
    });
  }

  /* ── Settings / Theme ── */
  function applyRenditionTheme() {
    if (!rendition) return;
    const s = settings;
    const ts = getThemeStyles(s.theme);

    rendition.themes.default({
      'html': { background: `${ts.bg} !important` },
      'body': {
        background:      `${ts.bg} !important`,
        color:           `${ts.text} !important`,
        'font-family':   `"${s.font || 'Lora'}", Georgia, serif !important`,
        'font-size':     `${s.fontSize || 100}% !important`,
        'line-height':   `${s.lineHeight || 1.6} !important`,
        'padding-left':  `${(100-(s.margin||60))/2}% !important`,
        'padding-right': `${(100-(s.margin||60))/2}% !important`,
        'max-width':     '100% !important',
      },
      'a':   { color: `${ts.link} !important` },
      'p, div, span, li, h1, h2, h3, h4, h5, h6': { color: `${ts.text} !important` },
      '.search-highlight-class': {
        'background-color': 'rgba(245, 166, 35, 0.45) !important',
        'border-radius': '2px',
        'box-shadow': '0 0 4px rgba(245, 166, 35, 0.25)',
      }
    });
    rendition.themes.select('default');
  }

  function getThemeStyles(theme) {
    const map = {
      dark:  { bg: '#111111', text: '#e0dcd4', link: '#f5a623' },
      dim:   { bg: '#13151e', text: '#c8cce8', link: '#7c8cff' },
      paper: { bg: '#fefcf8', text: '#2d2416', link: '#c17f3a' },
      sepia: { bg: '#f4ede4', text: '#3d2b1f', link: '#9e5c1e' },
      light: { bg: '#ffffff', text: '#1a1a1a', link: '#2563eb' },
    };
    return map[theme] || map.dark;
  }

  function updateSettings(patch) {
    const wasLayout = settings.layout;
    settings = { ...settings, ...patch };
    Storage.saveSettings(settings);

    if (patch.theme) App.applyTheme(patch.theme);

    const fmt = bookRecord.format;
    if (fmt === 'pdf') {
      if (!patch.theme) {
        renderPdfPage(currentPdfPage);
      }
    } else if (fmt === 'azw3' || fmt === 'mobi') {
      if (currentMobiChapterId) {
        renderMobiChapter(currentMobiChapterId);
      }
    } else {
      // EPUB
      if (patch.layout && patch.layout !== wasLayout) {
        createRendition(currentCfi).then(() => {
          buildToc();
          updateProgressUI();
        });
      } else {
        applyRenditionTheme();
      }
    }
    refreshSettingsUI();
  }

  function refreshSettingsUI() {
    document.querySelectorAll('.theme-btn').forEach(b  => b.classList.toggle('active', b.dataset.theme  === settings.theme));
    document.querySelectorAll('.font-btn').forEach(b   => b.classList.toggle('active', b.dataset.font   === settings.font));
    document.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === (settings.layout || 'single')));
    const fsr = document.getElementById('font-size-range');
    const lhr = document.getElementById('line-height-range');
    const mr  = document.getElementById('margin-range');
    fsr.value = settings.fontSize   || 100;  document.getElementById('font-size-label').textContent  = (settings.fontSize || 100) + '%';
    lhr.value = settings.lineHeight || 1.6;  document.getElementById('line-height-label').textContent = settings.lineHeight || 1.6;
    mr.value  = settings.margin     || 60;   document.getElementById('margin-label').textContent      = (settings.margin || 60) + '%';
  }

  /* ── Progress ── */
  async function updateProgressUI() {
    if (!bookRecord) return;
    const fmt = bookRecord.format;
    
    if (fmt === 'pdf') {
      if (pdfDoc) {
        const pageNum = parseInt(bookRecord.currentCfi || '1', 10);
        currentPdfPage = pageNum;
        progressBar.style.width = Math.round((pageNum / pdfDoc.numPages) * 100) + '%';
        progressLabel.textContent = `${pageNum} / ${pdfDoc.numPages}`;
        locationLabel.textContent = '';
        chapterLabel.textContent = '';
      }
      return;
    }
    
    if (fmt === 'azw3' || fmt === 'mobi') {
      if (mobiDoc) {
        const chapId = bookRecord.currentCfi || (mobiDoc.getSpine()[0]?.id);
        currentMobiChapterId = chapId;
        const spine = mobiDoc.getSpine() || [];
        const idx = spine.findIndex(item => String(item.id) === String(chapId));
        const total = spine.length || 1;
        const pct = Math.round((Math.max(0, idx) / total) * 100);
        progressBar.style.width = pct + '%';
        progressLabel.textContent = `Chapter ${Math.max(0, idx) + 1} / ${total}`;
        locationLabel.textContent = '';
        const chap = spine[idx];
        chapterLabel.textContent = chap ? (chap.title || `Chapter ${idx + 1}`) : '';
      }
      return;
    }

    if (!book || !rendition) return;
    try {
      const loc = rendition.currentLocation();
      if (!loc || !loc.start) return;
      currentCfi = loc.start.cfi;

      const locationsLoaded = book.locations && book.locations.length > 0;
      let displayPct;

      if (locationsLoaded) {
        const pct = book.locations.percentageFromCfi(currentCfi);
        if (typeof pct === 'number' && !isNaN(pct) && pct >= 0) {
          displayPct = Math.round(pct * 100);
        }
      }

      // If locations are not loaded or the percentage calculation failed, use fallback
      if (displayPct === undefined || isNaN(displayPct)) {
        const spineIndex = loc.start.index;
        const totalSpines = book.spine.length || 1;
        const innerPage = loc.start.displayed.page || 1;
        const innerTotal = loc.start.displayed.total || 1;
        const progressInSpine = innerTotal > 0 ? (innerPage - 1) / innerTotal : 0;
        displayPct = Math.round(((spineIndex + progressInSpine) / totalSpines) * 100);
      }

      displayPct = Math.max(0, Math.min(100, displayPct));

      progressBar.style.width     = displayPct + '%';
      
      let totalPages;
      let currentPage;

      if (locationsLoaded) {
        totalPages = book.locations.length;
        currentPage = Math.max(1, book.locations.locationFromCfi(currentCfi) + 1);
      } else {
        totalPages = Math.max(1, book.spine.length * 15);
        currentPage = Math.max(1, Math.round((displayPct / 100) * totalPages));
      }
      progressLabel.textContent = `${currentPage} / ${totalPages}`;

      const toc     = bookRecord.toc || [];
      const spineHref = loc.start.href;
      const chapter = toc.find(t => spineHref && t.href && spineHref.includes(t.href.split('#')[0]));
      chapterLabel.textContent  = chapter ? chapter.label : '';
      locationLabel.textContent = `Page ${loc.start.displayed.page} of ${loc.start.displayed.total} (Chapter)`;
      if (chapter) highlightTocItem(chapter.href);

      await Storage.updateProgress(bookRecord.id, currentCfi, displayPct, chapter?.label);
      bookRecord.progress   = displayPct;
      bookRecord.currentCfi = currentCfi;
    } catch (_) {}
  }

  /* ── Navigation ── */
  function nextPage() {
    const fmt = bookRecord.format;
    if (fmt === 'pdf') {
      if (pdfDoc && currentPdfPage < pdfDoc.numPages) {
        renderPdfPage(currentPdfPage + 1);
      }
    } else if (fmt === 'azw3' || fmt === 'mobi') {
      if (mobiDoc) {
        const spine = mobiDoc.getSpine() || [];
        const idx = spine.findIndex(item => String(item.id) === String(currentMobiChapterId));
        if (idx !== -1 && idx < spine.length - 1) {
          renderMobiChapter(spine[idx + 1].id);
        }
      }
    } else {
      rendition?.next();
    }
  }

  function prevPage() {
    const fmt = bookRecord.format;
    if (fmt === 'pdf') {
      if (pdfDoc && currentPdfPage > 1) {
        renderPdfPage(currentPdfPage - 1);
      }
    } else if (fmt === 'azw3' || fmt === 'mobi') {
      if (mobiDoc) {
        const spine = mobiDoc.getSpine() || [];
        const idx = spine.findIndex(item => String(item.id) === String(currentMobiChapterId));
        if (idx > 0) {
          renderMobiChapter(spine[idx - 1].id);
        }
      }
    } else {
      rendition?.prev();
    }
  }

  /* ── Bookmarks ── */
  function toggleBookmark() {
    if (!currentCfi || !bookRecord) return;
    const bookmarks = Storage.getBookmarks(bookRecord.id);
    const exists    = bookmarks.find(b => b.cfi === currentCfi);
    const bmPath    = document.getElementById('bookmark-btn').querySelector('path');

    if (exists) {
      Storage.removeBookmark(bookRecord.id, currentCfi);
      App.toast('Bookmark removed');
      bmPath.setAttribute('fill', 'none');
    } else {
      Storage.addBookmark(bookRecord.id, currentCfi, chapterLabel.textContent || 'Bookmark');
      App.toast('Bookmarked!');
      bmPath.setAttribute('fill', 'currentColor');
    }
    if (panelOpen === 'bookmarks') renderBookmarks();
  }

  function renderBookmarks() {
    const list = document.getElementById('bookmarks-list');
    const none = document.getElementById('no-bookmarks');
    const bms  = bookRecord ? Storage.getBookmarks(bookRecord.id) : [];
    list.innerHTML = '';
    if (!bms.length) { none.classList.remove('hidden'); return; }
    none.classList.add('hidden');
    bms.forEach(bm => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.innerHTML = `
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium truncate">${escHtml(bm.label)}</p>
          <p class="text-xs" style="color:var(--text-faint)">${new Date(bm.date).toLocaleDateString()}</p>
        </div>
        <button class="p-1 rounded" style="color:var(--text-faint)" title="Remove">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>`;
      item.querySelector('button').addEventListener('click', e => {
        e.stopPropagation(); Storage.removeBookmark(bookRecord.id, bm.cfi); renderBookmarks();
      });
      item.addEventListener('click', () => { rendition.display(bm.cfi); closePanels(); });
      list.appendChild(item);
    });
  }

  /* ── Panel Toggles ── */
  function toggleToc(force) {
    tocOpen = typeof force === 'boolean' ? force : !tocOpen;
    tocSidebar.classList.toggle('hidden', !tocOpen);
    if (tocOpen) {
      toggleSearchSidebar(false);
      closeSettingsAndBookmarks();
    }
  }

  function toggleSearchSidebar(force) {
    searchOpen = typeof force === 'boolean' ? force : !searchOpen;
    searchSidebar.classList.toggle('hidden', !searchOpen);
    document.getElementById('search-toggle-btn').classList.toggle('active', searchOpen);
    if (searchOpen) {
      toggleToc(false);
      closeSettingsAndBookmarks();
      searchInput.focus();
    } else {
      if (searchAbortController) {
        searchAbortController.abort();
        searchAbortController = null;
      }
    }
  }

  function closeSettingsAndBookmarks() {
    panelOpen = false;
    settingsPanel.classList.add('hidden');
    bookmarksPanel.classList.add('hidden');
  }

  function toggleSettingsPanel() {
    if (panelOpen === 'settings') { closePanels(); return; }
    panelOpen = 'settings';
    settingsPanel.classList.remove('hidden');
    bookmarksPanel.classList.add('hidden');
    toggleToc(false);
    toggleSearchSidebar(false);
    refreshSettingsUI();
  }

  function toggleBookmarksPanel() {
    if (panelOpen === 'bookmarks') { closePanels(); return; }
    panelOpen = 'bookmarks';
    bookmarksPanel.classList.remove('hidden');
    settingsPanel.classList.add('hidden');
    toggleToc(false);
    toggleSearchSidebar(false);
    renderBookmarks();
  }

  function closePanels() {
    panelOpen = false; tocOpen = false; searchOpen = false;
    tocSidebar.classList.add('hidden');
    searchSidebar.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    bookmarksPanel.classList.add('hidden');
    document.getElementById('search-toggle-btn').classList.remove('active');
    if (currentHighlight && rendition) {
      try { rendition.annotations.remove(currentHighlight, "highlight"); } catch(_) {}
      currentHighlight = null;
    }
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
  }

  /* ── Events ── */
  function bindReaderEvents() {
    document.getElementById('prev-btn').onclick = prevPage;
    document.getElementById('next-btn').onclick = nextPage;
    document.getElementById('back-to-library').onclick = close;
    document.getElementById('toc-toggle-btn').onclick = () => toggleToc();
    document.getElementById('search-toggle-btn').onclick = () => toggleSearchSidebar();
    document.getElementById('bookmark-btn').onclick = toggleBookmark;
    document.getElementById('fullscreen-btn').onclick = toggleFullscreen;
    document.getElementById('settings-btn').onclick = toggleSettingsPanel;

    document.removeEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleOutsideClick, true);

    // Theme, Font, Layout buttons
    document.querySelectorAll('.theme-btn').forEach(btn  => btn.addEventListener('click', () => updateSettings({ theme:  btn.dataset.theme })));
    document.querySelectorAll('.font-btn').forEach(btn   => btn.addEventListener('click', () => updateSettings({ font:   btn.dataset.font })));
    document.querySelectorAll('.layout-btn').forEach(btn => btn.addEventListener('click', () => updateSettings({ layout: btn.dataset.layout })));

    // Sliders
    document.getElementById('font-size-range').addEventListener('input', e => {
      document.getElementById('font-size-label').textContent = e.target.value + '%';
      updateSettings({ fontSize: Number(e.target.value) });
    });
    document.getElementById('line-height-range').addEventListener('input', e => {
      document.getElementById('line-height-label').textContent = e.target.value;
      updateSettings({ lineHeight: Number(e.target.value) });
    });
    document.getElementById('margin-range').addEventListener('input', e => {
      document.getElementById('margin-label').textContent = e.target.value + '%';
      updateSettings({ margin: Number(e.target.value) });
    });

    // Search Input Listeners (debounced for maximum responsiveness)
    let searchTimeout = null;
    searchInput.addEventListener('input', e => {
      const q = e.target.value.trim();
      searchClear.classList.toggle('hidden', !q);
      
      if (searchTimeout) clearTimeout(searchTimeout);
      if (!q) {
        clearSearchResults();
        return;
      }
      
      searchTimeout = setTimeout(() => {
        performSearch(q);
      }, 300);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.classList.add('hidden');
      clearSearchResults();
      searchInput.focus();
    });

    generateLocations();
  }

  /* ── Search Book Engine ── */
  function clearSearchResults() {
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
    searchList.innerHTML = '';
    searchMsg.textContent = 'Enter a keyword to search this book.';
    searchMsg.classList.remove('hidden');
    if (currentHighlight && rendition) {
      try { rendition.annotations.remove(currentHighlight, "highlight"); } catch(_) {}
      currentHighlight = null;
    }
  }

  async function performSearch(query) {
    if (searchAbortController) searchAbortController.abort();
    const currentController = new AbortController();
    searchAbortController = currentController;

    searchList.innerHTML = '';
    searchMsg.textContent = 'Searching...';
    searchMsg.classList.remove('hidden');

    if (currentHighlight && rendition) {
      try { rendition.annotations.remove(currentHighlight, "highlight"); } catch(_) {}
      currentHighlight = null;
    }

    const fmt = bookRecord.format;
    if (fmt === 'pdf') {
      searchPdfDoc(query, currentController);
      return;
    }
    if (fmt === 'azw3' || fmt === 'mobi') {
      searchMobiDoc(query, currentController);
      return;
    }

    const results = [];
    const spine = book.spine;
    const items = spine.spineItems || [];

    try {
      for (let i = 0; i < items.length; i++) {
        if (currentController.signal.aborted) return;

        const item = items[i];
        await item.load(book.load.bind(book));
        
        const matches = item.find(query);
        item.unload();

        if (matches && matches.length) {
          const chapter = bookRecord.toc?.find(t => t.href && item.href && item.href.includes(t.href.split('#')[0]));
          const chapterLabel = chapter ? chapter.label : `Section ${i + 1}`;

          matches.forEach(match => {
            results.push({
              cfi: match.cfi,
              excerpt: match.excerpt,
              chapterLabel
            });
          });

          // Render results batch live
          renderSearchResultsBatch(results, query);
        }
      }

      if (currentController.signal.aborted) return;

      if (results.length === 0) {
        searchMsg.textContent = `No results found for "${query}"`;
        searchMsg.classList.remove('hidden');
      } else {
        searchMsg.classList.add('hidden');
      }
    } catch (err) {
      if (currentController.signal.aborted) return;
      console.error("Search failed:", err);
      searchMsg.textContent = 'Search failed.';
      searchMsg.classList.remove('hidden');
    }
  }

  async function searchPdfDoc(query, controller) {
    if (!pdfDoc) return;
    const results = [];
    
    try {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (controller.signal.aborted) return;
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map(item => item.str).join(' ');
        
        let idx = textItems.toLowerCase().indexOf(query.toLowerCase());
        while (idx !== -1) {
          if (controller.signal.aborted) return;
          const start = Math.max(0, idx - 40);
          const end = Math.min(textItems.length, idx + query.length + 40);
          const excerpt = '...' + textItems.slice(start, end) + '...';
          
          results.push({
            cfi: String(i),
            excerpt,
            chapterLabel: `Page ${i}`
          });
          
          idx = textItems.toLowerCase().indexOf(query.toLowerCase(), idx + 1);
        }
        
        if (results.length) {
          renderSearchResultsBatch(results, query);
        }
      }
      
      if (controller.signal.aborted) return;
      if (results.length === 0) {
        searchMsg.textContent = `No results found for "${query}"`;
        searchMsg.classList.remove('hidden');
      } else {
        searchMsg.classList.add('hidden');
      }
    } catch (err) {
      console.error("PDF Search failed:", err);
    }
  }

  async function searchMobiDoc(query, controller) {
    if (!mobiDoc) return;
    const results = [];
    const spine = mobiDoc.getSpine() || [];
    
    try {
      for (let i = 0; i < spine.length; i++) {
        if (controller.signal.aborted) return;
        const item = spine[i];
        const chapter = await mobiDoc.loadChapter(item.id);
        
        // Strip HTML tag helper
        const tmp = document.createElement('div');
        tmp.innerHTML = chapter.html;
        const text = tmp.textContent || tmp.innerText || "";
        
        let idx = text.toLowerCase().indexOf(query.toLowerCase());
        while (idx !== -1) {
          if (controller.signal.aborted) return;
          const start = Math.max(0, idx - 40);
          const end = Math.min(text.length, idx + query.length + 40);
          const excerpt = '...' + text.slice(start, end) + '...';
          
          results.push({
            cfi: String(item.id),
            excerpt,
            chapterLabel: item.title || `Chapter ${i + 1}`
          });
          
          idx = text.toLowerCase().indexOf(query.toLowerCase(), idx + 1);
        }
        
        if (results.length) {
          renderSearchResultsBatch(results, query);
        }
      }
      
      if (controller.signal.aborted) return;
      if (results.length === 0) {
        searchMsg.textContent = `No results found for "${query}"`;
        searchMsg.classList.remove('hidden');
      } else {
        searchMsg.classList.add('hidden');
      }
    } catch (err) {
      console.error("Mobi Search failed:", err);
    }
  }

  function renderSearchResultsBatch(results, query) {
    searchList.innerHTML = '';
    
    results.forEach(res => {
      const btn = document.createElement('button');
      btn.className = 'search-result-item w-full text-left p-2.5 rounded-xl transition-all duration-200 border border-transparent';
      
      const escapedExcerpt = escHtml(res.excerpt);
      const highlighted = highlightKeyword(escapedExcerpt, query);

      btn.innerHTML = `
        <div class="flex justify-between items-center mb-1">
          <span class="text-[10px] font-semibold tracking-wider uppercase text-muted truncate max-w-[200px]">${escHtml(res.chapterLabel)}</span>
        </div>
        <p class="text-xs leading-relaxed text-muted">${highlighted}</p>
      `;

      btn.addEventListener('click', () => {
        const fmt = bookRecord.format;
        if (fmt === 'pdf') {
          renderPdfPage(parseInt(res.cfi, 10));
        } else if (fmt === 'azw3' || fmt === 'mobi') {
          renderMobiChapter(res.cfi);
        } else {
          rendition.display(res.cfi).then(() => {
            if (currentHighlight) {
              try { rendition.annotations.remove(currentHighlight, "highlight"); } catch(_) {}
            }
            rendition.annotations.add("highlight", res.cfi, {}, null, "search-highlight-class", {});
            currentHighlight = res.cfi;
          });
        }

        if (window.innerWidth < 640) {
          toggleSearchSidebar(false);
        }
      });
      searchList.appendChild(btn);
    });
  }

  function highlightKeyword(text, keyword) {
    if (!keyword) return text;
    const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
    return text.replace(regex, `<mark class="bg-accent/30 text-accent font-medium rounded px-0.5">$1</mark>`);
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ── PDF Reader Engine ── */
  async function initPdfReader() {
    cleanupRenderers();
    try {
      const workerCode = `importScripts("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js");`;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (_) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bookRecord.data) });
    pdfDoc = await loadingTask.promise;
    
    const startPage = parseInt(bookRecord.currentCfi || '1', 10);
    await renderPdfPage(startPage);
  }

  async function renderPdfPage(pageNumber) {
    if (!pdfDoc) return;
    currentPdfPage = pageNumber;
    
    epubContainer.innerHTML = '';
    epubContainer.style.overflowY = 'auto';
    
    const page = await pdfDoc.getPage(pageNumber);
    
    // Scale fitting calculation with safety fallbacks
    let containerWidth = epubContainer.clientWidth - 40;
    let containerHeight = epubContainer.clientHeight - 40;
    if (containerWidth <= 0) containerWidth = 800;
    if (containerHeight <= 0) containerHeight = 1000;
    
    const originalViewport = page.getViewport({ scale: 1.0 });
    const scaleX = containerWidth / originalViewport.width;
    const scaleY = containerHeight / originalViewport.height;
    
    const scale = Math.min(scaleX, scaleY, 2.0);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas mx-auto my-4';
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    epubContainer.appendChild(canvas);
    
    await page.render({ canvasContext: context, viewport }).promise;
    
    // Update stats
    const pct = Math.round((pageNumber / pdfDoc.numPages) * 100);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = `${pageNumber} / ${pdfDoc.numPages}`;
    locationLabel.textContent = '';
    chapterLabel.textContent = '';
    
    await Storage.updateProgress(bookRecord.id, String(pageNumber), pct, '');
    bookRecord.progress = pct;
    bookRecord.currentCfi = String(pageNumber);
  }

  /* ── Kindle Reader Engine (AZW3/MOBI) ── */
  async function initMobiReader() {
    cleanupRenderers();
    const mobiParser = await import('https://cdn.jsdelivr.net/npm/@lingo-reader/mobi-parser/+esm');
    
    // Create a virtual File object for complete type safety in the browser
    const fileBlob = new Blob([bookRecord.data], { type: 'application/octet-stream' });
    const file = new File([fileBlob], bookRecord.fileName || 'book.azw3');
    
    const fmt = bookRecord.format;
    if (fmt === 'azw3') {
      mobiDoc = await mobiParser.initKf8File(file);
    } else {
      mobiDoc = await mobiParser.initMobiFile(file);
    }
    
    const spine = mobiDoc.getSpine() || [];
    const startChapterId = bookRecord.currentCfi || (spine[0] ? String(spine[0].id) : '0');
    await renderMobiChapter(startChapterId);
  }

  async function renderMobiChapter(chapterId) {
    if (!mobiDoc) return;
    currentMobiChapterId = chapterId;
    
    epubContainer.innerHTML = '';
    epubContainer.style.overflowY = '';
    
    const chapter = await mobiDoc.loadChapter(chapterId);
    
    const iframe = document.createElement('iframe');
    iframe.className = 'w-full h-full border-none';
    epubContainer.appendChild(iframe);
    
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    const finalHtml = injectMobiStyles(chapter.html, chapter.css);
    iframeDoc.write(finalHtml);
    iframeDoc.close();
    
    iframeDoc.addEventListener('keydown', handleKeyDown);
    
    // Update progress
    const spine = mobiDoc.getSpine() || [];
    const idx = spine.findIndex(item => String(item.id) === String(chapterId));
    const total = spine.length || 1;
    const pct = Math.round((Math.max(0, idx) / total) * 100);
    
    progressBar.style.width = pct + '%';
    progressLabel.textContent = `Chapter ${Math.max(0, idx) + 1} / ${total}`;
    locationLabel.textContent = '';
    
    const currentChapter = spine[idx];
    chapterLabel.textContent = currentChapter ? (currentChapter.title || `Chapter ${idx + 1}`) : '';
    
    await Storage.updateProgress(bookRecord.id, String(chapterId), pct, chapterLabel.textContent);
    bookRecord.progress = pct;
    bookRecord.currentCfi = String(chapterId);
  }

  function injectMobiStyles(html, customCss) {
    const ts = getThemeStyles(settings.theme);
    const styleTag = `
      <style>
        body {
          background-color: ${ts.bg} !important;
          color: ${ts.text} !important;
          font-family: "${settings.font || 'Lora'}", Georgia, serif !important;
          font-size: ${settings.fontSize || 100}% !important;
          line-height: ${settings.lineHeight || 1.6} !important;
          padding: 40px ${(100 - (settings.margin || 60)) / 2}% !important;
          margin: 0 !important;
        }
        img {
          max-width: 100% !important;
          height: auto !important;
          border-radius: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          display: block;
          margin: 20px auto;
        }
        a {
          color: ${ts.link} !important;
          text-decoration: underline;
        }
        p {
          margin-bottom: 1.5em !important;
          text-align: justify;
        }
        ${customCss || ''}
      </style>
    `;
    if (html.includes('<head>')) {
      return html.replace('<head>', `<head>${styleTag}`);
    } else {
      return `<head>${styleTag}</head><body>${html}</body>`;
    }
  }

  function generateLocations() {
    if (bookRecord.locations) return;

    // Determine dynamic character step size depending on book size
    // Larger step size for larger books to generate faster and prevent lags.
    let step = 1000;
    if (bookRecord.fileSize) {
      const sizeMb = bookRecord.fileSize / (1024 * 1024);
      if (sizeMb > 5) step = 4000;
      else if (sizeMb > 2) step = 2000;
      else if (sizeMb > 1) step = 1500;
    }

    book.locations.generate(step)
      .then(() => {
        bookRecord.locations = book.locations.save();
        Storage.saveBook(bookRecord).catch(() => {});
        updateProgressUI();
      })
      .catch(err => {
        console.error("Error generating locations:", err);
      });
  }

  function handleKeyDown(e) {
    if (!readerView.classList.contains('hidden')) {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextPage(); }
      if (e.key === 'ArrowLeft'  || e.key === 'PageUp')                    { e.preventDefault(); prevPage(); }
      if (e.key === 'Escape') closePanels();
    }
  }

  function handleOutsideClick(e) {
    if (!settingsPanel.contains(e.target) && !document.getElementById('settings-btn').contains(e.target))
      settingsPanel.classList.add('hidden');
    if (!bookmarksPanel.contains(e.target) && !document.getElementById('bookmark-btn').contains(e.target))
      bookmarksPanel.classList.add('hidden');
  }

  function injectIframeKeyHandler() {
    try {
      const iframe = epubContainer.querySelector('iframe');
      if (iframe?.contentDocument) iframe.contentDocument.addEventListener('keydown', handleKeyDown);
    } catch (_) {}
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) readerView.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { open, close };
})();
