const messages = Object.freeze({
  'auth/missing-email': 'Enter your email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/invalid-credential': 'The email and password don’t match. Check them and try again.',
  'auth/wrong-password': 'The email and password don’t match. Check them and try again.',
  'auth/user-not-found': 'The email and password don’t match. Check them and try again.',
  'auth/email-already-in-use': 'An account already uses this email. Try logging in.',
  'auth/weak-password': 'Choose a stronger password and try again.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Couldn’t connect. Check your internet connection and try again.',
});

function requiredCredentialsMessage(email, password) {
  const missingEmail = typeof email !== 'string' || !email.trim();
  const missingPassword = typeof password !== 'string' || !password.length;
  if (missingEmail && missingPassword) return 'Enter your email and password.';
  if (missingEmail) return 'Enter your email address.';
  if (missingPassword) return 'Enter your password.';
  return null;
}

function authenticationErrorMessage(error, mode, accountCreated = false) {
  if (mode === 'signup' && accountCreated) {
    return 'Your account was created, but profile setup could not finish. Try logging in.';
  }
  const code = error?.code;
  if (typeof code === 'string' && Object.hasOwn(messages, code)) return messages[code];
  return mode === 'signup' ? 'We couldn’t create your account. Please try again.' : 'We couldn’t log you in. Please try again.';
}

module.exports = { requiredCredentialsMessage, authenticationErrorMessage };
