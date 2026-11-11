const os = require('os');
const { paths, readJSON, writeJSON } = require('./util');

const DEFAULTS = {
  language: 'en',
  theme: 'solar',
  accent: '#ff9f1c',
  customTheme: { bg: '#0d0b12', panel: '#16131d', text: '#f4efe6' },
  launchBehavior: 'minimize', // keep | minimize | hide
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
  discordRpc: false,
  discordClientId: '',
  // privacy & safety
  discordShowInstance: true,
  discordShowServer: true,
  discordShowHead: true,
  autoScanMods: true,
  confirmLogUpload: true,
  streamerMode: false,
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
    cache = { ...structuredClone(DEFAULTS), ...saved, keybinds: { ...DEFAULTS.keybinds, ...(saved.keybinds || {}) } };
  }
  return cache;
}
function set(patch) {
  cache = { ...get(), ...patch };
  if (patch.keybinds) cache.keybinds = { ...DEFAULTS.keybinds, ...patch.keybinds };
  writeJSON(file(), cache);
  return cache;
}
function reset() { cache = structuredClone(DEFAULTS); writeJSON(file(), cache); return cache; }

/** Auto-size memory (MB) based on system RAM, a bit more for modded instances. */
function autoMemory(modded) {
  const gb = os.totalmem() / 1024 ** 3;
  let mb = gb <= 4 ? 1536 : gb <= 8 ? 3072 : gb <= 16 ? 4096 : 6144;
  if (modded && gb > 6) mb += 1024;
  return mb;
}

module.exports = { get, set, reset, DEFAULTS, autoMemory };
