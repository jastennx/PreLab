const resetForm = document.getElementById('reset-form');
const resetSubmit = document.getElementById('reset-submit');
const resetMessage = document.getElementById('reset-message');
const newPasswordInput = document.getElementById('new-password');
const confirmNewPasswordInput = document.getElementById('confirm-new-password');

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

function setBusy(busy) {
  resetSubmit.disabled = busy;
  resetSubmit.textContent = busy ? 'Updating Password...' : 'Update Password';
}

function hasRecoveryPayload() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#')) return false;
  const hashParams = new URLSearchParams(hash.slice(1));
  return hashParams.get('type') === 'recovery';
}

async function bootstrap() {
  await window.prelabAuth.init();
  if (window.prelabAuth?.missingConfig) {
    resetMessage.textContent = 'Server configuration is missing. Please try again later.';
    setBusy(true);
    return;
  }

  const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const errorDescription = hashParams.get('error_description');
  if (errorDescription) {
    resetMessage.textContent = `Reset link is invalid or expired: ${decodeURIComponent(errorDescription)}.`;
    setBusy(true);
    return;
  }

  try {
    if (hasRecoveryPayload()) {
      await window.prelabAuth.setSessionFromRecoveryHash();
    }
  } catch (error) {
    resetMessage.textContent = `Reset link is invalid or expired: ${error.message}`;
    setBusy(true);
  }
}

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const newPassword = newPasswordInput.value.trim();
  const confirmPassword = confirmNewPasswordInput.value.trim();

  if (!newPassword || !confirmPassword) {
    await window.prelabDialog.alert('Please fill in both password fields.', { title: 'Missing Fields', icon: 'warning' });
    return;
  }

  if (newPassword.length < 6) {
    await window.prelabDialog.alert('Password must be at least 6 characters long.', {
      title: 'Weak Password',
      icon: 'warning'
    });
    return;
  }

  if (newPassword !== confirmPassword) {
    await window.prelabDialog.alert('Password and confirm password do not match.', {
      title: 'Password Mismatch',
      icon: 'warning'
    });
    return;
  }

  try {
    setBusy(true);
    await window.prelabAuth.updatePassword(newPassword);
    await window.prelabDialog.alert('Your password has been updated. Please sign in.', {
      title: 'Password Updated',
      icon: 'success'
    });
    goTo('/pages/signin?mode=signin&reset=1');
  } catch (error) {
    await window.prelabDialog.alert(error.message || 'Failed to reset password.', {
      title: 'Reset Failed',
      icon: 'error'
    });
    setBusy(false);
  }
});

bootstrap();
