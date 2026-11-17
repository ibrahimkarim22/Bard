// Login and deletion share this queue because SecureStore has no conditional
// delete primitive. A credential read/check/delete must be one queued action.
let tail = Promise.resolve();
function runCredentialMutation(run) {
  if (typeof run !== 'function') return Promise.reject(new TypeError('A credential mutation is required.'));
  const task = tail.then(run);
  tail = task.catch(() => {});
  return task;
}
module.exports = { runCredentialMutation };
