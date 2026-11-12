// Build-time configuration for Solaris. DEVELOPER-ONLY — players never see or change this.
//
// MS_CLIENT_ID
//   The single Microsoft OAuth application (Azure "Application (client) ID") that every Solaris
//   player signs in through. You, the Solaris developer, register it ONCE and get it approved by
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
// DISCORD_CLIENT_ID
//   Solaris's own Discord application for Rich Presence (hidden from players).
//
// MS_REDIRECT_PORT / MS_REDIRECT_PATH
//   Must match the redirect URI registered on the app ("Mobile and desktop applications" platform):
//   http://localhost:25585/relogin. Use the hostname "localhost" — Microsoft rejects 127.0.0.1 here.
module.exports = {
  MS_CLIENT_ID: process.env.SOLARIS_MS_CLIENT_ID || 'b014fe11-f01c-4e2e-b698-f4ad3dcddad5',
  MS_REDIRECT_PORT: 25585,
  // Discord application used for Rich Presence. Built in — players never see or change it.
  // The Discord app needs an Art Asset named "solaris" (Rich Presence → Art Assets).
  DISCORD_CLIENT_ID: '1569976377271124049',
  MS_REDIRECT_PATH: '/relogin',
};
