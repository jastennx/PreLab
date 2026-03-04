(() => {
  const STORAGE_KEY = 'prelab_bg_theme';
  const DEFAULT_THEME = 'aurora';
  const THEMES = {
    aurora: 'Aurora',
    ocean: 'Ocean',
    sunset: 'Sunset',
    forest: 'Forest'
  };
  const NAV_TRANSITION_MS = 140;

  function normalizeTheme(value) {
    const key = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(THEMES, key) ? key : DEFAULT_THEME;
  }

  function getSavedTheme() {
    return normalizeTheme(window.localStorage.getItem(STORAGE_KEY));
  }

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    document.body.setAttribute('data-bg-theme', normalized);
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }

  function markPageReady() {
    window.requestAnimationFrame(() => {
      document.body.classList.add('page-ready');
      document.body.classList.remove('page-leaving');
    });
  }

  window.prelabNavigate = function prelabNavigate(url, options = {}) {
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return;

    const useReplace = Boolean(options.replace);
    document.body.classList.remove('page-ready');
    document.body.classList.add('page-leaving');

    window.setTimeout(() => {
      if (useReplace) {
        window.location.replace(safeUrl);
      } else {
        window.location.href = safeUrl;
      }
    }, NAV_TRANSITION_MS);
  };

  function buildPicker() {
    const host =
      document.querySelector('.topbar .actions') ||
      document.querySelector('.topbar .userbox') ||
      document.querySelector('.topbar .topbar-nav') ||
      document.querySelector('.topbar');

    if (!host || host.querySelector('.bg-theme-picker')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'bg-theme-picker';

    const label = document.createElement('label');
    label.className = 'bg-theme-label sr-only';
    label.setAttribute('for', 'bg-theme-select');
    label.textContent = 'Background';

    const select = document.createElement('select');
    select.id = 'bg-theme-select';
    select.className = 'bg-theme-select';
    select.setAttribute('aria-label', 'Choose background theme');

    Object.entries(THEMES).forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    });

    select.value = getSavedTheme();
    select.addEventListener('change', () => applyTheme(select.value));

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    host.appendChild(wrapper);
  }

  function wireInternalLinks() {
    document.addEventListener('click', (event) => {
      const anchor = event.target.closest('a[href]');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = String(anchor.getAttribute('href') || '').trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) return;

      event.preventDefault();
      window.prelabNavigate(href);
    });
  }

  function initTheme() {
    applyTheme(getSavedTheme());
    buildPicker();
    wireInternalLinks();
    markPageReady();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
