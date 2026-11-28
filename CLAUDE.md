# Astra Launcher

- The launcher's name is **Astra**, not Solaris. Use "Astra" in all player-facing text (UI, toasts,
  dialogs, changelog, README, window titles). The built-in modpack is the **Astra Client**.
- "Solaris" was the old name. A few internal identifiers keep it on purpose so existing installs keep
  their data. Don't rename these:
  the `.solaris` data folder, the `SOLARIS_*` environment variables, the `window.solaris` preload bridge,
  the `solaris:*` API routes and `solarisModules` field, the `.solpack` extension, the `app.solaris.launcher`
  appId, and the Electron userData folder pinned to `Solaris` in `main.js`.
- This repo is the launcher **app** (Electron, no build step: `main.js`, `src/`, `renderer/`). Server-side
  work (e.g. the friends service behind `FRIENDS_API`) is separate.
