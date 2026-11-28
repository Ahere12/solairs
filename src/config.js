// Build-time configuration for Astra. DEVELOPER-ONLY — players never see or change this.
//
// MS_CLIENT_ID
//   The single Microsoft OAuth application (Azure "Application (client) ID") that every Astra
//   player signs in through. You, the Astra developer, register it ONCE and get it approved by
//   Mojang ONCE. A public client ID is not a secret; shipping it inside the app is standard practice
//   (it is how every third-party Minecraft launcher works). See README → "Microsoft sign-in (developer setup)".
//
//   Leave empty until Mojang has approved the app: the launcher then shows
//   "Microsoft sign-in isn't available in this version yet" instead of a broken button.
//
//   The SOLARIS_MS_CLIENT_ID environment variable overrides this value (for testing only).
//   Note: the Directory (tenant) ID is intentionally NOT used. Personal Microsoft accounts (the ones
//   that own Minecraft) sign in through the shared "consumers" endpoint; pinning the app's own tenant
//   would block every personal account.
//
// MS_REDIRECT_PORT / MS_REDIRECT_PATH
//   Must match the redirect URI registered on the app ("Mobile and desktop applications" platform):
//   http://localhost:25585/relogin. Use the hostname "localhost" — Microsoft rejects 127.0.0.1 here.
//
// FRIENDS_API
//   Base URL of the friends service (friend requests and live "In singleplayer" / "Playing on …" statuses).
//   See src/presence.js for the protocol. Leave empty to use the local friends list, where friends show as
//   online when Astra sees them on a server. SOLARIS_FRIENDS_API overrides it (testing only).
module.exports = {
  FRIENDS_API: '',
  MS_CLIENT_ID: process.env.SOLARIS_MS_CLIENT_ID || 'b014fe11-f01c-4e2e-b698-f4ad3dcddad5',
  MS_REDIRECT_PORT: 25585,
  MS_REDIRECT_PATH: '/relogin',
};
