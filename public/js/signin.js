const authTitle = document.getElementById('auth-title');
const authForm = document.getElementById('auth-form');
const authSubmit = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
const authInfo = document.getElementById('auth-info');
const switchModeBtn = document.getElementById('switch-mode');
const fullNameInput = document.getElementById('full-name');
const fullNameLabel = document.getElementById('full-name-label');

let mode = 'signin';

async function syncUserRecord(user, fallbackName = '') {
  if (!user?.id || !user?.email) return;

  try {
    await window.api.post('/auth/sync-user', {
      userId: user.id,
      email: user.email,
      fullName: user.user_metadata?.full_name || fallbackName || ''
    });
  } catch (_error) {
    // Non-blocking: auth still succeeds even if profile sync is delayed.
  }
}

function setMode(nextMode) {
  mode = nextMode;
  authError.textContent = '';
  authInfo.textContent = '';

  if (mode === 'signin') {
    authTitle.textContent = 'Sign in';
    authSubmit.textContent = 'Sign in';
    switchModeBtn.textContent = 'Sign up';
    fullNameInput.classList.add('hidden');
    fullNameLabel.classList.add('hidden');
  } else {
    authTitle.textContent = 'Sign up';
    authSubmit.textContent = 'Create account';
    switchModeBtn.textContent = 'Sign in';
    fullNameInput.classList.remove('hidden');
    fullNameLabel.classList.remove('hidden');
  }
}

const params = new URLSearchParams(window.location.search);
setMode(params.get('mode') === 'signup' ? 'signup' : 'signin');

switchModeBtn.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.textContent = '';
  authInfo.textContent = '';

  await window.prelabAuth.init();
  if (window.prelabAuth?.missingConfig) {
    authError.textContent = 'Supabase server config is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.';
    return;
  }

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const fullName = fullNameInput.value.trim();

  try {
    if (mode === 'signup') {
      const signup = await window.prelabAuth.signUp(email, password, fullName);
      await syncUserRecord(signup.user, fullName);
      authInfo.textContent = 'Account created. Check email confirmation, then sign in.';
      setMode('signin');
      return;
    }

    const data = await window.prelabAuth.signIn(email, password);
    const user = data.user;
    await syncUserRecord(user, fullName);
    window.localStorage.setItem(
      'prelab_user',
      JSON.stringify({ id: user.id, email: user.email, full_name: user.user_metadata?.full_name || '' })
    );
    window.location.href = './dashboard.html';
  } catch (error) {
    authError.textContent = error.message;
  }
});
