/* Solaris Client — a one-click, self-updating performance & QoL modpack (Fabric). */
Pages.solaris = {
  async render(el, params, ctx) {
    const modules = await api('solaris:modules');
    const versions = (await getVersions().catch(() => [])).filter((v) => v.type === 'release');
    if (!versions.length) { el.innerHTML = `<div class="page-head"><div><h1>Solaris Client</h1></div></div><div class="empty">${icon('globe')}<div>Couldn’t load the Minecraft version list — check your internet connection.</div><button class="btn sm" style="margin-top:12px" id="retry">${icon('refresh')}Try again</button></div>`; $('#retry', el).onclick = () => Router.reload(); return; }
    const managed = () => State.instances.filter((i) => i.solarisModules);
    let mc = params.mc || versions[0]?.id;
    let editing = params.instanceId ? State.instances.find((i) => i.id === params.instanceId) : null;
    let chosen = new Set(editing ? editing.solarisModules : modules.filter((m) => m.default || m.required).map((m) => m.slug));
    let avail = {};
    const CAT_ICON = { Core: 'layers', Performance: 'zap', Graphics: 'eye', 'HUD & Utility': 'cpu', Visual: 'palette', Social: 'users', Cosmetics: 'skins' };

    const draw = () => {
      const cats = [...new Set(modules.map((m) => m.cat))];
      const inst = editing;
      el.innerHTML = `
        <section class="hero" style="min-height:230px">
          <div class="sunburst" style="width:240px;height:240px">${SUN_SVG.replace('class="sun"', 'width="100%" height="100%"')}</div>
          <div class="kicker">All-in-one modpack</div>
          <h1>Solaris Client</h1>
          <div class="desc">One install with ${modules.length} hand-picked modules — boosted frames, smooth zoom, better HUD and more. Solaris keeps every module updated automatically each time you launch.</div>
          <div class="play-row">
            ${inst ? `${playButton(inst, { size: 'lg' })}<span class="chip warn">Editing ${esc(inst.name)} · ${esc(inst.versionId)}</span><button class="btn" id="done-edit">Create another</button>`
              : `<select id="mc" style="height:50px;min-width:150px">${versions.slice(0, 60).map((v) => `<option ${v.id === mc ? 'selected' : ''}>${esc(v.id)}</option>`).join('')}</select>
                 <button class="btn primary lg play" id="create">${icon('sun')}Install Solaris Client</button>`}
          </div>
        </section>
        ${managed().length ? `<h2>Your Solaris instances</h2><div class="grid cols-auto">${managed().map((i) => `<div class="inst-card ${inst && inst.id === i.id ? 'selected' : ''}" data-edit="${esc(i.id)}"><div class="top">${instIcon(i)}<div style="min-width:0"><div class="name">${esc(i.name)}</div><div class="meta">${instMeta(i)}<span class="chip">${i.solarisModules.length} modules</span></div></div></div><div class="bottom"><span class="faint small">Click to edit modules</span><span class="card-play" style="opacity:1">${playButton(i, { size: 'sm' })}</span></div></div>`).join('')}</div>` : ''}
        ${cats.map((c) => `<h2>${icon(CAT_ICON[c] || 'box')} ${esc(c)}</h2><div class="grid cols-wide">${modules.filter((m) => m.cat === c).map((m) => {
          const na = avail[m.slug] === false;
          return `<label class="module ${chosen.has(m.slug) ? 'on' : ''} ${na ? 'na' : ''}" title="${na ? 'Not available for this version yet' : ''}">
            <div class="module-ic">${icon(CAT_ICON[c] || 'box')}</div>
            <div class="grow"><div class="t">${esc(m.name)} ${m.required ? '<span class="chip">required</span>' : ''} ${na ? '<span class="chip">unavailable</span>' : ''}</div><div class="d">${esc(m.desc)}</div></div>
            <span class="switch"><input type="checkbox" data-mod="${esc(m.slug)}" ${chosen.has(m.slug) ? 'checked' : ''} ${m.required ? 'disabled' : ''}><span></span></span></label>`;
        }).join('')}</div>`).join('')}
        <p class="faint small" style="margin-top:20px">Modules are open-source mods from Modrinth, installed on Fabric. Configure them in-game via Mod Menu. You can add any other mod to a Solaris instance from Browse.</p>`;
      $$('[data-mod]', el).forEach((c) => (c.onchange = async () => {
        c.checked ? chosen.add(c.dataset.mod) : chosen.delete(c.dataset.mod);
        c.closest('.module').classList.toggle('on', c.checked);
        if (editing) { await api('solaris:setModules', editing.id, [...chosen]); await refreshInstances(); editing = State.instances.find((i) => i.id === editing.id); toast('Modules saved — they sync on next launch'); }
      }));
      $$('[data-edit]', el).forEach((c) => (c.onclick = (e) => { if (e.target.closest('button')) return; editing = State.instances.find((i) => i.id === c.dataset.edit); chosen = new Set(editing.solarisModules); mc = editing.versionId; checkAvail(); draw(); el.parentElement.scrollTop = 0; }));
      if (inst) $('#done-edit', el).onclick = () => { editing = null; chosen = new Set(modules.filter((m) => m.default || m.required).map((m) => m.slug)); draw(); };
      else {
        $('#mc', el).onchange = (e) => { mc = e.target.value; checkAvail(); };
        $('#create', el).onclick = create;
      }
    };
    const checkAvail = async () => {
      const my = mc;
      avail = {};
      try { const a = await api('solaris:availability', mc); if (my === mc) { avail = a; draw(); } } catch {}
    };
    const create = async () => {
      const b = $('#create', el); b.disabled = true; b.innerHTML = `${icon('refresh')}Installing…`;
      try {
        const fabric = await api('loaders:versions', 'fabric', mc);
        if (!fabric.length) throw new Error(`Fabric is not available for ${mc} yet`);
        const mods = [...chosen].filter((s) => avail[s] !== false);
        const inst = await api('solaris:create', { mc, modules: mods, name: `Solaris ${mc}` });
        State.tasks['sync'] = { label: 'Installing Solaris modules', progress: 0 }; Bus.emit('tasks');
        const off = window.solaris.on('task', (t) => { if (t.id === 'sync-' + inst.id) { State.tasks['sync'] = { label: t.label, progress: t.progress, detail: t.detail }; Bus.emit('tasks'); } });
        const rep = await api('solaris:sync', inst.id).finally(() => { off(); delete State.tasks['sync']; Bus.emit('tasks'); });
        await refreshInstances();
        await saveSettings({ selectedInstance: inst.id });
        toast(`Solaris Client ready — ${rep.installed.length} modules installed${rep.unavailable.length ? `, ${rep.unavailable.length} unavailable for ${mc}` : ''}`);
        editing = State.instances.find((i) => i.id === inst.id);
        draw();
      } catch (e) { toastErr(e); b.disabled = false; b.innerHTML = `${icon('sun')}Install Solaris Client`; }
    };
    draw();
    checkAvail();
    ctx.on('runs', draw);
    ctx.on('launch', () => { if (editing) { const p = $('.play-row', el); if (p) draw(); } });
  },
};
