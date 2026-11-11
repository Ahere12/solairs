// Plain-language crash explanations.
const fs = require('fs');
const path = require('path');

const RULES = [
  { re: /java\.lang\.OutOfMemoryError|Could not reserve enough space|There is insufficient memory/i,
    title: 'Out of memory', fix: 'Increase the memory for this instance (Instance → Settings → Memory), or close other programs. With many mods, 4–6 GB is typical.' },
  { re: /UnsupportedClassVersionError|class file version (\d+)/i,
    title: 'Wrong Java version', fix: 'This version or a mod needs a newer Java. Clear the custom Java path so Solaris picks the right runtime automatically.' },
  { re: /Incompatible mods? found|Mod resolution encountered an incompatible|requires (?:version .* of )?['"]?(fabric(?:-api|loader)?|[\w-]+)/i,
    title: 'Missing or incompatible mod dependency', fix: 'A mod needs another mod (often Fabric API) or a different version. Check the log lines above for the exact requirement and install it from Browse.' },
  { re: /Missing or unsupported mandatory dependencies|Mod .* requires/i,
    title: 'Missing mod dependency (Forge/NeoForge)', fix: 'Install the mods listed as required, matching your Minecraft version.' },
  { re: /Duplicate mods? found|found a duplicate mod|DuplicateModsFoundException/i,
    title: 'Duplicate mods', fix: 'Two copies of the same mod are installed. Open the instance → Content → Tools → Find duplicate mods, and remove the older one.' },
  { re: /Mixin (?:apply|transformation) .*failed|MixinApplyError|InvalidInjectionException|Critical injection failure/i,
    title: 'Mod conflict (Mixin failure)', fix: 'A mod is incompatible with this version or with another mod. The mod named in the error is the likely culprit — update or disable it.' },
  { re: /Pixel format not accelerated|GLFW error 65542|WGL: The driver does not appear to support OpenGL|OpenGL 3\.2/i,
    title: 'Graphics driver problem', fix: 'Update your GPU drivers from NVIDIA/AMD/Intel. On laptops enable "Use dedicated GPU" in Settings.' },
  { re: /EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime/i,
    title: 'Native crash', fix: 'Usually caused by graphics drivers, overlays (Discord, RivaTuner) or shader mods. Update drivers and try disabling shaders/overlays.' },
  { re: /ClassNotFoundException|NoClassDefFoundError|NoSuchMethodError|NoSuchFieldError/i,
    title: 'Mod built for a different version', fix: 'A mod was made for another Minecraft or loader version. Use Content → Check updates, or remove recently added mods.' },
  { re: /Failed to (?:download|verify).*library|ZipException|zip END header not found|invalid LOC header/i,
    title: 'Corrupt download', fix: 'A game file is damaged. Use Settings → Storage → Repair files, then launch again.' },
  { re: /Address already in use|BindException/i,
    title: 'Port in use', fix: 'Another program is using a needed network port. Close other Minecraft instances or servers.' },
  { re: /Exception in thread "main".*java\.lang\.IllegalArgumentException.*module/i,
    title: 'Java module error', fix: 'Your Java version is not compatible with this loader. Use the automatic Java runtime.' },
];

const KNOWN_CODES = {
  '-1073741819': 'Access violation (0xC0000005) — usually a graphics driver or overlay.',
  '-1073740791': 'Stack buffer overrun (0xC0000409) — native crash, often drivers.',
  '-805306369': 'The game was forcefully closed or froze (0xCFFFFFFF).',
  '1': 'Generic error — see the log above.',
  '137': 'Killed by the system (out of memory).',
};

function analyze({ code, lines, gameDir, since }) {
  const text = (lines || []).join('\n');
  let crashReport = null;
  try {
    const dir = path.join(gameDir, 'crash-reports');
    const latest = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).filter((x) => x.t >= (since || 0)).sort((a, b) => b.t - a.t)[0];
    if (latest) crashReport = { file: path.join(dir, latest.f), text: fs.readFileSync(path.join(dir, latest.f), 'utf8') };
  } catch {}
  const haystack = text + '\n' + (crashReport?.text || '');
  const causes = RULES.filter((r) => r.re.test(haystack)).map(({ title, fix }) => ({ title, fix }));
  const hex = '0x' + ((code >>> 0).toString(16).toUpperCase());
  const desc = (crashReport?.text.match(/^Description: (.+)$/m) || [])[1];
  return {
    code, hex,
    codeMeaning: KNOWN_CODES[String(code)] || null,
    description: desc || null,
    causes: causes.length ? causes : [{ title: 'Unknown cause', fix: 'Open the Console to read the full log, or share it with “Share log” to get help.' }],
    crashReport: crashReport?.file || null,
  };
}

module.exports = { analyze };
