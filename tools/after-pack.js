// electron-builder afterPack hook (Linux only).
// Ubuntu 24.04+ (and some other distros) block the unprivileged user namespaces Chromium's sandbox needs, and an
// AppImage can't ship a setuid sandbox helper — so Electron apps exit at start with a sandbox error. This wraps the
// real binary in a tiny shell script that adds --no-sandbox only when the sandbox can't work on that system.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'linux') return;
  const name = ctx.packager.executableName;
  const dir = ctx.appOutDir;
  const bin = path.join(dir, name);
  const real = path.join(dir, name + '-bin');
  if (!fs.existsSync(bin) || fs.existsSync(real)) return;
  fs.renameSync(bin, real);
  const script = `#!/bin/sh
# Solaris launcher wrapper: starts ${name}-bin, adding --no-sandbox only where Chromium's sandbox is unavailable.
HERE="$(dirname "$(readlink -f "$0")")"
NEED=0
if [ ! -u "$HERE/chrome-sandbox" ]; then
  if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ]; then NEED=1; fi
  if [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ]; then NEED=1; fi
  if [ -n "$APPIMAGE" ] && [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = "0" ]; then NEED=1; fi
fi
if [ "$NEED" = "1" ]; then exec "$HERE/${name}-bin" --no-sandbox "$@"; fi
exec "$HERE/${name}-bin" "$@"
`;
  fs.writeFileSync(bin, script, { mode: 0o755 });
};
