const loginBtn = document.getElementById('show-login');
const signupBtn = document.getElementById('show-signup');
const watchDemoBtn = document.getElementById('watch-demo');
const demoModal = document.getElementById('demo-modal');
const closeDemoBtn = document.getElementById('close-demo');
const demoVideo = document.getElementById('demo-video');

loginBtn.addEventListener('click', () => {
  window.location.href = './signin.html?mode=signin';
});

signupBtn.addEventListener('click', () => {
  window.location.href = './signin.html?mode=signup';
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
  demoVideo.pause();
  demoModal.classList.add('hidden');
});

demoModal.addEventListener('click', (event) => {
  if (event.target !== demoModal) return;
  demoVideo.pause();
  demoModal.classList.add('hidden');
});
