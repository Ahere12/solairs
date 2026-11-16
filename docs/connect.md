# Astra Connect

Astra Connect is the page (sidebar → **Connect**) that lists every service Astra connects to — maps, friends,
servers and player tools — and shows whether each one **really works right now**.

Rules every integration follows:

- **Real status only.** A status comes from an actual check (a running server, a connected agent, a saved file).
  If the check fails or hangs, the integration shows *Problem* with the reason — never a made-up "connected".
- **Not built = "Planned".** An integration that is on the way is listed under **Discover** as *Planned* and can't be turned on (right now everything is built).
- **Needs a service Astra doesn't have = "Unavailable".** Astra has no online accounts or servers of its own, so
  features like a Astra-wide online status or an in-app invite inbox are listed as *Unavailable*, with what to use instead.
- **Secrets stay on this PC.** Secret settings are sealed with the operating system's key store (Electron
  `safeStorage`) before they are saved, and the page only ever sees "set" / "not set".

## Statuses

| Status | Meaning |
|---|---|
| Connected | Working right now (e.g. Discord is connected, a server with voice chat is running). |
| Ready | Set up; nothing is happening right now (e.g. voice chat is on a server that's stopped). |
| Needs setup | You have to do something first — the status says what. |
| Off | You turned it off. |
| Problem | Something went wrong — the status says what, and recent problems are listed in its details. |
| Unavailable | Can't work here — the status says why. |
| Planned | Not built yet. |

## The integrations

### Social

#### Discord Rich Presence
Shows what you play on your Discord profile (instance, server or world, servers you host). This is the same switch as
**Settings → Discord Rich Presence**; the privacy options (instance name, server/world, head) are shared too.
*Connected* when the Discord app is running and Astra is connected to it.

#### Friends
Players you follow, looked up through Mojang's public profile API (offline friends need no lookup). Minecraft: Java
Edition has no official "online friends" service, so a friend shows as online when Astra sees them in the live
player list of a server it checked — your hosted servers, favourites or servers you pinged.

#### Invite links
`solaris://server/<address>` links and `JOIN-…` codes. Send one through any chat; in the friend's Astra it opens the
right server (and warns when their account type won't be allowed). Bedrock servers are shared by address and port.

#### Astra online status & inbox — *Unavailable*
Would need an online Astra service. Use invite links, join codes and Discord instead.

### Server integrations

#### Server status
Live status, player counts, version and ping for any Java server, using Minecraft's own Server List Ping protocol.

#### Server monitoring
Off until you turn it on. Every few minutes (1–60, default 5) Astra pings the servers you saved — your
**favourites**, or **all saved servers** — with Server List Ping, and tells you when one **comes online**, **goes
offline**, or **a friend joins it**. Its details show a live table: status, players, ping and how long it's been that way.

- A server that doesn't answer is shown as *offline* with the reason (timed out, refused…); that's never a Astra error.
- Friends are spotted from the player names the server shares. Servers only share some names (often up to 12), so
  a friend on a big server can be missed.
- The alert is a message inside Astra, plus a desktop notification when Astra is in the background or the tray
  (and **Settings → Notifications** is on). Clicking it offers to join that server.

#### Desktop alerts
For servers you host: a desktop notification when a server **goes online** or **crashes** (on by default), or
**stops**, or **a player joins / leaves** (off by default). Only while Astra isn't the window in front — inside
Astra you already see it. Needs **Settings → Notifications** on. (For a Discord channel instead, use a server's
**Settings → Discord alerts**.)

#### Hosting
Servers that run on this PC (Paper, Purpur, Vanilla, modpacks, Fabric, Quilt, Forge, NeoForge and Bedrock):
console, players, backups, scheduler, performance graph, crash help and alerts.

#### playit.gg, e4mc, Simple Voice Chat, Bedrock players (Geyser), Bedrock Dedicated Server, Discord server alerts, spark
Each wraps the matching Hosting feature. Their details show **which of your servers can use them** (for example, Geyser
runs on Paper, Purpur, Fabric, Quilt and NeoForge, but not on Vanilla, Forge or Bedrock servers) and link to the
project's own documentation.

### Player utilities

#### Skins
3D skin viewer and wardrobe. Changing your real skin and cape needs a Microsoft account; offline accounts' skins show in
Astra and in modded games (through CustomSkinLoader).

#### Screenshots
Every screenshot from every instance, in **Gallery**.

#### Player statistics
The **Stats** page (Astra Connect → Player statistics & advancements → Open in Astra, or a hosted server →
Players → a player's menu → **Stats & advancements**) shows, for every player of every Java world Astra knows — your
instances' singleplayer worlds and your hosted servers' worlds:

- play time, deaths, mobs killed, distance travelled (falling doesn't count), flown, jumps, blocks mined, items crafted,
  time since the last death, villager trades;
- most mined blocks, most killed mobs, what killed them, most crafted items;
- advancements: which are done (with the date), which aren't yet, by tab, and *X of Y*;
- **All worlds**: play time per player added up across worlds.

Everything is read on this PC from the world's own files; nothing is sent anywhere (except asking Mojang for the name
of a player ID Astra doesn't know, for real accounts only).

| File | What |
|---|---|
| `<world>/stats/<uuid>.json` | the numbers (Minecraft 1.13+; play time was `play_one_minute` before 1.17, `play_time` since) |
| `<world>/advancements/<uuid>.json` | done / not done, with the time each step was reached (recipes are left out) |
| `<world>/level.dat` | world name, version, game mode, day, last saved — Minecraft's binary save format (NBT), read by `src/connect/nbt.js` |
| the game's jar (`versions/<mc>/<mc>.jar`) | which advancements exist and their English names (`data/minecraft/advancement[s]/`, `assets/minecraft/lang/en_us.json`). Without it, done ones are still listed, with names made from their ids, and the total is unknown. |

Notes: Microsoft and offline accounts have different player IDs, so the same name can show twice (the game keeps
separate stats). Names come from the server's `usercache.json`, your accounts and friends. Bedrock worlds use another
format and aren't read.

#### Inventory viewer
On the **Stats** page, a player → **Inventory** (or a hosted server → Players → a player's menu → **Inventory**):
their inventory, hotbar (the selected slot is marked), armour, off hand and ender chest, with real item names and
pictures; click an item for its custom name, enchantments, durability and — for shulker boxes and bundles — what's inside.
Also health, food, XP level, game mode, dimension and position.

**Who can see what:** only worlds whose save files are on this PC — servers you host and your own singleplayer
worlds. That's the permission: Astra can't (and doesn't try to) look into other people's servers. It's read-only.

While a hosted server runs, players' files are written when it saves (every few minutes, and when they leave);
**Save & refresh** asks the server to save (`save-all`) and reads again.

| Where | What |
|---|---|
| `<world>/playerdata/<uuid>.dat` | a server player's save (NBT) |
| `<world>/level.dat` → `Data.Player` | the player of a singleplayer world |
| items 1.20.5+ | `id`, `count`, `components` (`custom_name`, `enchantments` / `stored_enchantments`, `damage`, `max_damage`, `container`, `bundle_contents`) |
| items before 1.20.5 | `id`, `Count`, `tag` (`display.Name`, `Enchantments`, `Damage`, `BlockEntityTag.Items`) |
| armour / off hand | 1.21.5+: `equipment` (`head`, `chest`, `legs`, `feet`, `offhand`); before: inventory slots 103–100 and −106 |
| names and pictures | the game jar: `assets/minecraft/lang/en_us.json`, `textures/item/…`, or the texture the item's model uses |

Durability shows as "used / max" when the item carries its maximum, otherwise how much is used (the game keeps the
maximum in its code, not in the save). Modded items show with their id as name and no picture.

#### Play time
Play time per instance (Library), per player on your hosted servers (server → Players), and per player in each
world (Stats).

#### Worlds
Singleplayer worlds per instance, and hosted servers' worlds (switch, import, reset, back up).

### Maps & navigation

#### Web maps — BlueMap, Pl3xMap, Dynmap
Web maps draw your world and show it as a web page, with players moving on it live. Astra supports three; a server
has one at a time (turning one on turns the other off — two maps would both draw the whole world).

| Map | Looks like | Runs on | Modrinth | Web map (default port) |
|---|---|---|---|---|
| [BlueMap](https://bluemap.bluecolored.de/wiki/) | 3D, real textures | Paper, Purpur, Fabric, Forge, NeoForge | `swbUV1cr` | 8100 |
| [Pl3xMap](https://github.com/granny/Pl3xMap/wiki) | fast flat map | Paper, Purpur, Fabric, Quilt | `34T8oVNY` | 8080 |
| [Dynmap](https://github.com/webbukkit/dynmap/wiki) | classic flat / 3D-ish views | Paper, Purpur, Fabric, Forge | `fRQREgAc` | 8123 |

(Whether a build exists for your exact Minecraft version is up to each project — Astra says so if there's none.)

**On a server you host**: server → **Map** tab → pick a map → **Turn on**. Astra installs it from Modrinth and gives
its web map a free port. The map writes its own settings on its first start; when the server has started, Astra sets
the port in them and reloads the map:

| Map | Settings file | What Astra sets | Reload |
|---|---|---|---|
| BlueMap | `plugins/BlueMap/` or `config/bluemap/` → `core.conf`, `webserver.conf` | `accept-download: true` (only after you agreed), `port` | `bluemap reload` |
| Pl3xMap | `plugins/Pl3xMap/config.yml` or `config/pl3xmap/config.yml` | `settings.internal-webserver.port`, `settings.web-address` | `map reload` |
| Dynmap | `plugins/dynmap/configuration.txt` or `dynmap/configuration.txt` | `webserver-port` | `dynmap reload` |

BlueMap's `accept-download` means you accept Mojang's EULA and let BlueMap download the Minecraft client file it needs
for the textures — BlueMap draws nothing without it, and Astra only sets it after you ticked that box. Pl3xMap and
Dynmap don't download anything from Mojang.

The map then shows in the **Map** tab and on the **Maps** page (Astra Connect → a map → Open in Astra), with
**Open in browser** and **Copy LAN link** (for people on your Wi-Fi). It isn't shared with friends outside your network
yet. **Turn off the map** disables it on the server; the drawn map stays on disk.

**Map links**: many servers have a public web map. Paste its address on the **Maps** page; Astra works out which of
the three it is, saves it only if it really is one, and shows whether it's online and who is on it.

What Astra reads (the same addresses each map's own web page uses):

| Map | Address | What |
|---|---|---|
| BlueMap | `/settings.json` | the maps (`maps`) and where their data is (`mapDataRoot`, `liveDataRoot`) |
| BlueMap | `/maps/<map>/settings.json` | that map's name |
| BlueMap | `/maps/<map>/live/players.json` | players with their position (players in other worlds are `foreign` and left out) |
| Pl3xMap | `/tiles/settings.json` | the worlds (`worldSettings`) and the players (`players`, with `world` and `position`; hidden players have no position and are left out) |
| Dynmap | `/up/configuration` | the worlds (`worlds`) |
| Dynmap | `/up/world/<world>/<time>` | the players, each with their world and position (hidden ones are in `-some-other-bogus-world-` and left out) |

#### Waypoints
**Waypoints** page (Astra Connect → Waypoints & coordinates → Open in Astra, or a player on the Stats page → **Waypoints**):

- **Your waypoints**: name, X / Y (optional) / Z, dimension, colour, note — grouped by place (a server you host, one
  of your singleplayer worlds, a saved server, or anywhere). Kept on this PC (`waypoints.json` in the data folder).
- **From your save files**: the world spawn, and for a player where they are, their last death and their bed /
  respawn point — one click saves it as a waypoint.
- **Sharing**: tick waypoints → **Copy code** (`ASTRA-WP-…`, a short compressed code without your places); friends
  paste it in **Paste a code**. Plain coordinates work too: "Base 120 64 -340", "x: 100, z: -5", "/tp @s 1 2 3".
  Per waypoint: copy for chat, or copy an `/execute in <dimension> run tp @s x y z` command.
- **On a server you host that is running**: **Teleport** an online player to the waypoint (`/execute in … run tp`),
  or post it in the server chat (`/say`).

| Save field | What |
|---|---|
| `level.dat` → `Data.spawn` {`pos`, `dimension`} (1.21.9+) or `Data.SpawnX/Y/Z` | world spawn |
| player `Pos` + `Dimension` | where the player is |
| player `LastDeathLocation` {`pos`, `dimension`} (1.19+) | last death |
| player `respawn` {`pos`, `dimension`} (1.21.5+) or `SpawnX/Y/Z` + `SpawnDimension` | bed / respawn point |

Minimap mods (Xaero's, JourneyMap) keep their own waypoint files; Astra doesn't write into them.

## For developers

### Where things are

| File | What |
|---|---|
| `src/connect/registry.js` | The registry: checks definitions, keeps on/off + settings + recent errors, runs status checks (5 s timeout). No Electron — tested on its own. |
| `src/connect/integrations.js` | Astra's integrations. |
| `src/connect/index.js` | The app's registry: storage in `connect.json` in the Astra data folder, secrets through `safeStorage`. `init()` starts the background parts (called by `main.js` 6 s after start). |
| `src/connect/watch.js` | Server monitoring (no Electron, no network of its own — ping and notify are passed in). |
| `src/connect/webmap.js` | Web maps: install / turn on and off per hosted server (one at a time), ports, the map's settings files, the live check, map links. Hooks into Hosting through `hostserver.hooks` (before start, each log line). |
| `src/connect/maps/*.js` | One file per map type (BlueMap, Pl3xMap, Dynmap): where its settings are, how to set them, how to read its web map. Each starts with what was checked in that project's source. |
| `renderer/pages/maps.js` | The Maps page and the hosted server **Map** tab. Maps are shown in a sandboxed frame (the app allows frames from http/https for this). |
| `src/connect/nbt.js` | Reads Minecraft's binary save format (NBT) — read-only. |
| `src/connect/saves.js` | Worlds Astra knows, players in them, stats, advancements (with the game jar's list and names), play time across worlds. |
| `src/connect/inventory.js` | The inventory viewer (read-only). |
| `src/connect/gamejar.js` | Names and item pictures from the game jar. |
| `renderer/pages/stats.js` | The Stats page (stats, advancements, inventory). |
| `src/connect/waypoints.js` | Waypoints: saving, places from save files, share codes and plain-text coordinates, /tp and /say on servers you host. |
| `renderer/pages/waypoints.js` | The Waypoints page. |
| `src/connect/runtime.js` | The background parts: the watcher with the real ping, desktop notifications, and the listener for Hosting's `hosted:event` (sent from `notifyDiscord` in `src/hostserver.js` for online / stop / crash / join / leave). |
| `src/api.js` | `connect:list`, `connect:get`, `connect:status`, `connect:setEnabled`, `connect:setConfig`, `connect:clearErrors`, `connect:compatibility`, `connect:details`. |
| `renderer/pages/connect.js` | The page (Installed / Discover, categories, search, details with settings and live tables). |
| `test/connect.test.js`, `test/watch.test.js`, `test/webmap.test.js`, `test/saves.test.js`, `test/inventory.test.js`, `test/waypoints.test.js` (test save files are made with `test/helpers/nbt-writer.js`) | Tests — run `npm test`. The watcher is also tested against a small fake Minecraft server. |

### Adding an integration

Add an object to `INTEGRATIONS` in `src/connect/integrations.js`:

```js
{
  id: 'bluemap',                         // unique: lowercase letters, digits, dashes
  name: 'BlueMap',
  description: '3D web map of a server’s world.',
  icon: 'roadmap',                       // a name from renderer/lib/icons.js or core.js
  category: 'maps',                      // maps | social | servers | player
  type: ['plugin', 'mod', 'dashboard'],  // mod | plugin | api | local | dashboard (one or more)
  docs: 'https://…',                     // https only
  page: 'host',                          // optional: "Open in Astra" goes here
  compat: { software: ['paper', 'fabric'], why: (server) => '…' }, // optional: which hosted servers can use it
  config: [                              // optional settings
    { key: 'url', label: 'Map link', type: 'url' },               // text | url | number | bool | select | secret
    { key: 'token', label: 'Access token', type: 'secret' },      // sealed, never sent to the page
    { key: 'showX', label: '…', type: 'bool', from: { get, set } } // stored somewhere else (e.g. settings.json)
  ],
  core: true,                            // part of Astra, always on   — or —
  defaultEnabled: false,                 // the player turns it on       — or —
  toggle: { get, set },                  // on/off lives somewhere else (e.g. a setting)
  onToggle(on) {}, onConfig(config) {},  // optional hooks
  async status({ config }) {             // REQUIRED unless planned/unavailable — a real check
    return { state: 'connected', text: 'Map is online' };
  },
  details({ config }) {                  // optional: a live table in the details window (only while it's on)
    return { columns: ['Server', 'Status'], rows: [['Alpha', 'Online']], note: 'Last checked just now.' };
  },
}
```

Background work reads an integration's settings with `active(id)` (the settings while it's on, otherwise `null`),
so turning an integration off stops its background work at its next step.

A planned integration has `planned: true` (or a sentence) and no `status`; one that can't work has
`unavailable: 'why'`. Then add a test to `test/connect.test.js` and a section to this file.
