Pages.skins = {
  async render(el, params, ctx) {
    const acct = State.accounts.accounts.find((a) => a.id === State.accounts.active);
    let wardrobe = await api('skins:list');
    let staged = null; // skin id staged for Apply
    let current = null;
    el.innerHTML = `
      <div class="page-head"><div><h1>${T('Skins')}</h1><div class="sub">Your wardrobe — preview, then apply to your Microsoft account</div></div>
        <div class="actions"><button class="btn" id="from-user">${icon('user')}From username</button><button class="btn primary" id="from-file">${icon('upload')}Upload skin</button></div></div>
      <div class="skins-layout">
        <div class="viewer">
          <canvas id="sv" width="300" height="400"></canvas>
          <div class="row"><div class="seg"><button data-anim="walk" class="on">Walk</button><button data-anim="idle">Idle</button><button data-anim="run">Run</button></div><button class="icon-btn" id="rot" title="Auto-rotate">${icon('refresh')}</button></div>
          <div id="stage-info" class="small muted" style="text-align:center"></div>
          <button class="btn primary" id="apply" disabled style="width:100%">${icon('check')}Apply skin</button>
          ${acct?.type === 'msa' ? '' : '<div class="faint small" style="text-align:center">Applying skins and capes needs a Microsoft account. Offline players see the default skin in-game.</div>'}
        </div>
        <div>
          <div id="capes-wrap"></div>
          <h2 style="margin-top:0">Wardrobe</h2>
          <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))" id="wardrobe"></div>
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
    const show = (src, variant, cape) => {
      if (viewer) { viewer.loadSkin(src || STEVE_FULL(), { model: variant === 'slim' ? 'slim' : 'default' }); if (cape !== undefined) cape ? viewer.loadCape(cape) : viewer.resetCape(); }
      else if (src) drawSkinFront($('#sv', el), src, variant === 'slim');
    };
    $$('[data-anim]', el).forEach((b) => (b.onclick = () => {
      $$('[data-anim]', el).forEach((x) => x.classList.toggle('on', x === b));
      if (!viewer) return;
      viewer.animation = b.dataset.anim === 'walk' ? new skinview3d.WalkingAnimation() : b.dataset.anim === 'run' ? new skinview3d.RunningAnimation() : new skinview3d.IdleAnimation();
    }));
    $('#rot', el).onclick = () => { if (viewer) viewer.autoRotate = !viewer.autoRotate; };

    const drawWardrobe = () => {
      $('#wardrobe', el).innerHTML = (current?.skin ? `<div class="skin-tile ${staged === null ? 'on' : ''}" data-current><canvas></canvas><div class="n">Current</div><div class="faint small">${esc(current.variant)}</div></div>` : '') +
        wardrobe.map((s) => `<div class="skin-tile ${staged === s.id ? 'on' : ''}" data-skin="${esc(s.id)}"><button class="icon-btn x" data-rm="${esc(s.id)}">${icon('trash')}</button><canvas></canvas><div class="n">${esc(s.name)}</div><div class="faint small" data-variant="${esc(s.id)}" style="cursor:pointer" title="Toggle arm model">${s.variant === 'slim' ? 'Slim (Alex)' : 'Classic (Steve)'}</div></div>`).join('') +
        (!wardrobe.length && !current?.skin ? `<div class="empty" style="grid-column:1/-1">${icon('skins')}<div>Upload a skin PNG or grab one from any player's username.</div></div>` : '');
      if (current?.skin) drawSkinFront($('[data-current] canvas', el), current.skin, current.variant === 'slim');
      for (const s of wardrobe) { const c = $(`[data-skin="${CSS.escape(s.id)}"] canvas`, el); if (c && s.data) drawSkinFront(c, s.data, s.variant === 'slim'); }
      const cur = $('[data-current]', el);
      if (cur) cur.onclick = () => { staged = null; show(current.skin, current.variant); stage(); drawWardrobe(); };
      $$('[data-skin]', el).forEach((t) => (t.onclick = (e) => {
        if (e.target.closest('[data-rm],[data-variant]')) return;
        const s = wardrobe.find((x) => x.id === t.dataset.skin);
        staged = s.id; show(s.data, s.variant); stage(); drawWardrobe();
      }));
      $$('[data-rm]', el).forEach((b) => (b.onclick = async () => { if (await confirmDialog('Remove this skin from your wardrobe?', { danger: true, ok: 'Remove' })) { wardrobe = await api('skins:remove', b.dataset.rm); if (staged === b.dataset.rm) staged = null; stage(); drawWardrobe(); } }));
      $$('[data-variant]', el).forEach((b) => (b.onclick = async () => { const s = wardrobe.find((x) => x.id === b.dataset.variant); wardrobe = await api('skins:update', s.id, { variant: s.variant === 'slim' ? 'classic' : 'slim' }); if (staged === s.id) { const n = wardrobe.find((x) => x.id === s.id); show(n.data, n.variant); } drawWardrobe(); }));
    };
    const stage = () => {
      const s = wardrobe.find((x) => x.id === staged);
      $('#apply', el).disabled = !s || acct?.type !== 'msa';
      $('#stage-info', el).textContent = s ? `Staged: ${s.name} — press Apply to upload` : current?.skin ? 'Showing your current skin' : '';
    };
    $('#apply', el).onclick = async () => {
      const b = $('#apply', el); b.disabled = true;
      try { await api('skins:apply', staged); toast('Skin applied! It may take a minute to show in-game.'); current = await api('skins:current'); staged = null; drawWardrobe(); stage(); }
      catch (e) { toastErr(e); b.disabled = false; }
    };
    $('#from-file', el).onclick = async () => {
      const variant = (await confirmDialog('Does this skin use slim (3-pixel) arms?', { title: 'Arm model', ok: 'Slim arms' })) ? 'slim' : 'classic';
      try { wardrobe = await api('skins:addFile', variant); if (wardrobe[0]) { staged = wardrobe[0].id; show(wardrobe[0].data, wardrobe[0].variant); } drawWardrobe(); stage(); } catch (e) { toastErr(e); }
    };
    $('#from-user', el).onclick = async () => {
      const n = await promptDialog('Copy skin from player', { placeholder: 'Minecraft username', ok: 'Add' });
      if (!n) return;
      try { wardrobe = await api('skins:addFromUsername', n); staged = wardrobe[0].id; show(wardrobe[0].data, wardrobe[0].variant); drawWardrobe(); stage(); toast(`Added ${n}'s skin`); } catch (e) { toastErr(e); }
    };

    // Current skin + capes
    current = await api('skins:current');
    show(current?.skin, current?.variant, current?.cape || null);
    drawWardrobe(); stage();
    if (acct?.type === 'msa') {
      try {
        const capes = await api('skins:capes');
        if (capes.length) {
          $('#capes-wrap', el).innerHTML = `<h2 style="margin-top:0">Capes</h2><div class="row wrap" style="margin-bottom:10px"><div class="cape ${capes.every((c) => c.state !== 'ACTIVE') ? 'on' : ''}" data-cape="">None</div>${capes.map((c) => `<div class="cape ${c.state === 'ACTIVE' ? 'on' : ''}" data-cape="${esc(c.id)}" title="${esc(c.alias)}"><canvas width="10" height="16" style="width:100%;height:100%;image-rendering:pixelated"></canvas></div>`).join('')}</div>`;
          for (const c of capes) {
            const cv = $(`[data-cape="${CSS.escape(c.id)}"] canvas`, el);
            const img = new Image();
            img.onload = () => { const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 1, 1, 10, 16, 0, 0, 10, 16); };
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
// Full default-ish skin for the 3D viewer when an account has none.
function STEVE_FULL() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  const box = (u, v, w, h, d, col) => { x.fillStyle = col; x.fillRect(u, v + d, 2 * (w + d), h); x.fillRect(u + d, v, 2 * w, d); };
  box(0, 0, 8, 8, 8, '#b4845f');
  x.fillStyle = '#3a2a1a'; x.fillRect(8, 8, 8, 2); x.fillStyle = '#fff'; x.fillRect(9, 12, 2, 1); x.fillRect(13, 12, 2, 1); x.fillStyle = '#4a3cb0'; x.fillRect(10, 12, 1, 1); x.fillRect(13, 12, 1, 1);
  box(16, 16, 8, 12, 4, '#2fa6a6'); box(40, 16, 4, 12, 4, '#2fa6a6'); box(32, 48, 4, 12, 4, '#2fa6a6');
  x.fillStyle = '#b4845f'; x.fillRect(40, 28, 16, 4); x.fillRect(32, 60, 16, 4);
  box(0, 16, 4, 12, 4, '#3b3b9a'); box(16, 48, 4, 12, 4, '#3b3b9a');
  return c.toDataURL();
}
