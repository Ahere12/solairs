Pages.changelog = {
  async render(el) {
    const log = await api('data:changelog');
    let filter = 'all';
    const TYPE = { feature: ['accent', 'Feature'], improvement: ['info', 'Improvement'], bugfix: ['danger', 'Bug fix'] };
    const draw = () => {
      el.innerHTML = `<div class="page-head"><div><h1>${T('Changelog')}</h1><div class="sub">Explore the latest changes across Solaris</div></div>
        <div class="actions"><div class="seg">${['all', 'feature', 'improvement', 'bugfix'].map((t) => `<button data-f="${t}" class="${t === filter ? 'on' : ''}">${t === 'all' ? 'All' : TYPE[t][1]}</button>`).join('')}</div></div></div>
        ${log.map((r) => `<div class="release"><div class="side"><div class="prod">${esc(r.product)}</div><div class="v">v${esc(r.version)}</div><div class="faint small">${fmtDate(r.date)}</div>${r.title ? `<div class="muted small" style="margin-top:6px">${esc(r.title)}</div>` : ''}</div>
          <div>${r.groups.map((g) => { const es = g.entries.filter((e) => filter === 'all' || e.type === filter); return es.length ? `<div class="area"><h4>${esc(g.area)}</h4>${es.map((e) => `<div class="entry"><span class="chip ${TYPE[e.type]?.[0] || ''}">${TYPE[e.type]?.[1] || esc(e.type)}</span><span>${esc(e.text)}</span></div>`).join('')}</div>` : ''; }).join('')}</div></div>`).join('')}`;
      $$('[data-f]', el).forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
    };
    draw();
  },
};

Pages.roadmap = {
  async render(el) {
    const r = await api('data:roadmap');
    const cols = [['todo', 'To do', 'plus', 'var(--muted)'], ['progress', 'In progress', 'refresh', 'var(--warn)'], ['done', 'Completed', 'check', 'var(--ok)'], ['paused', 'Paused', 'stop', 'var(--faint)']];
    el.innerHTML = `<div class="page-head"><div><h1>${T('Roadmap')}</h1><div class="sub">What we're building next for Solaris</div></div></div>
      <div class="kanban">${cols.map(([k, label, ic, color]) => `<div class="col"><h3 style="color:${color}">${icon(ic)}${label}<span class="chip" style="margin-left:auto">${(r[k] || []).length}</span></h3>
        ${(r[k] || []).map((it) => `<div class="item"><div class="t">${esc(it.title)}</div><div class="d">${esc(it.text)}</div></div>`).join('') || '<div class="faint small" style="padding:8px">Nothing here right now.</div>'}</div>`).join('')}</div>`;
  },
};
