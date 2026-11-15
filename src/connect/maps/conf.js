// Small config-file helpers for the web map add-ons.

/** Sets one top-level `key: value` line (HOCON .conf or flat YAML), keeping everything else and the comments. */
function setConf(text, key, value) {
  const re = new RegExp(`^([ \\t]*)${key.replace(/[-]/g, '\\-')}[ \\t]*:[ \\t]*[^\\n#]*`, 'm');
  return re.test(text) ? text.replace(re, `$1${key}: ${value}`) : `${text.replace(/\s*$/, '')}\n${key}: ${value}\n`;
}
/** Reads one top-level `key: value` (same files). */
function getConf(text, key) {
  const m = String(text).match(new RegExp(`^[ \\t]*${key.replace(/[-]/g, '\\-')}[ \\t]*:[ \\t]*([^\\n#]*)`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

module.exports = { setConf, getConf };
