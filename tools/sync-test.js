const { app } = require('electron');
app.whenReady().then(async () => {
  const instances = require('../src/instances');
  const modrinth = require('../src/modrinth');
  try {
    const inst = instances.create({ name: 'Solaris Test', versionId: '1.21.1', loader: { type: 'fabric' }, icon: 'sun', extra: { solarisModules: modrinth.modules().filter((m) => m.default).map((m) => m.slug) } });
    const rep = await modrinth.syncModules(inst.id);
    console.log('REPORT', JSON.stringify(rep));
    console.log('MODS', instances.listContent(inst.id, 'mods').map((m) => `${m.name}@${m.version}`).join(', '));
    const up = await modrinth.checkUpdates(inst.id, 'mods');
    console.log('UPDATECHECK', up.length, 'items, onModrinth:', up.filter((u) => u.onModrinth).length);
  } catch (e) { console.log('ERR', e.stack); }
  app.exit(0);
});
