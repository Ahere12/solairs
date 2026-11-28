const os = require('os');
const { paths, readJSON, writeJSON } = require('./util');

const DEFAULTS = {
  language: 'en',
  theme: 'astra',
  accent: '#7c9cff',
  customTheme: { bg: '#0d0b12', panel: '#16131d', text: '#f4efe6' },
  launchBehavior: 'minimize', // keep | minimize | hide
  envVars: '', // KEY=value lines for every instance without its own
  hookPre: '', hookWrapper: '', hookPost: '', // launch hook defaults
  startMinimized: false,
  openAtLogin: false,
  minimizeToTray: false,
  doubleClickLaunch: true,
  notifications: true,
  showSnapshots: false,
  autoMemory: true,
  memoryMax: 4096,
  memoryMin: 512,
  javaPath: '',
  jvmArgs: '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M',
  performanceMode: false,
  dedicatedGpu: false,
  concurrency: 16,
  resolution: { width: 0, height: 0, fullscreen: false },
  discordRpc: true,
  // privacy & safety
  discordShowInstance: true,
  discordShowServer: true,
  discordShowHead: true,
  autoScanMods: true,
  confirmLogUpload: true,
  streamerMode: false,
  // Friends panel (people icon next to the account): toast when a friend comes online, check the servers they
  // play on every few minutes, and show friends who are offline in the list
  friendsNotify: true,
  friendsAutoCheck: true,
  friendsShowOffline: true,
  // integrations
  curseforgeKey: '',
  browseSource: 'modrinth',
  // java
  javaPaths: { 8: '', 17: '', 21: '' },
  javaAutoInstall: true,
  // performance & interface
  hardwareAcceleration: true,
  lowEndMode: false,
  layout: 'modern',
  colorMode: 'dark',
  instanceTabs: null,
  keybinds: {
    'nav.home': 'Ctrl+1', 'nav.library': 'Ctrl+2', 'nav.browse': 'Ctrl+3', 'nav.solaris': 'Ctrl+4',
    'nav.servers': 'Ctrl+5', 'nav.skins': 'Ctrl+6', 'nav.console': 'Ctrl+7', 'nav.friends': 'Ctrl+8', 'nav.settings': 'Ctrl+,',
    'play.selected': 'Ctrl+Enter', 'search.focus': 'Ctrl+K',
  },
  selectedInstance: null,
  firstRun: true,
};

const file = () => paths.file('settings.json');
let cache;
function get() {
  if (!cache) {
    const saved = readJSON(file(), {});
    delete saved.discordClientId; // now built in (src/config.js)
    // older versions shipped Rich Presence off because players had to paste their own app ID
    if (saved.discordRpc === false && !saved.discordRpcChosen) delete saved.discordRpc;
    // Solaris became Astra: everyone gets the Astra moon look once (theme, accent, background); they can pick
    // another one in Settings → Appearance afterwards. Light/dark mode and every other look setting stay.
    if (!saved.astraLook) {
      if (saved.theme !== 'dawn') saved.theme = 'astra';
      saved.accent = '#7c9cff';
      saved.gradientOn = false;
      if (saved.bgStyle !== 'image') saved.bgStyle = 'moon'; // their own background picture stays
      saved.astraLook = true;
      try { writeJSON(file(), saved); } catch {}
    }
    cache = { ...structuredClone(DEFAULTS), ...saved, keybinds: { ...DEFAULTS.keybinds, ...(saved.keybinds || {}) } };
  }
  return cache;
}
// ---------- API keys (CurseForge): sealed with the OS key store, never sent to the page ----------
// settings.json keeps only curseforgeKeySealed ("enc:<base64>", Electron safeStorage / Windows DPAPI). The page sees
// curseforgeConfigured: true/false and never the key. A plain-text key from older versions is sealed on first read.
const SECRET_FIELDS = ['curseforgeKey', 'curseforgeKeySealed'];
function safe() { try { const { safeStorage } = require('electron'); return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null; } catch { return null; } }
function sealKey(k) { const ss = safe(); return ss ? 'enc:' + ss.encryptString(k).toString('base64') : 'b64:' + Buffer.from(k).toString('base64'); }
function unsealKey(s) {
  try {
    if (!s) return '';
    if (s.startsWith('enc:')) { const ss = safe(); return ss ? ss.decryptString(Buffer.from(s.slice(4), 'base64')) : ''; }
    if (s.startsWith('b64:')) return Buffer.from(s.slice(4), 'base64').toString();
  } catch {}
  return '';
}
/**
 * Astra's own CurseForge key, built into the installer from src/builtin.local.json (git-ignored, so it never reaches
 * the GitHub source). Lightly scrambled so it isn't plain text in the app files. Empty in builds made without it.
 */
let builtin = null;
function builtinCurseforgeKey() {
  if (builtin !== null) return builtin;
  builtin = '';
  try {
    const j = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'builtin.local.json'), 'utf8'));
    const pad = Buffer.from('astra-launcher-cf'), x = Buffer.from(String(j.cf || ''), 'base64');
    builtin = Buffer.from(x.map((b, i) => b ^ pad[i % pad.length])).toString('utf8');
  } catch {}
  return builtin;
}
/** The CurseForge API key: the player's own (exactly as pasted), else Astra's built-in one. Main process only. */
function curseforgeKey() {
  const c = get();
  if (c.curseforgeKey) { // older versions kept it as plain text: seal it now
    const k = String(c.curseforgeKey);
    write({ curseforgeKey: '', curseforgeKeySealed: sealKey(k) });
    return k;
  }
  return unsealKey(c.curseforgeKeySealed) || builtinCurseforgeKey();
}
function setCurseforgeKey(k) { k = String(k || '').replace(/^\s+|\s+$/g, ''); write({ curseforgeKey: '', curseforgeKeySealed: k ? sealKey(k) : '' }); }
/** Settings as the page may see them: no secrets, just whether they're set. */
function forPage(s = get()) {
  const out = { ...s };
  for (const f of SECRET_FIELDS) delete out[f];
  out.curseforgeOwnKey = !!(s.curseforgeKey || s.curseforgeKeySealed);
  out.curseforgeBuiltIn = !!builtinCurseforgeKey();
  out.curseforgeConfigured = out.curseforgeOwnKey || out.curseforgeBuiltIn;
  return out;
}
/** Settings changes from the page (and most of Astra): secrets can't be set or wiped this way. */
function set(patch) {
  patch = { ...(patch || {}) };
  for (const f of SECRET_FIELDS) delete patch[f];
  return write(patch);
}
function write(patch) {
  cache = { ...get(), ...patch };
  if ('discordRpc' in patch) cache.discordRpcChosen = true;
  if (patch.keybinds) cache.keybinds = { ...DEFAULTS.keybinds, ...patch.keybinds };
  writeJSON(file(), cache);
  return cache;
}
function reset() { const keep = { curseforgeKeySealed: get().curseforgeKeySealed || '' }; cache = { ...structuredClone(DEFAULTS), ...keep }; writeJSON(file(), cache); return cache; } // a settings reset keeps the API key

/** Auto-size memory (MB) based on system RAM, a bit more for modded instances. */
function autoMemory(modded) {
  const gb = os.totalmem() / 1024 ** 3;
  let mb = gb <= 4 ? 1536 : gb <= 8 ? 3072 : gb <= 16 ? 4096 : 6144;
  if (modded && gb > 6) mb += 1024;
  return mb;
}

module.exports = { get, set, reset, DEFAULTS, autoMemory, curseforgeKey, setCurseforgeKey, forPage };
