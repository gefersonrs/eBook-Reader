/**
 * library.js
 * Library page: book grid, currently-reading hero, recent strip, search/sort, upload.
 */

const Library = (() => {
  let allBooks     = [];
  let currentQuery = '';
  let currentSort  = 'recent';

  const booksGrid    = document.getElementById('books-grid');
  const emptyState   = document.getElementById('empty-state');
  const bookCount    = document.getElementById('book-count');
  const searchInput  = document.getElementById('search-input');
  const sortSelect   = document.getElementById('sort-select');
  const recentSec    = document.getElementById('recent-section');
  const recentGrid   = document.getElementById('recent-grid');
  const fileInput    = document.getElementById('file-input');
  const crSection    = document.getElementById('currently-reading-section');
  const crHero       = document.getElementById('currently-reading-hero');

  /** Init */
  async function init() {
    allBooks = await Storage.getAllBooks();
    bindEvents();
    render();
  }

  /* ── Events ── */
  function bindEvents() {
    searchInput.addEventListener('input', e => { currentQuery = e.target.value.toLowerCase(); render(); });
    sortSelect.addEventListener('change', e => { currentSort = e.target.value; render(); });

    document.getElementById('add-book-btn').addEventListener('click', () => fileInput.click());
    document.getElementById('add-book-empty-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => handleFiles(e.target.files));

    // Drag-drop
    document.body.addEventListener('dragover',  e => { e.preventDefault(); document.body.classList.add('drag-over'); });
    document.body.addEventListener('dragleave', () => document.body.classList.remove('drag-over'));
    document.body.addEventListener('drop', e => {
      e.preventDefault();
      document.body.classList.remove('drag-over');
      const files = [...e.dataTransfer.files].filter(f => f.name.endsWith('.epub'));
      if (files.length) handleFiles(files);
    });

    // Library theme picker
    const libThemeBtn    = document.getElementById('lib-theme-btn');
    const libThemePicker = document.getElementById('lib-theme-picker');
    libThemeBtn.addEventListener('click', e => {
      e.stopPropagation();
      libThemePicker.classList.toggle('hidden');
    });
    document.addEventListener('click', () => libThemePicker.classList.add('hidden'));
    libThemePicker.addEventListener('click', e => e.stopPropagation());

    libThemePicker.querySelectorAll('.theme-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        App.setTheme(btn.dataset.theme);
        libThemePicker.classList.add('hidden');
        refreshThemePicker();
      });
    });

    refreshThemePicker();
  }

  function refreshThemePicker() {
    const saved = Storage.getSettings().theme;
    document.querySelectorAll('#lib-theme-picker .theme-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === saved);
    });
  }

  /* ── File Handling ── */
  async function handleFiles(files) {
    const arr = [...files].filter(f => f.name.toLowerCase().endsWith('.epub'));
    if (!arr.length) { App.toast('Please select .epub files only', 'error'); return; }

    for (const file of arr) {
      const existing = allBooks.find(b => b.fileName === file.name && b.fileSize === file.size);
      if (existing) { App.toast(`"${file.name}" is already in your library`, 'warn'); continue; }

      showUploadOverlay(0, `Adding "${file.name}"…`);
      try {
        const book = await EpubHandler.processFile(file, pct => setUploadProgress(pct));
        await Storage.saveBook(book);
        allBooks.unshift(book);
        App.toast(`"${book.title}" added!`);
        render();
      } catch (err) {
        console.error('Error processing EPUB:', err);
        App.toast('Failed to add book. File may be corrupted.', 'error');
      } finally {
        hideUploadOverlay();
      }
    }
    fileInput.value = '';
  }

  /* ── Render ── */
  function render() {
    let books = filterBooks(allBooks, currentQuery);
    books     = sortBooks(books, currentSort);
    renderCurrentlyReading(allBooks);
    renderGrid(books);
    renderRecent(allBooks);
    updateCount(books.length, allBooks.length);
  }

  /* ── Currently Reading Hero ── */
  function renderCurrentlyReading(books) {
    // Find the most recently read in-progress book
    const active = books
      .filter(b => b.lastRead && b.progress > 0 && b.progress < 100)
      .sort((a, b) => b.lastRead - a.lastRead)[0];

    if (!active) {
      crSection.classList.add('hidden');
      crHero.innerHTML = '';
      return;
    }

    crSection.classList.remove('hidden');
    crHero.innerHTML = '';

    const el = document.createElement('div');
    el.className = 'currently-reading-hero animate-fade-in';
    el.innerHTML = `
      ${active.coverBase64
        ? `<img class="hero-cover" src="${active.coverBase64}" alt="${escHtml(active.title)}" />`
        : `<div class="hero-cover-placeholder">
             <svg class="w-8 h-8" style="color:var(--text-faint)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
             </svg>
           </div>`
      }
      <div class="flex-1 min-w-0">
        <div class="hero-badge">
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
          Currently Reading
        </div>
        <p class="hero-title line-clamp-2">${escHtml(active.title)}</p>
        <p class="hero-author">${escHtml(active.author)}</p>
        <div class="hero-progress-bar">
          <div class="hero-progress-fill" style="width:${active.progress}%"></div>
        </div>
        <p class="hero-pct">${active.progress}% complete${active.chapterTitle ? ' · ' + escHtml(active.chapterTitle) : ''}</p>
        <button class="hero-btn">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          </svg>
          Continue Reading
        </button>
      </div>
    `;

    el.querySelector('.hero-btn').addEventListener('click', e => { e.stopPropagation(); App.openReader(active.id); });
    el.addEventListener('click', () => App.openReader(active.id));
    crHero.appendChild(el);
  }

  /* ── Filter / Sort ── */
  function filterBooks(books, q) {
    if (!q) return books;
    return books.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q)
    );
  }

  function sortBooks(books, key) {
    return [...books].sort((a, b) => {
      if (key === 'title')    return a.title.localeCompare(b.title);
      if (key === 'author')   return a.author.localeCompare(b.author);
      if (key === 'progress') return (b.progress || 0) - (a.progress || 0);
      return (b.dateAdded || 0) - (a.dateAdded || 0);
    });
  }

  /* ── Grid ── */
  function renderGrid(books) {
    booksGrid.innerHTML = '';

    if (!books.length) {
      emptyState.classList.remove('hidden');
      emptyState.classList.add('flex');
      booksGrid.classList.add('hidden');
      return;
    }
    emptyState.classList.add('hidden');
    emptyState.classList.remove('flex');
    booksGrid.classList.remove('hidden');

    books.forEach(book => booksGrid.appendChild(createBookCard(book)));
  }

  function createBookCard(book) {
    const div = document.createElement('div');
    div.className = 'book-card animate-fade-in';
    div.dataset.id = book.id;
    const pct = book.progress || 0;

    div.innerHTML = `
      <div class="cover-wrap">
        ${book.coverBase64
          ? `<img class="cover-img" src="${book.coverBase64}" alt="${escHtml(book.title)}" loading="lazy" />`
          : `<div class="cover-placeholder">
               <svg class="w-8 h-8 mb-2" style="color:var(--text-faint)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
               </svg>
               <p class="text-xs leading-tight line-clamp-3 book-meta-title">${escHtml(book.title)}</p>
             </div>`
        }
        <div class="book-overlay">
          <button class="btn-open" data-action="open"   data-id="${book.id}" title="Open">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </button>
          <button class="btn-delete" data-action="delete" data-id="${book.id}" title="Remove">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
      <div class="mt-2.5 px-0.5">
        <p class="book-meta-title font-medium line-clamp-2 mb-0.5">${escHtml(book.title)}</p>
        <p class="book-meta-author truncate">${escHtml(book.author)}</p>
        <div class="progress-bar mt-2">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        ${pct > 0 ? `<p class="book-meta-pct mt-1">${pct}%</p>` : ''}
      </div>
    `;

    div.querySelector('[data-action="open"]').addEventListener('click', e => { e.stopPropagation(); App.openReader(book.id); });
    div.querySelector('[data-action="delete"]').addEventListener('click', e => { e.stopPropagation(); confirmDelete(book); });
    div.addEventListener('click', () => App.openReader(book.id));
    return div;
  }

  /* ── Recently Read Strip ── */
  function renderRecent(books) {
    const recent = books
      .filter(b => b.lastRead)
      .sort((a, b) => b.lastRead - a.lastRead)
      .slice(0, 8);

    if (!recent.length) { recentSec.classList.add('hidden'); return; }
    recentSec.classList.remove('hidden');
    recentGrid.innerHTML = '';

    recent.forEach(book => {
      const card = document.createElement('div');
      card.className = 'recent-card';
      card.innerHTML = `
        ${book.coverBase64
          ? `<img class="mini-cover" src="${book.coverBase64}" alt="${escHtml(book.title)}" />`
          : `<div class="mini-cover rounded-lg flex items-center justify-center" style="background:var(--surface2)">
               <svg class="w-5 h-5" style="color:var(--text-faint)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
               </svg>
             </div>`
        }
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate book-meta-title">${escHtml(book.title)}</p>
          <p class="text-xs truncate book-meta-author mb-1">${escHtml(book.author)}</p>
          <div class="progress-bar"><div class="progress-fill" style="width:${book.progress||0}%"></div></div>
          <p class="book-meta-pct mt-1">${book.progress||0}%</p>
        </div>
      `;
      card.addEventListener('click', () => App.openReader(book.id));
      recentGrid.appendChild(card);
    });
  }

  function updateCount(shown, total) {
    bookCount.textContent = shown === total
      ? `${total} book${total !== 1 ? 's' : ''}`
      : `${shown} of ${total}`;
  }

  async function confirmDelete(book) {
    if (!confirm(`Remove "${book.title}" from your library?\nThis cannot be undone.`)) return;
    await Storage.deleteBook(book.id);
    allBooks = allBooks.filter(b => b.id !== book.id);
    App.toast(`"${book.title}" removed`);
    render();
  }

  /* ── Upload Overlay ── */
  function showUploadOverlay(pct, msg) {
    document.getElementById('upload-overlay').classList.remove('hidden');
    setUploadProgress(pct, msg);
  }
  function setUploadProgress(pct, msg) {
    document.getElementById('upload-progress').style.width = pct + '%';
    if (msg) document.getElementById('upload-status').textContent = msg;
  }
  function hideUploadOverlay() {
    document.getElementById('upload-overlay').classList.add('hidden');
    setUploadProgress(0);
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, render, refreshThemePicker };
})();
