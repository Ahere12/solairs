Pages.skins = {
  async render(el, params, ctx) {
    const acct = State.accounts.accounts.find((a) => a.id === State.accounts.active);
    let wardrobe = await api('skins:list');
    let staged = null; // wardrobe skin id staged for Apply
    let wearing = null; // wardrobe skin id the account wears right now
    let previewDefault = null; // default skin being previewed ({ name, model })
    let defModel = 'wide';
    let current = null;
    el.innerHTML = `
      <div class="page-head"><div><h1>${T('Skins')}</h1><div class="sub">Your wardrobe — preview in 3D, then apply to your Microsoft account</div></div>
        <div class="actions">${acct ? `<button class="btn" id="sk-refresh" title="Reload your current skin from Minecraft">${icon('refresh')}Refresh skin</button>` : ''}<button class="btn" id="from-user">${icon('user')}From username</button><button class="btn primary" id="from-file">${icon('upload')}Upload skin</button></div></div>
      <div class="skins-layout">
        <div class="viewer">
          <canvas id="sv" width="300" height="400"></canvas>
          <div class="row"><div class="seg"><button data-anim="walk" class="on">Walk</button><button data-anim="idle">Idle</button><button data-anim="run">Run</button></div><button class="icon-btn" id="rot" title="Auto-rotate">${icon('refresh')}</button><button class="icon-btn" id="cape-file" title="Preview a cape file (animated capes supported)">${icon('upload')}</button><input type="file" id="cape-input" accept="image/png" hidden></div>
          <div id="stage-info" class="small muted" style="text-align:center"></div>
          <button class="btn primary" id="apply" disabled style="width:100%">${icon('check')}Wear this skin</button>
          ${acct?.type === 'msa' ? '' : '<div class="faint small" style="text-align:center">Offline: your skin is shown through CustomSkinLoader in modded instances (only you and players with the mod see it). Capes need a Microsoft account.</div>'}
        </div>
        <div>
          <div id="capes-wrap"></div>
          <h2 style="margin-top:0">Wardrobe</h2>
          <div class="skin-grid" id="wardrobe"></div>
          <div class="section-head"><h2>Default skins</h2><span class="cnt">from your Minecraft files</span><div class="grow"></div><div class="seg" id="defmodel"><button data-dm="wide" class="on">Classic arms</button><button data-dm="slim">Slim arms</button></div></div>
          <div class="skin-grid" id="defaults"></div>
        </div>
      </div>`;

    // 3D viewer (skinview3d), with a 2D fallback.
    let viewer = null;
    await loadSkinview();
    if (!el.isConnected) return;
    if (window.skinview3d) {
      try {
        viewer = new skinview3d.SkinViewer({ canvas: $('#sv', el), width: 300, height: 400 });
        viewer.zoom = 0.82;
        viewer.autoRotate = true;
        viewer.autoRotateSpeed = 0.6;
        viewer.animation = new skinview3d.WalkingAnimation();
        viewer.animation.speed = 0.7;
        if (State.settings.lowEndMode) { viewer.autoRotate = false; viewer.animation = null; } // low-end mode: still preview
      } catch (e) { console.warn(e); viewer = null; }
    }
    // the default skin Minecraft gives this account when it has no custom one
    const accountDefault = () => (acct ? McIcons.skinForUuid(acct.uuid) : McIcons.defaultSkin('steve', 'wide'));
    const show = (src, variant, cape) => {
      if (!src) { const d = accountDefault(); if (d) { src = d.src; variant = d.model === 'slim' ? 'slim' : 'classic'; } }
      if (viewer) {
        if (src) viewer.loadSkin(src, { model: variant === 'slim' ? 'slim' : 'default' }); else viewer.resetSkin();
        if (cape !== undefined) loadCape(viewer, cape || null);
      } else if (src) drawSkinFront($('#sv', el), src, variant === 'slim');
    };
    $('#cape-file', el).onclick = () => $('#cape-input', el).click();
    $('#cape-input', el).onchange = (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f || !viewer) return;
      const r = new FileReader();
      r.onload = async () => { const n = await loadCape(viewer, r.result); toast(n > 1 ? `Animated cape preview: ${n} frames` : n ? 'Cape preview (only you see this)' : 'That image isn’t a cape texture', n ? 'info' : 'error'); };
      r.readAsDataURL(f);
    };
    $$('[data-anim]', el).forEach((b) => (b.onclick = () => {
      $$('[data-anim]', el).forEach((x) => x.classList.toggle('on', x === b));
      if (!viewer) return;
      viewer.animation = b.dataset.anim === 'walk' ? new skinview3d.WalkingAnimation() : b.dataset.anim === 'run' ? new skinview3d.RunningAnimation() : new skinview3d.IdleAnimation();
    }));
    $('#rot', el).onclick = () => { if (viewer) viewer.autoRotate = !viewer.autoRotate; };

    /** Fills a tile's <img> with a 3D render of the skin (falls back to a flat front view). */
    const paint = (tile, src, slim) => {
      const img = $('img', tile);
      if (!img || !src) return;
      SkinShots.render(src, slim).then((url) => {
        if (url) { img.src = url; img.classList.add('ready'); return; }
        const c = document.createElement('canvas'); c.className = 'flat'; img.replaceWith(c); drawSkinFront(c, src, slim);
      });
    };
    const tile = (attrs, name, sub, extra = '', bottom = '') => `<div class="skin-tile" ${attrs}>${extra}<div class="skin-shot"><img alt=""></div><div class="n">${esc(name)}</div><div class="faint small">${sub}</div>${bottom}</div>`;

    const drawWardrobe = () => {
      const box = $('#wardrobe', el);
      const def = accountDefault();
      const curSrc = current?.skin || def?.src;
      const curSlim = current?.skin ? current.variant === 'slim' : def?.model === 'slim';
      box.innerHTML = (curSrc ? tile('data-current', 'Current', current?.skin ? (curSlim ? 'Slim' : 'Classic') : `Default · ${def.name[0].toUpperCase() + def.name.slice(1)}`) : '') +
        wardrobe.map((s) => tile(`data-skin="${esc(s.id)}"`, s.name, `<span data-variant="${esc(s.id)}" style="cursor:pointer" title="Toggle arm model">${s.variant === 'slim' ? 'Slim arms' : 'Classic arms'}</span>`, `<button class="icon-btn x" data-rm="${esc(s.id)}" title="Remove">${icon('trash')}</button>`,
          wearing === s.id ? `<span class="sk-wearing">${icon('check')}Wearing</span>` : `<button class="btn sm primary sk-wear" data-wear="${esc(s.id)}" ${acct ? '' : 'disabled'}>${icon('skins')}Wear</button>`)).join('') +
        (!wardrobe.length ? `<div class="empty small" style="grid-column:1/-1;padding:24px">${icon('skins')}<div>Upload a skin PNG or grab one from any player's username.</div></div>` : '');
      const cur = $('[data-current]', box);
      if (cur) { paint(cur, curSrc, curSlim); cur.onclick = () => { staged = null; previewDefault = null; show(current?.skin, current?.variant); stage(); mark(); }; }
      for (const s of wardrobe) { const t = $(`[data-skin="${CSS.escape(s.id)}"]`, box); if (t && s.data) paint(t, s.data, s.variant === 'slim'); }
      $$('[data-skin]', box).forEach((t) => (t.onclick = (e) => {
        if (e.target.closest('[data-rm],[data-variant],[data-wear]')) return;
        const s = wardrobe.find((x) => x.id === t.dataset.skin);
        staged = s.id; previewDefault = null; show(s.data, s.variant); stage(); mark();
      }));
      $$('[data-wear]', box).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const s = wardrobe.find((x) => x.id === b.dataset.wear); staged = s.id; previewDefault = null; show(s.data, s.variant); stage(); mark(); wear(b); }));
      $$('[data-rm]', box).forEach((b) => (b.onclick = async () => { if (await confirmDialog('Remove this skin from your wardrobe?', { danger: true, ok: 'Remove' })) { wardrobe = await api('skins:remove', b.dataset.rm); if (staged === b.dataset.rm) staged = null; stage(); drawWardrobe(); } }));
      $$('[data-variant]', box).forEach((b) => (b.onclick = async () => { const s = wardrobe.find((x) => x.id === b.dataset.variant); wardrobe = await api('skins:update', s.id, { variant: s.variant === 'slim' ? 'classic' : 'slim' }); if (staged === s.id) { const n = wardrobe.find((x) => x.id === s.id); show(n.data, n.variant); } drawWardrobe(); }));
      mark();
    };
    const drawDefaults = () => {
      const box = $('#defaults', el);
      if (!McIcons.defaultSkin()) {
        box.innerHTML = `<div class="empty small" style="grid-column:1/-1;padding:24px">${icon('skins')}<div>Minecraft's default skins load from your game files — play any instance once, then come back.</div></div>`;
        return;
      }
      const names = Object.keys(McIcons.skins[defModel] || {});
      box.innerHTML = names.map((n) => tile(`data-def="${n}"`, n[0].toUpperCase() + n.slice(1), defModel === 'slim' ? 'Slim arms' : 'Classic arms')).join('');
      for (const n of names) paint($(`[data-def="${n}"]`, box), McIcons.skins[defModel][n], defModel === 'slim');
      $$('[data-def]', box).forEach((t) => (t.onclick = () => {
        previewDefault = { name: t.dataset.def, model: defModel }; staged = null;
        show(McIcons.skins[defModel][t.dataset.def], defModel === 'slim' ? 'slim' : 'classic'); stage(); mark();
      }));
      mark();
    };
    const mark = () => {
      $$('[data-current]', el).forEach((t) => t.classList.toggle('on', staged === null && !previewDefault));
      $$('[data-skin]', el).forEach((t) => t.classList.toggle('on', staged === t.dataset.skin));
      $$('[data-def]', el).forEach((t) => t.classList.toggle('on', !!previewDefault && previewDefault.name === t.dataset.def && previewDefault.model === defModel));
    };
    $$('[data-dm]', el).forEach((b) => (b.onclick = () => { defModel = b.dataset.dm; $$('[data-dm]', el).forEach((x) => x.classList.toggle('on', x === b)); drawDefaults(); }));
    const stage = () => {
      const s = wardrobe.find((x) => x.id === staged);
      // Wardrobe skins and Minecraft's default skins can both be worn.
      $('#apply', el).disabled = !(s || previewDefault) || !acct || (s && wearing === s.id);
      const cap = (n) => n[0].toUpperCase() + n.slice(1);
      $('#stage-info', el).textContent = s ? (wearing === s.id ? `You’re wearing ${s.name}` : `${s.name} is not on you yet — press “Wear this skin”`)
        : previewDefault ? `Minecraft's default ${cap(previewDefault.name)} skin — press “Wear this skin” to use it`
        : current?.skin ? 'Showing your current skin' : acct ? `No custom skin — in-game you appear as ${cap(accountDefault()?.name || 'Steve')}` : '';
    };
    $('#apply', el).onclick = () => wear($('#apply', el));
    /** Wear the staged skin. `b` is the button that shows progress (the big one or a tile's Wear). */
    const wear = async (b) => {
      if (!staged && !previewDefault) return;
      b.disabled = true;
      const label = b.innerHTML;
      b.classList.add('busy'); b.innerHTML = `${icon('refresh', 'spin')}${acct?.type === 'msa' ? 'Uploading to Mojang…' : 'Saving…'}`;
      try {
        if (!staged && previewDefault) {
          // A default skin: put it in the wardrobe first (once), then wear it like any other skin.
          const name = previewDefault.name[0].toUpperCase() + previewDefault.name.slice(1);
          staged = await api('skins:addData', McIcons.skins[previewDefault.model][previewDefault.name], name, previewDefault.model === 'slim' ? 'slim' : 'classic');
          previewDefault = null;
          wardrobe = await api('skins:list');
        }
        const r = await api('skins:apply', staged);
        if (r.offline) toast(`${r.name} is now your offline skin — it shows in modded instances (Solaris adds CustomSkinLoader when you press Play).`, 'ok', 7000);
        else toast(r.pending ? `Mojang accepted ${r.name}. It can take a minute to show everywhere — rejoin your world or server to see it.` : `${r.name} is live on your Microsoft account. Rejoin your world or server to see it in-game.`, 'ok', 7000);
        b.classList.remove('busy'); installFeedback.mark(b); b.innerHTML = `${icon('check')}Wearing it`;
        setTimeout(() => { if (b.isConnected) { b.classList.remove('installed'); b.innerHTML = label; stage(); } }, 2500);
        if (!r.offline) current = await api('skins:current');
        wearing = await api('skins:wearing', current?.url || null).catch(() => null);
        staged = null; drawWardrobe(); stage(); if (!r.offline) refreshSkin(true);
      } catch (e) { toastErr(e); if (b.isConnected) { b.classList.remove('busy'); b.innerHTML = label; b.disabled = false; } drawWardrobe(); stage(); }
    };
    /** Skin refresh: re-read the account's skin from Minecraft and update the 3D view and the sidebar head. */
    const refreshSkin = async (quiet) => {
      const b = $('#sk-refresh', el); if (b) b.disabled = true;
      try {
        if (acct?.type === 'msa') { State.accounts = await api('accounts:refreshProfile'); Bus.emit('accounts', State.accounts); }
        current = await api('skins:current');
        if (el.isConnected && !staged && !previewDefault) show(current?.skin, current?.variant, current?.cape || null);
        stage();
        if (!quiet) toast('Skin refreshed');
      } catch (e) { if (!quiet) toastErr(e); }
      finally { if (b && b.isConnected) b.disabled = false; }
    };
    if ($('#sk-refresh', el)) $('#sk-refresh', el).onclick = () => refreshSkin(false);
    // Switched account (e.g. offline ↔ Microsoft): show that account's skin and wardrobe state.
    ctx.on('accounts', (a) => { if (a && a.active !== acct?.id && el.isConnected) Router.reload(); });
    $('#from-file', el).onclick = async () => {
      const variant = (await confirmDialog('Does this skin use slim (3-pixel) arms?', { title: 'Arm model', ok: 'Slim arms' })) ? 'slim' : 'classic';
      try { wardrobe = await api('skins:addFile', variant); if (wardrobe[0]) { staged = wardrobe[0].id; previewDefault = null; show(wardrobe[0].data, wardrobe[0].variant); } drawWardrobe(); stage(); } catch (e) { toastErr(e); }
    };
    $('#from-user', el).onclick = async () => {
      const n = await promptDialog('Copy skin from player', { placeholder: 'Minecraft username', ok: 'Add' });
      if (!n) return;
      try { wardrobe = await api('skins:addFromUsername', n); staged = wardrobe[0].id; previewDefault = null; show(wardrobe[0].data, wardrobe[0].variant); drawWardrobe(); stage(); toast(`Added ${n}'s skin`); } catch (e) { toastErr(e); }
    };

    // Current skin + capes
    current = await api('skins:current').catch(() => null);
    wearing = await api('skins:wearing', current?.url || null).catch(() => null);
    if (!el.isConnected) return () => { if (viewer) { clearInterval(viewer._capeTimer); viewer.dispose(); } };
    show(current?.skin, current?.variant, current?.cape || null);
    drawWardrobe(); drawDefaults(); stage();
    // game files may finish loading after the page opened (first run)
    if (!McIcons.ready()) McIcons.init().then((ok) => { if (ok && el.isConnected) { if (!current?.skin && !staged) show(null); drawWardrobe(); drawDefaults(); stage(); } });
    if (acct?.type === 'msa') {
      try {
        const capes = await api('skins:capes');
        if (capes.length) {
          $('#capes-wrap', el).innerHTML = `<h2 style="margin-top:0">Capes</h2><div class="row wrap" style="margin-bottom:10px"><div class="cape ${capes.every((c) => c.state !== 'ACTIVE') ? 'on' : ''}" data-cape="">None</div>${capes.map((c) => `<div class="cape ${c.state === 'ACTIVE' ? 'on' : ''}" data-cape="${esc(c.id)}" title="${esc(c.alias)}"><canvas width="80" height="128" style="width:100%;height:100%"></canvas></div>`).join('')}</div>`;
          for (const c of capes) {
            const cv = $(`[data-cape="${CSS.escape(c.id)}"] canvas`, el);
            const img = new Image();
            img.onload = () => { const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 1, 1, 10, 16, 0, 0, 80, 128); };
            img.src = c.url.replace('http://', 'https://');
          }
          $$('[data-cape]', el).forEach((d) => (d.onclick = async () => {
            try { await api('skins:setCape', d.dataset.cape || null); $$('[data-cape]', el).forEach((x) => x.classList.toggle('on', x === d)); toast('Cape updated'); const c = capes.find((x) => x.id === d.dataset.cape); if (viewer) loadCape(viewer, c ? c.url.replace('http://', 'https://') : null); }
            catch (e) { toastErr(e); }
          }));
        }
      } catch {}
    }
    return () => { if (viewer) { clearInterval(viewer._capeTimer); viewer.dispose(); } };
  },
};
