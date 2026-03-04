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

demoModal.addEventListener('click', (event) => {
  if (event.target !== demoModal) return;
  closeDemoModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !demoModal.classList.contains('hidden')) {
    closeDemoModal();
  }
});

