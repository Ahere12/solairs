# Astra Phase 2 — Ecosystem expansion

Astra (formerly Solaris) grows from a launcher into a companion: mod health, server tools, an inbox, backups and
sync, third-party integrations, one search for all content, play analytics and a troubleshooting assistant.
Everything lives in `src/eco/` (main process) and `renderer/pages/eco-tools.js`, `renderer/pages/eco-hub.js`
(pages), and plugs into what already existed instead of replacing it.

Rules kept throughout: no simulated data or fake integrations (a feature that needs a service Astra doesn't have
says so), nothing changes the player's files without them pressing a button and confirming, and secrets never
leave the PC or enter a backup.

## 1. Audit — what Solaris Connect / 1.11 already had

| Requested | Already there (reused) | Missing → built in Phase 2 |
|---|---|---|
| Modpack Intelligence | Duplicate mods by mod id (`instances.duplicates`), Modrinth update checks (`modrinth.checkUpdates`), malware scan, crash rules | Dependency / version-range / loader / Minecraft checks from each jar's own metadata (incl. jar-in-jar), declared conflicts, health score, recommendations, pack comparison |
| Server Management 2.0 | Saved servers + favourites, Server List Ping, player-count history, Connect server monitoring | Software detection, step-by-step connection test, uptime statistics (online *and* offline samples), join history, server ↔ instance association, notes, per-server alerts |
| Notifications | Toasts, desktop notifications in Connect runtime and hosted-server alerts | One inbox with categories, read state, per-category on/off and desktop settings; all sources routed into it |
| Cloud & Sync | Hosted-server world backups | Versioned backups of settings/servers/friends/waypoints/instance setup, selective restore with a safety backup, sync through a cloud-drive folder |
| Developer Hub | Connect registry with definition validation, real status checks, error log, sealed secrets | Manifest spec + JSON schema, permission system with grants, compatibility checks, tester (validate + dry run), error report, install/uninstall |
| Discovery | Browse page (Modrinth or CurseForge, one at a time) | Both providers in one search, merged results, maps (CurseForge worlds) with a safe installer, community content (data packs, plugins, customization) |
| Analytics | Total play time per instance, world stats (Connect Stats) | Per-session records, play per day, instance/version usage, launch-time and crash-rate trends, servers played |
| AI Assistant | Crash rules on game exit | Crash/launcher-error/server diagnosis, suspect mods, reversible fixes, optional "Ask Claude" |

## 2. Roadmap and status

Each line is **done** only when the function exists and has a test that runs it (`npm test`).

| Step | Module | Status |
|---|---|---|
| 1 | Version ranges (`src/eco/semver.js`) — Fabric/Quilt predicates, Maven ranges | Done, tested |
| 2 | Modpack Intelligence (`src/eco/modpack.js`) + Health page | Done, tested; UI checked in Electron |
| 3 | Notifications (`src/eco/notify.js`) + title-bar inbox; Connect watcher, hosted alerts, backups, integration errors routed in | Done, tested; UI checked |
| 4 | Server Management 2.0 (`src/eco/serverinfo.js`) + Server details dialog | Done, tested (real offline ping); UI checked |
| 5 | Analytics (`src/eco/analytics.js`, session event from `launch.js`) + page | Done, tested; UI checked |
| 6 | Cloud & Sync (`src/eco/backup.js`) + page | Done, tested (backup → restore, sync folder round trip); UI checked |
| 7 | Discover (`src/eco/discovery.js`, `curseforge.installMap`) + page | Done, tested with fake providers; live Modrinth search checked in Electron. **Not verified live:** CurseForge results and map install (needs a CurseForge key). |
| 8 | Developer Hub (`src/eco/devhub.js`, `sdk/`) + page | Done, tested (validation, permissions, registry, install/uninstall) |
| 9 | Assistant (`src/eco/assistant.js`) + page, crash dialog button | Local diagnosis done and tested. "Ask Claude" request code tested with a fake client; **turned off in this build** because the Anthropic SDK isn't installed (see §4.8). |
| 10 | Minecraft / modpack update notifications (`src/eco/index.js`) | Done, tested with fake data |

Known limits (stated in the UI too): account-based cloud sync needs an Astra online service that doesn't exist, so
sync uses a folder your cloud drive syncs; FPS/memory trends need data the game doesn't give the launcher, so
"performance" means launch time, session length and crash rate; Bedrock worlds aren't read.

## 3. Where things are stored (in the Astra data folder)

| File | What |
|---|---|
| `notifications.json` | Inbox (newest 200) and category preferences |
| `server-uptime.json` | Ping samples per server address (31 days, ≤3000 each) and join history |
| `sessions.json` | Game sessions (newest 2000) |
| `backups/astra-backup-*.zip` | Backups (`astra-backup.json` inside describes each) |
| `backup-prefs.json` | Automatic backup and sync-folder settings |
| `integrations/<id>/` and `devhub.json` | Installed third-party integrations, granted permissions, recent checks |
| `assistant.json` | Ask Claude on/off and the API key, sealed with the OS key store |
| `eco-state.json` | Last seen Minecraft versions and modpack versions (for update notifications) |

## 4. API (renderer → main, `api(name, ...args)`)

All are in `src/eco/index.js` and merged into `src/api.js`. They return plain JSON or throw an `Error` with a
message meant for the player.

### 4.1 Modpack Intelligence
| Call | Returns |
|---|---|
| `modpack:check(instanceId)` | `{ instance, findings[], counts, health:{score,grade,label}, recommendations[], checkedAt }` |
| `modpack:checkUpdates(instanceId)` | same + `updates[]` (Modrinth) or `updatesError` |
| `modpack:compare(a, b)` | `{ a, b, onlyA[], onlyB[], different[], same }` |
| `modpack:findMissing(instanceId, modId)` | Modrinth candidates `[{ id, slug, title, exact }]` — nothing is installed |

Finding types: `missing-dependency`, `dependency-version`, `wrong-minecraft`, `wrong-loader`,
`wrong-loader-version`, `conflict` (error = "breaks"/"incompatible", warning = "conflicts"/"discouraged"),
`duplicate`, `unreadable`. Each has `fix.kind`: `install | enable | disable | disable-older | choose | update | loader`.

### 4.2 Servers
`srv:profile(id)` → `{ server, instance, uptime, hours[168], players[], joins[] }` ·
`srv:setProfile(id, { notes, instanceId, notify, name })` · `srv:live(address)` → ping + `software` ·
`srv:test(address, instanceId?)` → `{ ok, summary, steps[{id, ok, text, ms}], software }` (steps: address, srv,
dns, tcp, status, version, slots) · `srv:overview()`.

### 4.3 Notifications
`notify:list({category, unread, limit})`, `notify:unread()`, `notify:read(ids|'all')`, `notify:remove(id)`,
`notify:clear()`, `notify:prefs()`, `notify:setPrefs({ category: { enabled, desktop } })`.
Main-process event `notify:new` carries each new item. Categories: `friend, server, modpack, integration, backup,
minecraft`. Other modules add items with `require('./eco/notify').add({ category, title, body, key, action })`.

### 4.4 Backups & sync
`backup:list`, `backup:create({ note, instanceIds })`, `backup:preview(file)`, `backup:restore(file, { data:[...],
instances:[...] })`, `backup:remove(file)` (to the Recycle Bin), `backup:prefs`, `backup:setPrefs({ auto,
everyHours, keep, syncDir })`, `backup:chooseSyncDir`, `sync:state`, `sync:push`, `sync:preview`,
`sync:pull({ settings, servers })`, `sync:importBackup(name)`.

### 4.5 Developer Hub
`devhub:list`, `devhub:pick`, `devhub:check(folder)`, `devhub:dryRun(folder, config)`, `devhub:install(folder)`,
`devhub:grant(id, permission, on)`, `devhub:uninstall(id)`, `devhub:report(id)` (also copied to the clipboard).
Spec: [developer-hub.md](developer-hub.md).

### 4.6 Discover
`discover:kinds()`, `discover:search({ kind, query, sort, gameVersion, loader, limit, offset })` →
`{ results[], providers[{provider, ok, why|total}] }`, `discover:install({ provider, id, kind, instanceId, world })`.
Kinds: `mod, modpack, resourcepack, shader, map, community`.

### 4.7 Analytics
`analytics:overview()` → `{ totals, perDay[30], instances[], versions[], weeks[8], crashes[], servers[], recent[] }`,
`analytics:sessions({ instanceId, limit })`, `analytics:worlds()`, `analytics:clear()`.
Sessions come from the main-process event `game:session` emitted by `launch.js` when a game exits.

### 4.8 Assistant
`assistant:crash({ text, instanceId } | { runId })`, `assistant:error(message)`, `assistant:server(address,
instanceId)`, `assistant:apply(action)` (only `disable-mod`, `enable-mod`, `repair` — all reversible; the UI asks
first), `assistant:settings`, `assistant:setSettings({ enabled, key, clearKey })`, `assistant:preview(input)`
(exactly what would be sent), `assistant:ask(input)`.

"Ask Claude" uses the official Anthropic SDK (`@anthropic-ai/sdk`), model `claude-opus-5-5`, effort `medium`,
with server-side refusal fallback (`fallbacks: "default"`). It is only active when the SDK is installed **and**
the player turned it on with their own key. To enable it in a build: `npm install @anthropic-ai/sdk` in the
`solaris` folder (it ships with the app because `node_modules/**` is packaged). What is sent: the crash/log
excerpt with the user name, home folder, access tokens, public IPs and e-mail addresses removed, the mod list
(ids and versions), and Astra's own findings.

## 5. Changes to existing files (all small, behaviour kept)

- `src/servers.js` — every ping also records an uptime sample; Forge/NeoForge mod data kept for detection;
  `updatedAt` on saved servers; deleting a server is remembered so sync doesn't bring it back.
- `src/connect/watch.js` — servers with "Alerts" on are watched along with favourites.
- `src/connect/runtime.js` — monitor alerts go through the inbox (same toast + desktop pop-up as before).
- `src/connect/registry.js` — optional `onError` hook; views carry `thirdParty`.
- `src/connect/index.js` — Developer Hub integrations join the registry; `reload()`.
- `src/hostserver.js` — backup saved / automatic backup failed → inbox.
- `src/launch.js` — emits `game:session` on exit (launch time, crash cause, server/world).
- `src/curseforge.js` — map (world) and customization classes; `installMap` (safe unzip into `saves/`).
- `src/crash.js` — `explainText(text)` for pasted reports.
- `src/api.js`, `main.js` — ecosystem calls and `eco.init()`.
- Renderer: Discover in the sidebar; Analytics, Assistant, Backups & Sync in the tools row; bell in the title bar;
  Health button on modded instances; Server details (ⓘ) on saved servers; "Ask the Assistant" in the crash dialog;
  Developer Hub button on Connect.

## 6. Phase 3 — reliability pass (2026-11-15)

Found by testing with real data and fixed:

- **Version ranges:** `<1.20.2-` (Fabric's "below 1.20.2, pre-releases included", used by Fabric API) was read as
  "below 1.20-pre", so every modern Fabric API was wrongly flagged on 1.20.1. Found with real Modrinth jars.
- **Duplicates:** "keep the newest" kept a copy made for another Minecraft version; now the newest copy that fits
  this instance is kept. Copies of one mod no longer "conflict" with each other through `provides`.
- **Freeze:** the first check of a 250-mod pack blocked Astra for 2.7 s (every jar read in one go); now one jar at
  a time — longest pause ~0.1 s.
- **Servers:** CubeCraft-style proxies that send an empty legacy `modinfo` were reported as "Forge (certain)";
  connection tests stored uptime under the SRV target instead of the typed address; "full" servers (2b2t) are a note,
  not a failure.
- **Play time:** Astra counted a still-running game's play time twice when it had to wait for hosted servers before
  quitting (pre-existing). Sessions cut short by quitting are recorded once, marked "Astra closed".
- **Backups:** mod config files with passwords, tokens or webhooks are left out (listed in the restore dialog); two
  backups in the same second no longer overwrite each other; a failing automatic backup waits for the next period.
- **Developer Hub:** answers are capped while downloading (not after), local-network hosts (`.lan`, `.local`,
  `localhost`, …) can't be requested, error reports no longer include API answers.
- **Discover:** identical searches within 2 minutes come from memory; rate limits and offline errors in plain words.
- **Shutdown:** unsaved uptime samples are written and background timers stopped when Astra quits.
- **UI:** saved servers show 7-day uptime; loader-version findings get a button; one toast per backup; the
  Developer Hub opens its guide and example (now packaged with the app); consistent page headers.

Tested against live services: Modrinth (search, hash-based update check, mod and resource-pack installs with SHA-1
verification), Mojang-protocol pings to Hypixel, CubeCraft and 2b2t, real DNS failures and closed ports.
Not tested live: CurseForge (no API key available), map installs, "Ask Claude" (SDK not installed), a real cloud
drive syncing between two PCs, the per-server alert firing on a real outage.

## 7. Tests

`npm test` — 71 tests (30 from before Phase 2, 41 new): `test/modpack.test.js`, `test/eco-servers-notify.test.js`, `test/eco-reliability.test.js`,
`test/eco-data.test.js`, `test/eco-devhub-assistant.test.js`. They use real jar files, a real data folder in the
temp directory, and fake network providers where a live service would be needed.
