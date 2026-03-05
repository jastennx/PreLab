(() => {
  const STORAGE_KEY = 'prelab_accent_color';
  const DEFAULT_COLOR = '#8b5cf6';
  const NAV_TRANSITION_MS = 140;

  /* ── colour helpers ── */
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function isLightColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    return relativeLuminance(r, g, b) > 0.35;
  }

  function getSavedColor() {
    const saved = (window.localStorage.getItem(STORAGE_KEY) || '').trim();
    return /^#[0-9a-f]{6}$/i.test(saved) ? saved : DEFAULT_COLOR;
  }

  function applyColor(hex) {
    const color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_COLOR;
    const { r, g, b } = hexToRgb(color);
    const { h, s } = rgbToHsl(r, g, b);

    const accent2H = (h + 30) % 360;
    const accent2S = Math.min(s + 10, 100);

    const root = document.documentElement;
    root.style.setProperty('--user-accent', color);
    root.style.setProperty('--user-accent-rgb', `${r},${g},${b}`);
    root.style.setProperty('--user-accent-h', h);
    root.style.setProperty('--user-accent-s', `${s}%`);
    root.style.setProperty('--user-accent2-h', accent2H);
    root.style.setProperty('--user-accent2-s', `${accent2S}%`);

    window.localStorage.setItem(STORAGE_KEY, color);
  }

  /* ── glow + orbs + bg-mode persistence (applied on every page) ── */
  function applyGlobalPrefs() {
    const glow = localStorage.getItem('prelab_glow_intensity');
    if (glow !== null) {
      document.documentElement.style.setProperty('--glow-opacity', parseInt(glow, 10) / 100);
    }
    const orbs = localStorage.getItem('prelab_orbs_enabled');
    if (orbs === 'false') {
      document.querySelectorAll('.bg-orb').forEach(o => (o.style.display = 'none'));
    }
    /* background mode: gradient (default) or solid */
    const mode = localStorage.getItem('prelab_bg_mode') || 'gradient';
    if (mode === 'solid') {
      document.body.classList.add('bg-solid');
      const solidColor = localStorage.getItem('prelab_solid_color') || '#0a0118';
      document.documentElement.style.setProperty('--solid-bg', solidColor);
      document.body.classList.toggle('bg-light', isLightColor(solidColor));
    } else {
      document.body.classList.remove('bg-solid');
      document.body.classList.remove('bg-light');
    }
  }

  /* expose helpers globally for settings page */
  window.prelabTheme = {
    STORAGE_KEY,
    DEFAULT_COLOR,
    getSavedColor,
    applyColor,
    hexToRgb,
    rgbToHsl,
    isLightColor
  };

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
    applyColor(getSavedColor());
    applyGlobalPrefs();
    wireInternalLinks();
    markPageReady();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
