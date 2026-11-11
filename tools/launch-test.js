// End-to-end launch test: SOLARIS_DATA_DIR=<tmp> TEST_INSTANCE=<id> electron tools/launch-test.js
const { app } = require('electron');
app.whenReady().then(async () => {
  const { events } = require('../src/util');
  const launch = require('../src/launch');
  const accounts = require('../src/accounts');
  if (!accounts.active()) accounts.addOffline('SolarTester');
  let last = '';
  let ok = false;
  const done = (code) => { console.log(ok ? 'RESULT: GAME STARTED OK' : 'RESULT: GAME DID NOT REACH MAIN MENU'); app.exit(code); };
  events.on('send', (ch, p) => {
    if (ch === 'launch:status') { const s = `${p.stage} ${p.progress != null ? Math.round(p.progress * 100) + '%' : ''} ${p.error || ''}`; if (s !== last) { last = s; console.log('[status]', s); } }
    if (ch === 'game:log') {
      console.log('[log]', p.line.slice(0, 220));
      if (/Sound engine started|Created: \d+x\d+x\d+ minecraft:textures\/atlas|Backend library: LWJGL/.test(p.line) && !ok) {
        ok = true;
        setTimeout(() => { for (const r of launch.list().running) launch.stop(r.runId); }, 4000);
      }
    }
    if (ch === 'launch:exited') { console.log('[exited]', JSON.stringify({ code: p.code, killed: p.killed, analysis: p.analysis && p.analysis.causes })); done(0); }
  });
  try { await launch.launch(process.env.TEST_INSTANCE, {}); } catch (e) { console.log('LAUNCH ERROR', e.stack); done(1); }
});
