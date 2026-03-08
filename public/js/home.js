const loginBtn = document.getElementById('show-login');
const signupBtn = document.getElementById('show-signup');
const loginHeroBtn = document.getElementById('show-login-hero');
const signupHeroBtn = document.getElementById('show-signup-hero');
const watchDemoBtn = document.getElementById('watch-demo');
const demoModal = document.getElementById('demo-modal');
const closeDemoBtn = document.getElementById('close-demo');
const demoOverlay = document.getElementById('demo-overlay');
const demoVideo = document.getElementById('demo-video');

function goTo(url, replace = false) {
  if (window.prelabNavigate) {
    window.prelabNavigate(url, { replace });
    return;
  }
  if (replace) {
    window.location.replace(url);
    return;
  }
  window.location.href = url;
}

function redirectOAuthCallbackToSignin() {
  const searchParams = new URLSearchParams(window.location.search || '');
  const rawHash = window.location.hash || '';
  const hashParams = rawHash.startsWith('#') ? new URLSearchParams(rawHash.slice(1)) : new URLSearchParams();
  const callbackType = hashParams.get('type');

  const hasQueryPayload =
    searchParams.has('code') || searchParams.has('error') || searchParams.has('error_description');
  const hasHashPayload = Boolean(
    hashParams.get('access_token') || hashParams.get('refresh_token') || hashParams.get('provider_token')
  );
  const isEmailFlow = callbackType === 'signup' || callbackType === 'recovery';

  if (!hasQueryPayload && (!hasHashPayload || isEmailFlow)) return;

  goTo(`/pages/signin${window.location.search || ''}${rawHash}`, true);
}

function redirectSignupHashToAccountCreated() {
  const rawHash = window.location.hash || '';
  if (!rawHash.startsWith('#')) return;

  const hashParams = new URLSearchParams(rawHash.slice(1));
  const type = hashParams.get('type');
  const hasAuthPayload = Boolean(hashParams.get('access_token') || hashParams.get('error_code'));
  if (!hasAuthPayload) return;

  if (type === 'signup') {
    goTo(`/pages/account-created${rawHash}`, true);
    return;
  }

  if (type === 'recovery') {
    goTo(`/pages/reset-password${rawHash}`, true);
  }
}

redirectOAuthCallbackToSignin();
redirectSignupHashToAccountCreated();

function closeDemoModal() {
  demoVideo.pause();
  demoModal.classList.add('hidden');
}

function goToSignin() {
  goTo('/pages/signin?mode=signin');
}

function goToSignup() {
  goTo('/pages/signin?mode=signup');
}

loginBtn.addEventListener('click', goToSignin);
if (loginHeroBtn) loginHeroBtn.addEventListener('click', goToSignin);

signupBtn.addEventListener('click', goToSignup);
if (signupHeroBtn) signupHeroBtn.addEventListener('click', goToSignup);

watchDemoBtn.addEventListener('click', async () => {
  demoModal.classList.remove('hidden');
  try {
    await demoVideo.play();
  } catch (_error) {
    // Playback may require user gesture on some browsers.
  }
});

closeDemoBtn.addEventListener('click', () => {
  closeDemoModal();
});

if (demoOverlay) {
  demoOverlay.addEventListener('click', () => {
    closeDemoModal();
  });
}

/* ═══════════════════════════════════
   COMMUNITY REVIEWERS
   ═══════════════════════════════════ */
let activeCategory = '';

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

async function loadCommunityModules(category) {
  const grid = document.getElementById('community-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="community-loading">
      <div class="skeleton-card"></div><div class="skeleton-card"></div>
      <div class="skeleton-card"></div><div class="skeleton-card"></div>
    </div>`;

  try {
    const apiBase = window.PRELAB_CONFIG?.apiBase || '/api';
    const url = category
      ? `${apiBase}/modules/public?category=${encodeURIComponent(category)}`
      : `${apiBase}/modules/public`;
    const res = await fetch(url);
    const data = await res.json();
    const modules = data.modules || [];

    if (!modules.length) {
      grid.innerHTML = `
        <div class="community-empty">
          <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M8 15s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          <p>No public reviewers yet. Be the first to share!</p>
        </div>`;
      return;
    }

    grid.innerHTML = '';
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const card = document.createElement('article');
      card.className = 'community-card';
      card.style.setProperty('--card-delay', `${i * 0.07}s`);
      const authorName = mod.users?.full_name || 'Anonymous';
      const initial = authorName.charAt(0).toUpperCase();
      card.innerHTML = `
        <div class="cc-top">
          <span class="cc-category">${mod.category || 'General'}</span>
          <span class="cc-time">${timeAgo(mod.created_at)}</span>
        </div>
        <h3 class="cc-title">${mod.title}</h3>
        <p class="cc-subject">${mod.subjects?.name || 'General'}</p>
        ${mod.study_goal ? `<p class="cc-goal">${mod.study_goal}</p>` : ''}
        <div class="cc-author">
          <span class="cc-avatar">${initial}</span>
          <span class="cc-name">${authorName}</span>
        </div>
        <button class="cc-start-btn" data-module-id="${mod.id}">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Sign in to study
        </button>
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll('.cc-start-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mid = btn.dataset.moduleId;
        goTo(`/pages/signin?mode=signin&redirect=study&moduleId=${encodeURIComponent(mid)}`);
      });
    });
  } catch (_error) {
    grid.innerHTML = `
      <div class="community-empty">
        <p>Could not load community reviewers right now.</p>
      </div>`;
  }
}

async function loadCategoryTabs() {
  const tabsContainer = document.getElementById('category-tabs');
  if (!tabsContainer) return;

  try {
    const apiBase = window.PRELAB_CONFIG?.apiBase || '/api';
    const res = await fetch(`${apiBase}/modules/categories`);
    const data = await res.json();
    const categories = data.categories || [];

    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.className = 'cat-tab';
      btn.dataset.category = cat;
      btn.textContent = cat;
      tabsContainer.appendChild(btn);
    }

    tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.cat-tab');
      if (!tab) return;
      tabsContainer.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('cat-tab--active'));
      tab.classList.add('cat-tab--active');
      activeCategory = tab.dataset.category;
      loadCommunityModules(activeCategory);
    });
  } catch (_e) { /* tabs will just show "All" */ }
}

async function initCommunity() {
  await loadCategoryTabs();
  await loadCommunityModules('');
}

initCommunity();

demoModal.addEventListener('click', (event) => {
  if (event.target !== demoModal) return;
  closeDemoModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !demoModal.classList.contains('hidden')) {
    closeDemoModal();
  }
});

