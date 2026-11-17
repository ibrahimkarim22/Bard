// Firebase queues assignments, but its async sign-out middleware can still
// clear a different sign-in finishing concurrently. Keep account mutations in
// one ordering boundary and check the intended owner inside each operation.
// This queue is separate from local credential cleanup, which must not wait on
// an unrelated authentication network request while holding SecureStore access.
let tail = Promise.resolve();
function runAuthMutation(run) {
  if (typeof run !== 'function') return Promise.reject(new TypeError('An authentication operation is required.'));
  const task = tail.then(run);
  tail = task.catch(() => {});
  return task;
}
module.exports = { runAuthMutation };
