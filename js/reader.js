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

    if (book) { try { book.destroy(); } catch(_) {} }

    book = EpubHandler.openBook(bookRecord.data);
    await book.ready;

    await createRendition();

    buildToc();
    bindReaderEvents();

    if (bookRecord.locations) {
      try {
        book.locations.load(bookRecord.locations);
      } catch (err) {
        console.error("Failed to load saved locations:", err);
      }
    }

    updateProgressUI();
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
    if (rendition) { try { rendition.destroy(); } catch(_) {} rendition = null; }
    if (book)      { try { book.destroy();      } catch(_) {} book = null; }

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
      btn.className = `toc-item level-${item.depth}`;
      btn.textContent = item.label;
      btn.dataset.href = item.href;
      btn.addEventListener('click', () => {
        rendition?.display(item.href).catch(() => {});
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

    if (patch.layout && patch.layout !== wasLayout) {
      createRendition(currentCfi).then(() => {
        buildToc();
        updateProgressUI();
      });
    } else {
      applyRenditionTheme();
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
    if (!book || !rendition) return;
    try {
      const loc = rendition.currentLocation();
      if (!loc || !loc.start) return;
      currentCfi = loc.start.cfi;

      let pct = Math.round(book.locations.percentageFromCfi(currentCfi) * 100);
      let displayPct = isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));

      // Fallback: estimate overall progress using spine items if locations are not yet loaded/generated
      if (displayPct === 0) {
        const spineIndex = loc.start.index;
        const totalSpines = book.spine.length || 1;
        const innerPage = loc.start.displayed.page || 1;
        const innerTotal = loc.start.displayed.total || 1;
        const progressInSpine = innerTotal > 0 ? (innerPage - 1) / innerTotal : 0;
        displayPct = Math.round(((spineIndex + progressInSpine) / totalSpines) * 100);
        displayPct = Math.max(0, Math.min(100, displayPct));
      }

      progressBar.style.width     = displayPct + '%';
      progressLabel.textContent   = displayPct + '%';

      const toc     = bookRecord.toc || [];
      const spineHref = loc.start.href;
      const chapter = toc.find(t => spineHref && t.href && spineHref.includes(t.href.split('#')[0]));
      chapterLabel.textContent  = chapter ? chapter.label : '';
      locationLabel.textContent = `Page ${loc.start.displayed.page} of ${loc.start.displayed.total}`;
      if (chapter) highlightTocItem(chapter.href);

      await Storage.updateProgress(bookRecord.id, currentCfi, displayPct, chapter?.label);
      bookRecord.progress   = displayPct;
      bookRecord.currentCfi = currentCfi;
    } catch (_) {}
  }

  /* ── Navigation ── */
  function nextPage() { rendition?.next(); }
  function prevPage() { rendition?.prev(); }

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
  }

  function toggleSettingsPanel() {
    if (panelOpen === 'settings') { closePanels(); return; }
    panelOpen = 'settings';
    settingsPanel.classList.remove('hidden');
    bookmarksPanel.classList.add('hidden');
    refreshSettingsUI();
  }

  function toggleBookmarksPanel() {
    if (panelOpen === 'bookmarks') { closePanels(); return; }
    panelOpen = 'bookmarks';
    bookmarksPanel.classList.remove('hidden');
    settingsPanel.classList.add('hidden');
    renderBookmarks();
  }

  function closePanels() {
    panelOpen = false; tocOpen = false;
    tocSidebar.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    bookmarksPanel.classList.add('hidden');
  }

  /* ── Events ── */
  function bindReaderEvents() {
    document.getElementById('prev-btn').onclick = prevPage;
    document.getElementById('next-btn').onclick = nextPage;
    document.getElementById('back-to-library').onclick = close;
    document.getElementById('toc-toggle-btn').onclick = () => toggleToc();
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

    generateLocations();
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
        bookRecord.locations = book.locations.export();
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
