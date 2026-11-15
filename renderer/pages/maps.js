/* Maps (Solaris Connect): BlueMap, Pl3xMap and Dynmap web maps of your hosted servers and of servers you play on, inside Solaris. */
const MAP_FRAME = (url) => `<iframe class="map-frame" src="${esc(url)}" sandbox="allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer" title="Map"></iframe>`;

Pages.maps = {
  sel: null, // { kind: 'server'|'link', id }

  async render(el, params, ctx) {
    el.innerHTML = `<div class="page-head"><div><a href="#" id="mp-back" class="small">← Solaris Connect</a><h1>Maps</h1><div class="sub">BlueMap, Pl3xMap and Dynmap web maps of your servers and of servers you play on — inside Solaris.</div></div>
        <div class="actions"><button class="btn" id="mp-refresh">${icon('refresh')}Check again</button></div></div>
      <div class="maps-layout"><div class="stack maps-side" id="mp-side"><div class="faint">Loading…</div></div><div class="maps-view" id="mp-view"></div></div>`;
    $('#mp-back', el).onclick = (e) => { e.preventDefault(); Router.go('connect'); };
    if (params.server) this.sel = { kind: 'server', id: params.server };
    const draw = async () => {
      const servers = (await api('hosted:list').catch(() => [])).filter((s) => !s.missing && (s.webmap?.on || s.bluemap?.on));
      const infos = await Promise.all(servers.map((s) => api('maps:info', s.id).then((i) => ({ s, i })).catch(() => ({ s, i: { on: true, online: false, error: 'Couldn’t check' } }))));
      const links = await api('maps:links').catch(() => []);
      if (!el.isConnected) return;
      if (!this.sel) this.sel = infos.find((x) => x.i.online) ? { kind: 'server', id: infos.find((x) => x.i.online).s.id } : links.find((l) => l.online) ? { kind: 'link', id: links.find((l) => l.online).id } : null;
      const row = (kind, id, name, sub, ok) => `<button class="maps-item ${this.sel?.kind === kind && this.sel.id === id ? 'on' : ''}" data-pick="${kind}:${esc(id)}"><span class="cn-state ${ok ? 'ok' : 'off'}"><i></i></span><span class="grow" style="min-width:0"><b class="ellipsis">${esc(name)}</b><span class="faint small ellipsis">${esc(sub)}</span></span></button>`;
      $('#mp-side', el).innerHTML = `<div class="card stack" style="gap:4px"><h4 style="margin:0 0 4px">Your servers</h4>
          ${infos.map(({ s, i }) => row('server', s.id, s.name, s.state !== 'online' ? 'Server is off' : i.online ? `${i.maps.length} world${i.maps.length === 1 ? '' : 's'} · ${i.maps.reduce((a, mp) => a + mp.players.length, 0)} on the map` : i.error || 'Starting…', i.online)).join('') || '<div class="faint small">No server has BlueMap yet. Open a server → <b>Map</b> tab to turn it on.</div>'}</div>
        <div class="card stack" style="gap:4px"><h4 style="margin:0 0 4px">Map links</h4>
          ${links.map((l) => row('link', l.id, `${l.name}`, (l.providerName ? l.providerName + ' · ' : '') + (l.online ? `${l.maps.length} world${l.maps.length === 1 ? '' : 's'} · ${l.maps.reduce((a, mp) => a + mp.players.length, 0)} on the map` : l.error || 'Not answering'), l.online)).join('') || '<div class="faint small">The BlueMap site of a server you play on (many servers have one).</div>'}
          <div class="row" style="gap:6px;margin-top:6px"><input type="text" id="mp-url" class="grow mono" placeholder="https://map.example.net" spellcheck="false"><button class="btn sm primary" id="mp-add">${icon('plus')}Add</button></div></div>`;
      $$('[data-pick]', el).forEach((b) => (b.onclick = () => { const [kind, ...rest] = b.dataset.pick.split(':'); this.sel = { kind, id: rest.join(':') }; draw(); }));
      $('#mp-add', el).onclick = async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { const l = await api('maps:addLink', $('#mp-url', el).value); const added = l[l.length - 1]; this.sel = { kind: 'link', id: added.id }; toast(`Added ${added.name}`); draw(); } catch (er) { toastErr(er); b.disabled = false; }
      };
      const view = $('#mp-view', el);
      const cur = this.sel?.kind === 'server' ? infos.find((x) => x.s.id === this.sel.id) : null;
      const link = this.sel?.kind === 'link' ? links.find((l) => l.id === this.sel.id) : null;
      if (cur) view.innerHTML = this.viewer(cur.s.name, cur.i.online ? cur.i.url : null, cur.i.maps, cur.s.state !== 'online' ? 'The server is off — start it to see the map.' : cur.i.error || 'Starting…', [cur.i.lanUrl ? ['Copy LAN link', cur.i.lanUrl] : null].filter(Boolean));
      else if (link) view.innerHTML = this.viewer(link.name, link.online ? link.url : null, link.maps, link.error || 'Not answering', [], link.id);
      else view.innerHTML = `<div class="empty">${icon('roadmap')}<div>Pick a map on the left.</div></div>`;
      $$('[data-open]', view).forEach((b) => (b.onclick = () => api('shell:open', b.dataset.open)));
      $$('[data-copy]', view).forEach((b) => (b.onclick = () => { api('clipboard:write', b.dataset.copy); toast('Copied — people on your Wi-Fi can open it in a browser'); }));
      $$('[data-rmlink]', view).forEach((b) => (b.onclick = async () => { await api('maps:removeLink', b.dataset.rmlink).catch(toastErr); this.sel = null; draw(); }));
    };
    $('#mp-refresh', el).onclick = () => draw();
    await draw();
    ctx.on('hosted', debounce(() => draw(), 2000));
  },

  /** The map itself (BlueMap's own page in a frame), the worlds and who is on them. */
  viewer(name, url, maps, why, copies = [], linkId = null) {
    const players = maps.flatMap((mp) => mp.players.map((p) => ({ ...p, world: mp.name })));
    return `<div class="row" style="gap:8px;margin-bottom:8px"><h3 class="grow" style="margin:0">${esc(name)}</h3>
        ${url ? `<button class="btn sm" data-open="${esc(url)}">${icon('external')}Open in browser</button>` : ''}${copies.map(([l, u]) => `<button class="btn sm" data-copy="${esc(u)}">${icon('copy')}${esc(l)}</button>`).join('')}${linkId ? `<button class="btn sm ghost" data-rmlink="${esc(linkId)}">${icon('trash')}Remove</button>` : ''}</div>
      ${url ? MAP_FRAME(url) : `<div class="empty map-frame">${icon('roadmap')}<div>${esc(why)}</div></div>`}
      ${players.length ? `<div class="small" style="margin-top:8px"><b>On the map:</b> ${players.map((p) => `${esc(p.name)} <span class="faint mono">${p.x} ${p.y} ${p.z}${maps.length > 1 ? ` · ${esc(p.world)}` : ''}</span>`).join(' · ')}</div>` : url ? '<div class="faint small" style="margin-top:8px">Nobody is on the map right now.</div>' : ''}`;
  },

  /** A hosted server's Map tab: turn BlueMap on (with the download question), or show the map. */
  async serverTab(box, id, s) {
    let i; try { i = await api('maps:info', id); } catch (e) { box.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
    if (!i.supported) { box.innerHTML = `<div class="card"><h3 style="margin:0">${icon('roadmap')} Map</h3><p class="faint">Web maps need a Paper, Purpur, Fabric, Quilt, Forge or NeoForge server — ${esc(s.softwareName)} servers can’t run them.</p></div>`; return; }
    const INFO = {
      bluemap: ['A 3D map — walk around your world from above, with real block textures.', 'BlueMap needs the Minecraft textures to draw the map. I accept <a href="#" data-eula>Mojang’s EULA</a>, I own Minecraft: Java Edition, and BlueMap may download the Minecraft client file from Mojang for this.'],
      pl3xmap: ['A fast flat map, like a satellite view. Light on the server.', null],
      dynmap: ['The classic map with flat and 3D-ish views. Uses more disk space and CPU on big worlds.', null],
    };
    if (!i.on) {
      let pick = i.provider && i.providers.some((p) => p.id === i.provider) ? i.provider : i.providers[0].id;
      const draw = () => {
        const p = i.providers.find((x) => x.id === pick);
        box.innerHTML = `<div class="card stack"><h3 style="margin:0">${icon('roadmap')} Map</h3>
          <div>A map of your world in your browser and inside Solaris, with players moving on it live. Pick one — Solaris installs it on this server and sets it up.</div>
          <div class="hc-types" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${i.providers.map((x) => `<button class="hc-type ${x.id === pick ? 'on' : ''}" data-prov="${x.id}"><b>${esc(x.name)}</b><span class="faint small">${esc(x.style)}</span><span class="small">${esc(INFO[x.id][0])}</span></button>`).join('')}</div>
          <ul class="small faint" style="margin:0 0 0 18px;line-height:1.6"><li>The map is drawn while the server runs — the first full map of a big world takes a while and uses some CPU.</li><li>It opens at <span class="mono">localhost</span> on this PC and on your Wi-Fi; friends outside your network can’t open it yet.</li><li>The map files are saved in the server folder (they can get big for large worlds).</li></ul>
          ${INFO[pick][1] ? `<label class="row small" style="gap:10px;align-items:flex-start"><input type="checkbox" id="bm-eula"><span>${INFO[pick][1]}</span></label>` : ''}
          <div class="row" style="gap:8px"><a href="#" class="small" data-docs>About ${esc(p.name)}</a><div class="grow faint small">${s.state === 'offline' ? '' : 'Restart the server after turning it on.'}</div><button class="btn primary" id="bm-on" ${INFO[pick][1] ? 'disabled' : ''}>${icon('roadmap')}Turn on ${esc(p.name)}</button></div></div>`;
        $$('[data-prov]', box).forEach((x) => (x.onclick = () => { pick = x.dataset.prov; draw(); }));
        $('[data-docs]', box).onclick = (e) => { e.preventDefault(); api('shell:open', p.docs); };
        if ($('[data-eula]', box)) $('[data-eula]', box).onclick = (e) => { e.preventDefault(); api('shell:open', 'https://www.minecraft.net/eula'); };
        if ($('#bm-eula', box)) $('#bm-eula', box).onchange = (e) => ($('#bm-on', box).disabled = !e.target.checked);
        $('#bm-on', box).onclick = async (e) => {
          const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = `${icon('refresh', 'spin')}Installing ${esc(p.name)}…`;
          try { await api('maps:enable', id, { provider: pick, acceptDownload: !!$('#bm-eula', box)?.checked }); toast(s.state === 'offline' ? `${p.name} is on — start the server to draw the map` : `${p.name} is on — restart the server to start the map`, 'ok', 8000); this.serverTab(box, id, s); }
          catch (er) { toastErr(er); btn.disabled = false; btn.innerHTML = `${icon('roadmap')}Turn on ${esc(p.name)}`; }
        };
      };
      draw();
      return;
    }
    const why = s.state !== 'online' ? 'Start the server to see the map.' : !i.configured ? `${i.providerName} is starting for the first time — Solaris sets it up and reloads it; the map appears in a minute.` : i.error || 'Starting…';
    box.innerHTML = `${this.viewer(`${s.name} — map`, i.online ? i.url : null, i.maps, why, i.lanUrl ? [['Copy LAN link', i.lanUrl]] : [])}
      <div class="row small" style="gap:8px;margin-top:10px"><span class="faint grow">${esc(i.providerName)} · web map on port ${i.port}${i.online ? ` · ${i.maps.length} world${i.maps.length === 1 ? '' : 's'}` : ''}. New areas appear as it draws them.</span>
        <button class="btn sm" id="bm-check">${icon('refresh')}Check again</button><button class="btn sm ghost" id="bm-off">Turn off the map</button></div>`;
    $$('[data-open]', box).forEach((x) => (x.onclick = () => api('shell:open', x.dataset.open)));
    $$('[data-copy]', box).forEach((x) => (x.onclick = () => { api('clipboard:write', x.dataset.copy); toast('Copied — people on your Wi-Fi can open it in a browser'); }));
    $('#bm-check', box).onclick = () => this.serverTab(box, id, s);
    if (s.state === 'online' && !i.online) setTimeout(() => { if ($('#bm-check', box)) this.serverTab(box, id, s); }, 10000);
    $('#bm-off', box).onclick = async () => { if (!(await confirmDialog(`Turn the map off? ${i.providerName} is disabled on this server (its map files stay). Restart the server to apply.`, { ok: 'Turn off' }))) return; await api('maps:disable', id).catch(toastErr); this.serverTab(box, id, s); };
  },
};
