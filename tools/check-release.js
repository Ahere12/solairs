// Runs before `npm run dist`. Stops a release build that would ship without Microsoft sign-in.
// Set SOLARIS_ALLOW_NO_MSA=1 to build anyway (e.g. while waiting for Mojang's approval).
const { MS_CLIENT_ID } = require('../src/config');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (MS_CLIENT_ID && GUID.test(MS_CLIENT_ID)) {
  console.log(`✔ Microsoft sign-in enabled (client ID ${MS_CLIENT_ID.slice(0, 8)}…)`);
  process.exit(0);
}
const why = MS_CLIENT_ID ? `MS_CLIENT_ID "${MS_CLIENT_ID}" is not a valid Azure client ID` : 'MS_CLIENT_ID is empty in src/config.js';
if (process.env.SOLARIS_ALLOW_NO_MSA) {
  console.warn(`⚠ ${why} — building WITHOUT Microsoft sign-in (SOLARIS_ALLOW_NO_MSA is set).`);
  process.exit(0);
}
console.error(`✖ ${why}.\n  Players would not be able to sign in with Microsoft.\n  See README → "Microsoft sign-in (developer setup)", or set SOLARIS_ALLOW_NO_MSA=1 to build anyway.`);
process.exit(1);
