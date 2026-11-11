Pages.skins = {
  async render(el, params, ctx) {
    const acct = State.accounts.accounts.find((a) => a.id === State.accounts.active);
    let wardrobe = await api('skins:list');
    let staged = null; // wardrobe skin id staged for Apply
    let previewDefault = null; // default skin being previewed ({ name, model })
    let defModel = 'wide';
    let current = null;
    el.innerHTML = `
      <div class="page-head"><div><h1>${T('Skins')}</h1><div class="sub">Your wardrobe — preview in 3D, then apply to your Microsoft account</div></div>
        <div class="actions"><button class="btn" id="from-user">${icon('user')}From username</button><button class="btn primary" id="from-file">${icon('upload')}Upload skin</button></div></div>
      <div class="skins-layout">
        <div class="viewer">
          <canvas id="sv" width="300" height="400"></canvas>
          <div class="row"><div class="seg"><button data-anim="walk" class="on">Walk</button><button data-anim="idle">Idle</button><button data-anim="run">Run</button></div><button class="icon-btn" id="rot" title="Auto-rotate">${icon('refresh')}</button></div>
          <div id="stage-info" class="small muted" style="text-align:center"></div>
          <button class="btn primary" id="apply" disabled style="width:100%">${icon('check')}Apply skin</button>
          ${acct?.type === 'msa' ? '' : '<div class="faint small" style="text-align:center">Applying skins and capes needs a Microsoft account. Offline players see their default skin in-game.</div>'}
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
    if (window.skinview3d) {
      try {
        viewer = new skinview3d.SkinViewer({ canvas: $('#sv', el), width: 300, height: 400 });
        viewer.zoom = 0.82;
        viewer.autoRotate = true;
        viewer.autoRotateSpeed = 0.6;
        viewer.animation = new skinview3d.WalkingAnimation();
        viewer.animation.speed = 0.7;
      } catch (e) { console.warn(e); viewer = null; }
    }
    // the default skin Minecraft gives this account when it has no custom one
    const accountDefault = () => (acct ? McIcons.skinForUuid(acct.uuid) : McIcons.defaultSkin('steve', 'wide'));
    const show = (src, variant, cape) => {
      if (!src) { const d = accountDefault(); if (d) { src = d.src; variant = d.model === 'slim' ? 'slim' : 'classic'; } }
      if (viewer) {
        if (src) viewer.loadSkin(src, { model: variant === 'slim' ? 'slim' : 'default' }); else viewer.resetSkin();
        if (cape !== undefined) cape ? viewer.loadCape(cape) : viewer.resetCape();
      } else if (src) drawSkinFront($('#sv', el), src, variant === 'slim');
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
    const tile = (attrs, name, sub, extra = '') => `<div class="skin-tile" ${attrs}>${extra}<div class="skin-shot"><img alt=""></div><div class="n">${esc(name)}</div><div class="faint small">${sub}</div></div>`;

    const drawWardrobe = () => {
      const box = $('#wardrobe', el);
      const def = accountDefault();
      const curSrc = current?.skin || def?.src;
      const curSlim = current?.skin ? current.variant === 'slim' : def?.model === 'slim';
      box.innerHTML = (curSrc ? tile('data-current', 'Current', current?.skin ? (curSlim ? 'Slim' : 'Classic') : `Default · ${def.name[0].toUpperCase() + def.name.slice(1)}`) : '') +
        wardrobe.map((s) => tile(`data-skin="${esc(s.id)}"`, s.name, `<span data-variant="${esc(s.id)}" style="cursor:pointer" title="Toggle arm model">${s.variant === 'slim' ? 'Slim arms' : 'Classic arms'}</span>`, `<button class="icon-btn x" data-rm="${esc(s.id)}" title="Remove">${icon('trash')}</button>`)).join('') +
        (!wardrobe.length ? `<div class="empty small" style="grid-column:1/-1;padding:24px">${icon('skins')}<div>Upload a skin PNG or grab one from any player's username.</div></div>` : '');
      const cur = $('[data-current]', box);
      if (cur) { paint(cur, curSrc, curSlim); cur.onclick = () => { staged = null; previewDefault = null; show(current?.skin, current?.variant); stage(); mark(); }; }
      for (const s of wardrobe) { const t = $(`[data-skin="${CSS.escape(s.id)}"]`, box); if (t && s.data) paint(t, s.data, s.variant === 'slim'); }
      $$('[data-skin]', box).forEach((t) => (t.onclick = (e) => {
        if (e.target.closest('[data-rm],[data-variant]')) return;
        const s = wardrobe.find((x) => x.id === t.dataset.skin);
        staged = s.id; previewDefault = null; show(s.data, s.variant); stage(); mark();
      }));
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
      $('#apply', el).disabled = !s || acct?.type !== 'msa';
      const cap = (n) => n[0].toUpperCase() + n.slice(1);
      $('#stage-info', el).textContent = s ? `Staged: ${s.name} — press Apply to upload`
        : previewDefault ? `Previewing Minecraft's default ${cap(previewDefault.name)} skin`
        : current?.skin ? 'Showing your current skin' : acct ? `No custom skin — in-game you appear as ${cap(accountDefault()?.name || 'Steve')}` : '';
    };
    $('#apply', el).onclick = async () => {
      const b = $('#apply', el); b.disabled = true;
      try { await api('skins:apply', staged); toast('Skin applied! It may take a minute to show in-game.'); current = await api('skins:current'); staged = null; drawWardrobe(); stage(); }
      catch (e) { toastErr(e); b.disabled = false; }
    };
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
    if (!el.isConnected) return () => { if (viewer) viewer.dispose(); };
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
            try { await api('skins:setCape', d.dataset.cape || null); $$('[data-cape]', el).forEach((x) => x.classList.toggle('on', x === d)); toast('Cape updated'); const c = capes.find((x) => x.id === d.dataset.cape); if (viewer) c ? viewer.loadCape(c.url.replace('http://', 'https://')) : viewer.resetCape(); }
            catch (e) { toastErr(e); }
          }));
        }
      } catch {}
    }
    return () => { if (viewer) viewer.dispose(); };
  },
};
