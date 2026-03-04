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
const confirmPasswordWrap = document.getElementById('confirm-password-wrap');
const showPasswordWrap = document.getElementById('show-password-wrap');
const showPasswordToggle = document.getElementById('show-password');
const forgotPasswordWrap = document.getElementById('forgot-password-wrap');
const forgotPasswordBtn = document.getElementById('forgot-password-btn');
const fullNameInput = document.getElementById('full-name');
const fullNameLabel = document.getElementById('full-name-label');
const fullNameWrap = document.getElementById('full-name-wrap');
const signupModal = document.getElementById('signup-modal');
const signupModalClose = document.getElementById('signup-modal-close');
const googleSigninBtn = document.getElementById('google-signin');

let mode = 'signin';
let submitCooldownUntil = 0;

function openSignupLoadingPopup() {
  if (!window.Swal?.fire) return;
  window.Swal.fire({
    title: 'Creating account...',
    text: 'Please wait while we set up your account.',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => {
      window.Swal.showLoading();
    }
  });
}

function closeSignupLoadingPopup() {
  if (!window.Swal?.close) return;
  window.Swal.close();
}

function showVerifiedToastIfNeeded(params) {
  if (params.get('verified') !== '1') return;
  if (!window.Swal?.fire) return;

  window.Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: 'Account successfully verified',
    showConfirmButton: false,
    timer: 2400,
    timerProgressBar: true
  });

  const next = new URLSearchParams(params);
  next.delete('verified');
  const query = next.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState({}, '', nextUrl);
}

function showPasswordResetToastIfNeeded(params) {
  if (params.get('reset') !== '1') return;
  if (!window.Swal?.fire) return;

  window.Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'success',
    title: 'Password updated successfully',
    showConfirmButton: false,
    timer: 2400,
    timerProgressBar: true
  });

  const next = new URLSearchParams(params);
  next.delete('reset');
  const query = next.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState({}, '', nextUrl);
}

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

function persistAuthenticatedUser(user) {
  window.localStorage.setItem(
    'prelab_user',
    JSON.stringify({ id: user.id, email: user.email, full_name: user.user_metadata?.full_name || '' })
  );
}

async function getUserWithRetry(attempts = 5, delayMs = 250) {
  for (let index = 0; index < attempts; index += 1) {
    const user = await window.prelabAuth.getUser();
    if (user) return user;
    if (index < attempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return null;
}

async function continueIfAuthenticated() {
  await window.prelabAuth.init();
  if (window.prelabAuth?.missingConfig) return;

  const user = await getUserWithRetry();
  if (!user) return;

  await syncUserRecord(user, user.user_metadata?.full_name || user.user_metadata?.name || '');
  persistAuthenticatedUser(user);
  window.location.replace('/pages/dashboard');
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
    if (confirmPasswordWrap) confirmPasswordWrap.classList.add('hidden');
    showPasswordWrap.classList.remove('hidden');
    forgotPasswordWrap.classList.remove('hidden');
    confirmPasswordInput.required = false;
    showPasswordToggle.checked = false;
    setPasswordVisibility(false);
    fullNameInput.classList.add('hidden');
    fullNameLabel.classList.add('hidden');
    if (fullNameWrap) fullNameWrap.classList.add('hidden');
    fullNameInput.required = false;
  } else {
    authTitle.textContent = 'Sign up';
    authSubmit.textContent = 'Create account';
    switchLabel.textContent = 'Already have an account?';
    switchModeBtn.textContent = 'Sign in';
    confirmPasswordInput.classList.remove('hidden');
    confirmPasswordLabel.classList.remove('hidden');
    if (confirmPasswordWrap) confirmPasswordWrap.classList.remove('hidden');
    showPasswordWrap.classList.remove('hidden');
    forgotPasswordWrap.classList.add('hidden');
    confirmPasswordInput.required = true;
    fullNameInput.classList.remove('hidden');
    fullNameLabel.classList.remove('hidden');
    if (fullNameWrap) fullNameWrap.classList.remove('hidden');
    fullNameInput.required = true;
  }
}

const params = new URLSearchParams(window.location.search);
setMode(params.get('mode') === 'signup' ? 'signup' : 'signin');
showVerifiedToastIfNeeded(params);
showPasswordResetToastIfNeeded(params);
continueIfAuthenticated().catch(() => {
});

switchModeBtn.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
signupModalClose.addEventListener('click', closeSignupModal);
signupModal.addEventListener('click', (event) => {
  if (event.target === signupModal) closeSignupModal();
});
showPasswordToggle.addEventListener('change', () => {
  setPasswordVisibility(showPasswordToggle.checked);
});

forgotPasswordBtn.addEventListener('click', async () => {
  await window.prelabAuth.init();
  if (window.prelabAuth?.missingConfig) {
    authError.textContent = 'Supabase server config is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.';
    return;
  }

  let email = document.getElementById('email').value.trim();
  if (!email) {
    const prompt = await window.Swal.fire({
      title: 'Reset password',
      text: 'Enter your account email to receive a reset link.',
      input: 'email',
      inputPlaceholder: 'you@example.com',
      showCancelButton: true,
      confirmButtonText: 'Send Link'
    });
    if (!prompt.isConfirmed) return;
    email = String(prompt.value || '').trim();
  }

  if (!email) {
    authError.textContent = 'Please enter your email first.';
    return;
  }

  try {
    await window.prelabAuth.requestPasswordReset(email, `${window.location.origin}/pages/reset-password`);
    await window.prelabDialog.alert('Password reset link sent. Please check your email.', {
      title: 'Email Sent',
      icon: 'success'
    });
  } catch (error) {
    authError.textContent = getAuthErrorMessage(error);
  }
});

googleSigninBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authInfo.textContent = '';

  await window.prelabAuth.init();
  if (window.prelabAuth?.missingConfig) {
    authError.textContent = 'Supabase server config is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.';
    return;
  }

  try {
    setSubmitState({ busy: true });
    googleSigninBtn.disabled = true;
    if (window.Swal?.fire) {
      window.Swal.fire({
        title: 'Logging in...',
        text: 'Redirecting to Google sign-in.',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => { window.Swal.showLoading(); }
      });
    }
    await window.prelabAuth.signInWithGoogle();
  } catch (error) {
    if (window.Swal?.close) window.Swal.close();
    googleSigninBtn.disabled = false;
    setSubmitState({ busy: false });
    authError.textContent = getAuthErrorMessage(error);
  }
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
  let isSignupFlow = false;

  try {
    setSubmitState({ busy: true });
    if (mode === 'signup') {
      isSignupFlow = true;
      if (!email || !password || !confirmPassword || !fullName) {
        throw new Error('Please complete all fields before continuing.');
      }

      if (password !== confirmPassword) {
        throw new Error('Password and confirm password do not match.');
      }

      openSignupLoadingPopup();
      const emailRedirectTo = `${window.location.origin}/pages/account-created`;
      const signup = await window.prelabAuth.signUp(email, password, fullName, emailRedirectTo);
      await syncUserRecord(signup.user, fullName);
      closeSignupLoadingPopup();
      authInfo.textContent = 'Account created. Please confirm your email before signing in.';
      openSignupModal();
      setMode('signin');
      return;
    }

    const data = await window.prelabAuth.signIn(email, password);
    const user = data.user;
    await syncUserRecord(user, fullName);
    persistAuthenticatedUser(user);
    window.location.href = '/pages/dashboard';
  } catch (error) {
    authError.textContent = getAuthErrorMessage(error);
    if (Number(error?.status || 0) === 429 || `${error?.message || ''}`.toLowerCase().includes('rate limit')) {
      startCooldown(45);
    }
  } finally {
    if (isSignupFlow) closeSignupLoadingPopup();
    setSubmitState({ busy: false });
  }
});
