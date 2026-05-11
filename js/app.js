/**
 * app.js
 * Entry point – initialises the app, global theme management, routing, toasts.
 */

const App = (() => {
  let toastTimer = null;

  async function init() {
    await Storage.openDB();

    // Apply saved theme globally
    const settings = Storage.getSettings();
    applyTheme(settings.theme || 'dark');

    await Library.init();
  }

  /** Navigate to reader for a given book id */
  async function openReader(bookId) {
    try {
      await Reader.open(bookId);
    } catch (err) {
      console.error('Failed to open book:', err);
      toast('Could not open this book. The file may be corrupted.', 'error');
    }
  }

  /**
   * Apply a theme globally (data-theme attribute on <html>).
   * Saves to settings.
   * @param {string} theme  'dark' | 'dim' | 'paper' | 'sepia' | 'light'
   */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const saved = Storage.getSettings();
    if (saved.theme !== theme) {
      Storage.saveSettings({ ...saved, theme });
    }
    // Sync library theme-picker swatches if library is visible
    if (typeof Library !== 'undefined' && Library.refreshThemePicker) {
      Library.refreshThemePicker();
    }
  }

  /** Alias used by Library */
  function setTheme(theme) {
    applyTheme(theme);
  }

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'warn'} type
   */
  function toast(message, type = 'success') {
    const el   = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    const msg  = document.getElementById('toast-message');

    msg.textContent = message;

    const icons = {
      success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />',
      error:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />',
      warn:    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />',
    };
    const accentColors = {
      success: 'var(--accent)',
      error:   '#ef4444',
      warn:    '#eab308',
    };

    icon.innerHTML = icons[type] || icons.success;
    icon.style.color = accentColors[type] || accentColors.success;

    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { openReader, toast, applyTheme, setTheme };
})();
