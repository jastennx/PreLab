const authTitle = document.getElementById('auth-title');
const authForm = document.getElementById('auth-form');
const authSubmit = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
const authInfo = document.getElementById('auth-info');
const switchModeBtn = document.getElementById('switch-mode');
const switchLabel = document.getElementById('switch-label');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const confirmPasswordLabel = document.getElementById('confirm-password-label');
const showPasswordWrap = document.getElementById('show-password-wrap');
const showPasswordToggle = document.getElementById('show-password');
const fullNameInput = document.getElementById('full-name');
const fullNameLabel = document.getElementById('full-name-label');
const signupModal = document.getElementById('signup-modal');
const signupModalClose = document.getElementById('signup-modal-close');

let mode = 'signin';
let submitCooldownUntil = 0;

function setSubmitState({ busy = false } = {}) {
  authSubmit.disabled = busy;
  authSubmit.style.opacity = busy ? '0.75' : '1';
  authSubmit.style.cursor = busy ? 'not-allowed' : 'pointer';
}

function startCooldown(seconds = 30) {
  submitCooldownUntil = Date.now() + seconds * 1000;
}

function getAuthErrorMessage(error) {
  const raw = `${error?.message || ''}`.toLowerCase();
  const status = Number(error?.status || 0);

  if (status === 429 || raw.includes('rate limit')) {
    return 'Email sending is temporarily rate-limited. Please wait about 30-60 seconds before trying again. If this continues, enable custom SMTP in Supabase for higher email limits.';
  }

  return error?.message || 'Something went wrong. Please try again.';
}

function openSignupModal() {
  signupModal.classList.remove('hidden');
  signupModal.setAttribute('aria-hidden', 'false');
}

function closeSignupModal() {
  signupModal.classList.add('hidden');
  signupModal.setAttribute('aria-hidden', 'true');
}

function setPasswordVisibility(show) {
  const type = show ? 'text' : 'password';
  passwordInput.type = type;
  confirmPasswordInput.type = type;
}

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
    switchLabel.textContent = 'Need an account?';
    switchModeBtn.textContent = 'Sign up';
    confirmPasswordInput.classList.add('hidden');
    confirmPasswordLabel.classList.add('hidden');
    showPasswordWrap.classList.add('hidden');
    confirmPasswordInput.required = false;
    showPasswordToggle.checked = false;
    setPasswordVisibility(false);
    fullNameInput.classList.add('hidden');
    fullNameLabel.classList.add('hidden');
  } else {
    authTitle.textContent = 'Sign up';
    authSubmit.textContent = 'Create account';
    switchLabel.textContent = 'Already have an account?';
    switchModeBtn.textContent = 'Sign in';
    confirmPasswordInput.classList.remove('hidden');
    confirmPasswordLabel.classList.remove('hidden');
    showPasswordWrap.classList.remove('hidden');
    confirmPasswordInput.required = true;
    fullNameInput.classList.remove('hidden');
    fullNameLabel.classList.remove('hidden');
  }
}

const params = new URLSearchParams(window.location.search);
setMode(params.get('mode') === 'signup' ? 'signup' : 'signin');

switchModeBtn.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
signupModalClose.addEventListener('click', closeSignupModal);
signupModal.addEventListener('click', (event) => {
  if (event.target === signupModal) closeSignupModal();
});
showPasswordToggle.addEventListener('change', () => {
  setPasswordVisibility(showPasswordToggle.checked);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !signupModal.classList.contains('hidden')) {
    closeSignupModal();
  }
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.textContent = '';
  authInfo.textContent = '';
  if (Date.now() < submitCooldownUntil) {
    authError.textContent = 'Please wait a bit before sending another request.';
    return;
  }

  await window.prelabAuth.init();
  if (window.prelabAuth?.missingConfig) {
    authError.textContent = 'Supabase server config is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.';
    return;
  }

  const email = document.getElementById('email').value.trim();
  const password = passwordInput.value.trim();
  const confirmPassword = confirmPasswordInput.value.trim();
  const fullName = fullNameInput.value.trim();

  try {
    setSubmitState({ busy: true });
    if (mode === 'signup') {
      if (password !== confirmPassword) {
        throw new Error('Password and confirm password do not match.');
      }

      const signup = await window.prelabAuth.signUp(email, password, fullName);
      await syncUserRecord(signup.user, fullName);
      authInfo.textContent = 'Account created. Please confirm your email before signing in.';
      openSignupModal();
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
    window.location.href = '/pages/dashboard.html';
  } catch (error) {
    authError.textContent = getAuthErrorMessage(error);
    if (Number(error?.status || 0) === 429 || `${error?.message || ''}`.toLowerCase().includes('rate limit')) {
      startCooldown(45);
    }
  } finally {
    setSubmitState({ busy: false });
  }
});

