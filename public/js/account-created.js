const params = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const message = document.getElementById('message');

const errorDescription = params.get('error_description') || hashParams.get('error_description');
const type = params.get('type') || hashParams.get('type');

if (errorDescription) {
  message.textContent = `Email confirmation failed: ${decodeURIComponent(errorDescription)}. Please try signing up again.`;
} else if (type === 'signup') {
  message.textContent = 'Your email was confirmed successfully. You can now sign in to PreLab.';
}
