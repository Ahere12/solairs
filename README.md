# ☀️ Solaris

A fast, modern launcher for Minecraft: Java Edition. It's built with Electron and has no build step.

## Run it

```bash
npm install
npm start
```

To build a Windows installer, run `npm run dist`. The installer is written to `dist/`. Run `npm run dist:linux` on Linux (AppImage + .deb), or `npm run dist:mac` on a Mac.

## Features

| Area | What you get |
|---|---|
| **Launching** | Every release, snapshot and old version. Java is installed automatically using Mojang's official runtimes. You can run several instances at once. Quick Play (join a server or open a world directly), automatic memory sizing, performance mode, a dedicated-GPU option, and a choice of keep, minimize or hide while you play |
| **Instances** | Fabric, Quilt, Forge, NeoForge and Legacy Fabric. Loaders only appear on versions they support. Custom icons, pin to top, duplicate with a choice of what to copy, share as `.solpack`, play-time tracking, per-instance Java, memory, JVM arguments and resolution |
| **Imports** | `.mrpack` modpacks, `.solpack` files, the official launcher, and MultiMC/Prism. You can drag and drop files |
| **Content** | A Modrinth browser for mods, modpacks, resource packs, shaders and datapacks, with a version picker, automatic dependencies and category filters. Select many items with Ctrl/Shift and enable, disable or delete them together. Hash-based update checks, duplicate-mod detection and a heuristic malware scan |
| **Solaris Client** | A one-click Fabric modpack (Sodium, Lithium, FerriteCore, Zoomify, AppleSkin and more) that updates itself on every launch. You can turn each module on or off |
| **Servers** | Live ping, player counts, MOTD and favicons. Region and tag filters, favourites, copy IP, one-click join, and a player-count history chart |
| **Skins** | A 3D preview (skinview3d), a wardrobe, adding a skin from a file or a username, a staged Apply step, and cape switching (Microsoft accounts) |
| **Troubleshooting** | A live console with filters, a plain-language crash assistant with hex exit codes, log sharing to mclo.gs, and a hosts-file check |
| **Interface** | Themes (Solar, Eclipse, Nebula, Dawn and Custom), any accent colour, editable keybinds, back and forward with the mouse or Alt+arrows, five languages, a gallery, a tray menu, start on login, and in-app changelog and roadmap pages |
| **Storage** | Disk usage by category, cleanup, repair, and moving the data folder to another location |

## Microsoft accounts

**For players:** click **Sign in with Microsoft**, sign in and approve on Microsoft's page, and Solaris finishes automatically. There's no Azure account, client ID or form to fill in. If the browser can't reach this computer, "Use a code instead" lets players sign in from any device.

**What happens behind the scenes:**

1. Solaris opens Microsoft's sign-in page in the browser. It uses the OAuth 2.0 authorization code flow with PKCE and a loopback redirect to `http://localhost:<random port>` (RFC 8252).
2. The Microsoft token is exchanged for an Xbox Live token, then an XSTS token.
3. The XSTS token is used for `api.minecraftservices.com/authentication/login_with_xbox`.
4. Solaris fetches the Minecraft profile. If there's no profile, it checks the store entitlements to tell "doesn't own Minecraft" apart from "hasn't picked a username yet".

Tokens are encrypted with the operating system's keychain through Electron `safeStorage`. Refresh tokens renew sessions silently.

### Microsoft sign-in (developer setup, one time)

Every player signs in through **one** OAuth app that the Solaris developer owns. Microsoft and Mojang require this app to exist and be approved. That's done once by the developer, never by players:

1. **Register the app** (free, needs any Microsoft account) at [Azure app registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → **New registration**:
   - Name: `Solaris`
   - Supported account types: **Personal Microsoft accounts only**
   - Under **Authentication**, add the platform **Mobile and desktop applications** with the redirect URI `http://localhost`
   - Under **Authentication**, set **Allow public client flows** to **Yes**
   - No client secret and no API permissions are needed.
2. **Request Minecraft access from Mojang:** submit the app's client ID at <https://aka.ms/mce-reviewappid>.
   - New app IDs are blocked from Minecraft Services until Mojang approves them. Before approval, Microsoft and Xbox sign-in succeed but `login_with_xbox` returns **HTTP 403**.
   - Solaris shows players "still being enabled by Mojang" in that case.
   - Approval is manual and can take days to weeks.
3. **Ship it:** put the client ID in [`src/config.js`](src/config.js) as `MS_CLIENT_ID`, then run `npm run dist`.
   - A public client ID is not a secret, so shipping it in the app is safe. Every third-party launcher does this.
   - `npm run dist` refuses to build without a valid ID. Set `SOLARIS_ALLOW_NO_MSA=1` to build anyway; that build tells players Microsoft sign-in is coming in an update.

**What must not be done:** reusing another launcher's client ID, or the official Minecraft Launcher's ID. That impersonates someone else's app and breaks Microsoft's and Mojang's terms.

**Testing:** run `tools/auth-test.js` to check the whole flow (redirect, state check, PKCE, cancel, device code, error messages) without real credentials. To try it before release, set `SOLARIS_MS_CLIENT_ID=<id>` when you run `npm start`.

## Discord Rich Presence

Built in: Solaris uses its own Discord application (ID set in `src/config.js` → `DISCORD_CLIENT_ID`), so players only switch it on or off in **Settings → Integrations**. The Discord application needs an Art Asset named `solaris` (Developer Portal → Rich Presence → Art Assets) for the launcher logo to show.

## Layout

```
main.js / preload.js     Electron main process and a secure IPC bridge
src/                     launcher core (versions, java, loaders, launch, accounts, modrinth, servers, skins …)
renderer/                UI (vanilla JS pages, no framework)
data/                    changelog.json and roadmap.json shown in the app
tools/                   icon generator, smoke test, end-to-end launch test
```

Data is stored in `%APPDATA%\.solaris` on Windows and `~/.config/.solaris` on Linux by default. Set `SOLARIS_DATA_DIR` to use a portable folder.

Solaris is not affiliated with Mojang Studios or Microsoft.

## Releasing an update

Solaris updates itself from GitHub Releases on `Ahere12/solairs` (electron-updater, `src/updater.js`). It checks on start and every 4 hours, downloads in the background (progress card in the sidebar + titlebar chip), then offers **Restart & update**. If the player picks "Later", the update installs when Solaris closes.

1. Bump `version` in `package.json` (e.g. 1.6.0 → 1.7.0), commit and push.
2. `npm run dist`
3. Create a GitHub release with tag `v1.7.0` (published, not a draft) and upload these files from `dist/`: `Solaris-Setup-1.7.0.exe`, `Solaris-Setup-1.7.0.exe.blockmap`, `latest.yml`.
4. The Linux build happens by itself: publishing the release starts the **Linux build** GitHub workflow (`.github/workflows/linux.yml`), which builds `Solaris-1.7.0-x86_64.AppImage` and `solaris_1.7.0_amd64.deb` on Ubuntu and adds them, with `latest-linux.yml`, to the same release. It can't be built on Windows, because the AppImage needs Linux symbolic links. For an older release, run the workflow by hand from the Actions tab.

### Linux

- **AppImage** (any 64-bit distro): `chmod +x Solaris-*.AppImage`, then run it. It updates itself.
- **.deb** (Ubuntu, Debian, Mint, Pop!_OS): `sudo apt install ./solaris_*_amd64.deb`. Updates download in the app and ask for your password to install.
- The AppImage starts through a small wrapper (`tools/after-pack.js`) that adds `--no-sandbox` only where the system blocks Chromium's sandbox (Ubuntu 24.04+ AppArmor). Without it, the AppImage wouldn't open there.
- Data lives in `~/.config/.solaris` (Electron's `appData`), and Java comes from Mojang's Linux runtimes or the system (`/usr/lib/jvm`, `java` on PATH).

Players on older versions see the download animation within a few seconds of opening Solaris. To preview the animation without a release, run `SOLARIS_FAKE_UPDATE=1 npm start`.
