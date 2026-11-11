Pages.gallery = {
  async render(el) {
    let shots = await api('gallery:list');
    let filter = 'all';
    const draw = () => {
      const insts = [...new Map(shots.map((s) => [s.instanceId, s.instanceName])).entries()];
      const list = filter === 'all' ? shots : shots.filter((s) => s.instanceId === filter);
      el.innerHTML = `
        <div class="page-head"><div><h1>${T('Gallery')}</h1><div class="sub">${shots.length} screenshots across all instances · press F2 in-game to take one</div></div>
          <div class="actions"><select id="gf"><option value="all">All instances</option>${insts.map(([id, n]) => `<option value="${esc(id)}" ${id === filter ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div></div>
        ${list.length ? `<div class="shots">${list.map((s, i) => `<div class="shot" data-i="${i}"><img src="${esc(s.url)}" loading="lazy"><div class="cap"><b>${esc(s.instanceName)}</b> · ${timeAgo(s.mtime)}</div></div>`).join('')}</div>` : `<div class="empty">${icon('gallery')}<div>No screenshots yet.</div></div>`}`;
      $('#gf', el).onchange = (e) => { filter = e.target.value; draw(); };
      $$('[data-i]', el).forEach((d) => (d.onclick = () => open(list, +d.dataset.i)));
    };
    const open = (list, i) => {
      const s = list[i];
      const lb = lightbox(s.url, `<button class="btn" data-prev>${icon('back')}</button><button class="btn" data-folder>${icon('folder')}Show in folder</button><button class="btn danger" data-del>${icon('trash')}${T('Delete')}</button><button class="btn" data-next>${icon('fwd')}</button>`);
      $('[data-prev]', lb.el).onclick = (e) => { e.stopPropagation(); lb.close(); open(list, (i - 1 + list.length) % list.length); };
      $('[data-next]', lb.el).onclick = (e) => { e.stopPropagation(); lb.close(); open(list, (i + 1) % list.length); };
      $('[data-folder]', lb.el).onclick = (e) => { e.stopPropagation(); api('shell:showItem', s.path); };
      $('[data-del]', lb.el).onclick = async (e) => { e.stopPropagation(); await api('gallery:delete', s.path); lb.close(); shots = shots.filter((x) => x.path !== s.path); draw(); toast('Moved to Recycle Bin'); };
    };
    draw();
  },
};
