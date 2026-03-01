const loginBtn = document.getElementById('show-login');
const signupBtn = document.getElementById('show-signup');
const watchDemoBtn = document.getElementById('watch-demo');
const demoModal = document.getElementById('demo-modal');
const closeDemoBtn = document.getElementById('close-demo');
const demoVideo = document.getElementById('demo-video');

function redirectSignupHashToAccountCreated() {
  const rawHash = window.location.hash || '';
  if (!rawHash.startsWith('#')) return;

  const hashParams = new URLSearchParams(rawHash.slice(1));
  const type = hashParams.get('type');
  const hasAuthPayload = Boolean(hashParams.get('access_token') || hashParams.get('error_code'));
  if (!hasAuthPayload) return;

  if (type === 'signup') {
    window.location.replace(`/pages/account-created${rawHash}`);
    return;
  }

  if (type === 'recovery') {
    window.location.replace(`/pages/reset-password${rawHash}`);
  }
}

redirectSignupHashToAccountCreated();

function closeDemoModal() {
  demoVideo.pause();
  demoModal.classList.add('hidden');
}

loginBtn.addEventListener('click', () => {
  window.location.href = '/pages/signin?mode=signin';
});

signupBtn.addEventListener('click', () => {
  window.location.href = '/pages/signin?mode=signup';
});

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

demoModal.addEventListener('click', (event) => {
  if (event.target !== demoModal) return;
  closeDemoModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !demoModal.classList.contains('hidden')) {
    closeDemoModal();
  }
});

