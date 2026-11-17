const messages = Object.freeze({
  ACCOUNT_DELETION_REAUTH_FAILED: 'Password could not be confirmed. Check it and try again.',
  ACCOUNT_DELETION_REAUTH_REQUIRED: 'Please confirm your password again to finish deleting your account.',
  ACCOUNT_DELETION_SIGN_IN_REQUIRED: 'Sign in to the same account to continue deletion.',
  ACCOUNT_DELETION_LOCAL_CLEANUP_FAILED: 'Your online account is deleted. Cleanup on this device is not yet complete. Please retry.',
  ACCOUNT_DELETION_STORAGE_FAILED: 'Secure deletion status could not be saved on this device. Please retry.',
  ACCOUNT_DELETION_RANDOM_UNAVAILABLE: 'Secure account deletion is unavailable in this app build.',
  ACCOUNT_DELETION_QUOTA: 'Deletion has paused because a service limit was reached. Try again later.',
  ACCOUNT_DELETION_AUTH_UNCONFIRMED: 'Final account deletion is not yet confirmed. Your remaining device data has been kept.',
  ACCOUNT_DELETION_SCHEMA_UNSUPPORTED: 'Some account data could not be safely checked. Deletion has paused.',
  ACCOUNT_DELETION_INVALID_MARKER: 'Your deletion request could not be safely verified. Deletion has paused.',
  ACCOUNT_DELETION_MARKER_MISSING: 'Your deletion request could not be verified. Deletion has paused.',
  ACCOUNT_DELETION_RULES_DENIED: 'Deletion could not continue. Please try again later.',
});
function deletionMessage(code) {
  return code ? messages[code] || 'Deletion is not yet confirmed. Check your connection and retry.' : null;
}
module.exports = { deletionMessage };
