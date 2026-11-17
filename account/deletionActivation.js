// Activate only after the Spark owner-cleanup rules have been deployed and
// their owner-isolation checks verified. No Cloud Functions service is used.
export const ACCOUNT_DELETION = Object.freeze({ enabled: true, projectId: 'shakespearenativeapp' });
