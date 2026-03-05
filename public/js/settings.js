(() => {
  /* ── Storage keys ── */
  const GLOW_KEY   = 'prelab_glow_intensity';
  const ORBS_KEY   = 'prelab_orbs_enabled';
  const BG_MODE_KEY = 'prelab_bg_mode';
  const SOLID_KEY   = 'prelab_solid_color';

  /* ── DOM refs ── */
  const colorInput  = document.getElementById('accent-color-input');
  const colorPreview = document.getElementById('color-preview');
  const colorHex    = document.getElementById('color-hex-label');
  const presetGrid  = document.getElementById('preset-grid');
  const glowSlider  = document.getElementById('glow-intensity');
  const glowValue   = document.getElementById('glow-value');
  const orbsToggle  = document.getElementById('orbs-toggle');
  const resetBtn    = document.getElementById('reset-all-btn');
  const bgModeControl  = document.getElementById('bg-mode-control');
  const glowRow         = document.getElementById('glow-row');
  const solidRow        = document.getElementById('solid-color-row');
  const solidColorInput = document.getElementById('solid-color-input');
  const solidPreview    = document.getElementById('solid-color-preview');
  const solidHex        = document.getElementById('solid-color-hex');
  const displayNameInput = document.getElementById('display-name-input');
  const saveNameBtn      = document.getElementById('save-name-btn');
  const displayEmail    = document.getElementById('display-email');

  const theme = window.prelabTheme;

  /* ══════════════════════════════════
     ACCENT COLOR
     ══════════════════════════════════ */
  function syncColorUI(hex) {
    colorPreview.style.background = hex;
    colorInput.value = hex;
    colorHex.textContent = hex;
    highlightPreset(hex);
  }

  function setAccent(hex) {
    theme.applyColor(hex);
    syncColorUI(hex);
  }

  colorInput.addEventListener('input', (e) => setAccent(e.target.value));

  /* Preset swatches */
  function highlightPreset(hex) {
    presetGrid.querySelectorAll('.preset-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color.toLowerCase() === hex.toLowerCase());
    });
  }

  presetGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-swatch');
    if (!btn) return;
    setAccent(btn.dataset.color);
  });

  /* ══════════════════════════════════
     GLOW INTENSITY
     ══════════════════════════════════ */
  function loadGlow() {
    const saved = localStorage.getItem(GLOW_KEY);
    return saved !== null ? parseInt(saved, 10) : 100;
  }

  function applyGlow(val) {
    const factor = val / 100;
    document.documentElement.style.setProperty('--glow-opacity', factor);
    localStorage.setItem(GLOW_KEY, val);
    glowSlider.value = val;
    glowValue.textContent = val + '%';
  }

  glowSlider.addEventListener('input', (e) => applyGlow(parseInt(e.target.value, 10)));

  /* ══════════════════════════════════
     ANIMATED ORBS
     ══════════════════════════════════ */
  function loadOrbs() {
    const saved = localStorage.getItem(ORBS_KEY);
    return saved !== null ? saved === 'true' : true;
  }

  function applyOrbs(enabled) {
    document.querySelectorAll('.bg-orb').forEach(orb => {
      orb.style.display = enabled ? '' : 'none';
    });
    localStorage.setItem(ORBS_KEY, enabled);
    orbsToggle.checked = enabled;
  }

  orbsToggle.addEventListener('change', () => applyOrbs(orbsToggle.checked));

  /* ══════════════════════════════════
     BACKGROUND MODE (gradient / solid)
     ══════════════════════════════════ */
  function loadBgMode() {
    return localStorage.getItem(BG_MODE_KEY) || 'gradient';
  }

  function applyBgMode(mode) {
    localStorage.setItem(BG_MODE_KEY, mode);
    bgModeControl.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (mode === 'solid') {
      document.body.classList.add('bg-solid');
      glowRow.style.display = 'none';
      solidRow.style.display = '';
      const hex = localStorage.getItem(SOLID_KEY) || '#0a0118';
      document.body.classList.toggle('bg-light', theme.isLightColor(hex));
    } else {
      document.body.classList.remove('bg-solid');
      document.body.classList.remove('bg-light');
      glowRow.style.display = '';
      solidRow.style.display = 'none';
    }
  }

  bgModeControl.addEventListener('click', (e) => {
    const btn = e.target.closest('.segment-btn');
    if (!btn) return;
    applyBgMode(btn.dataset.mode);
  });

  function loadSolidColor() {
    return localStorage.getItem(SOLID_KEY) || '#0a0118';
  }

  function applySolidColor(hex) {
    document.documentElement.style.setProperty('--solid-bg', hex);
    localStorage.setItem(SOLID_KEY, hex);
    solidPreview.style.background = hex;
    solidColorInput.value = hex;
    solidHex.textContent = hex;
    /* auto-adapt text when in solid mode */
    const mode = localStorage.getItem(BG_MODE_KEY) || 'gradient';
    if (mode === 'solid') {
      document.body.classList.toggle('bg-light', theme.isLightColor(hex));
    }
  }

  solidColorInput.addEventListener('input', (e) => applySolidColor(e.target.value));

  /* ══════════════════════════════════
     RESET ALL
     ══════════════════════════════════ */
  resetBtn.addEventListener('click', async () => {
    const result = await Swal.fire({
      title: 'Reset all settings?',
      text: 'This will restore every preference to its default value.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Reset',
      cancelButtonText: 'Cancel',
      background: '#14052a',
      color: '#f5efff',
      confirmButtonColor: '#ef4444'
    });

    if (!result.isConfirmed) return;

    setAccent(theme.DEFAULT_COLOR);
    applyGlow(100);
    applyOrbs(true);
    applyBgMode('gradient');
    applySolidColor('#0a0118');

    Swal.fire({
      title: 'Done',
      text: 'All settings have been reset to defaults.',
      icon: 'success',
      timer: 1600,
      showConfirmButton: false,
      background: '#14052a',
      color: '#f5efff'
    });
  });

  /* ══════════════════════════════════
     ACCOUNT INFO + EDITABLE NAME
     ══════════════════════════════════ */
  let _originalName = '';

  function populateAccount() {
    const raw = localStorage.getItem('prelab_user');
    if (!raw) return;
    try {
      const user = JSON.parse(raw);
      const email = user.email || user.user_metadata?.email || '—';
      const name  = user.user_metadata?.display_name
                 || user.user_metadata?.full_name
                 || user.full_name
                 || email.split('@')[0];
      _originalName = name;
      displayNameInput.value = name;
      displayEmail.textContent = email;
    } catch { /* ignore */ }
  }

  /* Enable save button only when the name actually changed */
  displayNameInput.addEventListener('input', () => {
    const trimmed = displayNameInput.value.trim();
    saveNameBtn.disabled = !trimmed || trimmed === _originalName;
  });

  saveNameBtn.addEventListener('click', async () => {
    const newName = displayNameInput.value.trim();
    if (!newName || newName === _originalName) return;

    saveNameBtn.disabled = true;
    saveNameBtn.classList.add('saving');
    saveNameBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="animation:spin .5s linear infinite"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83"/></svg> Saving…`;

    try {
      const client = await window.prelabAuth.init();
      if (!client) throw new Error('Not authenticated');

      const { error } = await client.auth.updateUser({
        data: { full_name: newName }
      });
      if (error) throw error;

      /* Update localStorage so dashboard picks it up immediately */
      const raw = localStorage.getItem('prelab_user');
      if (raw) {
        try {
          const stored = JSON.parse(raw);
          stored.full_name = newName;
          if (stored.user_metadata) stored.user_metadata.full_name = newName;
          localStorage.setItem('prelab_user', JSON.stringify(stored));
        } catch { /* ignore */ }
      }

      _originalName = newName;

      Swal.fire({
        title: 'Saved',
        text: `Display name updated to "${newName}".`,
        icon: 'success',
        timer: 1600,
        showConfirmButton: false,
        background: '#14052a',
        color: '#f5efff'
      });
    } catch (err) {
      Swal.fire({
        title: 'Error',
        text: err.message || 'Could not update display name.',
        icon: 'error',
        background: '#14052a',
        color: '#f5efff'
      });
    } finally {
      saveNameBtn.classList.remove('saving');
      saveNameBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Save`;
      saveNameBtn.disabled = displayNameInput.value.trim() === _originalName;
    }
  });

  /* ══════════════════════════════════
     PROFILE PICTURE
     ══════════════════════════════════ */
  const AVATAR_KEY = 'prelab_avatar';
  const avatarPreview  = document.getElementById('avatar-preview');
  const avatarInitial  = document.getElementById('avatar-initial');
  const avatarImg      = document.getElementById('avatar-img');
  const avatarFileInput = document.getElementById('avatar-file-input');
  const removeAvatarBtn = document.getElementById('remove-avatar-btn');

  function loadProfilePicture() {
    const saved = localStorage.getItem(AVATAR_KEY);
    if (saved) {
      avatarImg.src = saved;
      avatarImg.style.display = 'block';
      avatarInitial.style.display = 'none';
      removeAvatarBtn.style.display = '';
    } else {
      avatarImg.style.display = 'none';
      avatarInitial.style.display = 'grid';
      removeAvatarBtn.style.display = 'none';
      /* set initial letter */
      const raw = localStorage.getItem('prelab_user');
      if (raw) {
        try {
          const u = JSON.parse(raw);
          const name = u.full_name || u.user_metadata?.full_name || u.email || 'U';
          avatarInitial.textContent = name.charAt(0).toUpperCase();
        } catch { avatarInitial.textContent = 'U'; }
      }
    }
  }

  avatarPreview.addEventListener('click', () => avatarFileInput.click());

  avatarFileInput.addEventListener('change', () => {
    const file = avatarFileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      Swal.fire({ title: 'Invalid file', text: 'Please select an image file.', icon: 'error', background: '#14052a', color: '#f5efff' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      Swal.fire({ title: 'Too large', text: 'Image must be under 2 MB.', icon: 'error', background: '#14052a', color: '#f5efff' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      localStorage.setItem(AVATAR_KEY, dataUrl);
      loadProfilePicture();
    };
    reader.readAsDataURL(file);
  });

  removeAvatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    localStorage.removeItem(AVATAR_KEY);
    avatarFileInput.value = '';
    loadProfilePicture();
  });

  /* ══════════════════════════════════
     BOOTSTRAP
     ══════════════════════════════════ */
  async function bootstrap() {
    if (typeof window.requireAuthUser === 'function') {
      try { await window.requireAuthUser(); } catch { return; }
    }

    /* Initialise controls with saved values */
    syncColorUI(theme.getSavedColor());
    applyBgMode(loadBgMode());
    applySolidColor(loadSolidColor());
    applyGlow(loadGlow());
    applyOrbs(loadOrbs());
    populateAccount();
    loadProfilePicture();

    /* Wire sign-out button */
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => window.confirmAndSignOut());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
