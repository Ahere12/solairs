/* Astra Connect: every integration in one place — what it is, whether it really works right now, its settings. */
const CONNECT_STATE = {
  connected: ['ok', 'Connected'], ready: ['ready', 'Ready'], 'needs-setup': ['warn', 'Needs setup'], off: ['off', 'Off'],
  error: ['err', 'Problem'], unavailable: ['off', 'Unavailable'], planned: ['off', 'Planned'],
};

Pages.connect = {
  view: { tab: 'installed', cat: 'all', q: '' },

  async render(el, params, ctx) {
    el.innerHTML = `<div class="page-head"><div><h1>Astra Connect</h1><div class="sub">Maps, friends, servers and player tools — every service Astra connects to, and whether it’s working right now.</div></div>
        <div class="actions"><button class="btn" id="cn-refresh">${icon('refresh')}Check again</button></div></div>
      <div class="row cn-bar"><div class="hs-filter" id="cn-tabs"><button data-tab="installed">Installed</button><button data-tab="discover">Discover</button></div>
        <div class="hs-filter" id="cn-cats"></div><div class="grow"></div>
        <div class="search" style="max-width:260px">${icon('search')}<input type="search" id="cn-q" placeholder="Search integrations…"></div></div>
      <div id="cn-list"><div class="faint">${icon('refresh', 'spin')} Checking every integration…</div></div>`;
    let list = [];
    const v = this.view;
    $('#cn-q', el).value = v.q;
    const draw = () => {
      if (!el.isConnected) return;
      $$('#cn-tabs [data-tab]', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === v.tab));
      const cats = [['all', 'All'], ...[...new Map(list.map((i) => [i.category, i.categoryName]))]];
      $('#cn-cats', el).innerHTML = cats.map(([k, n]) => `<button data-cat="${k}" class="${v.cat === k ? 'on' : ''}">${esc(n)}</button>`).join('');
      $$('[data-cat]', el).forEach((b) => (b.onclick = () => { v.cat = b.dataset.cat; draw(); }));
      const q = v.q.trim().toLowerCase();
      // Installed: built into Astra and usable. Discover: everything, including planned and unavailable ones.
      const shown = list.filter((i) => (v.tab === 'discover' || !['planned', 'unavailable'].includes(i.status?.state))
        && (v.cat === 'all' || i.category === v.cat)
        && (!q || `${i.name} ${i.description} ${i.categoryName} ${i.types.map((t) => t.name).join(' ')}`.toLowerCase().includes(q)));
      const groups = [...new Set(shown.map((i) => i.category))];
      $('#cn-list', el).innerHTML = shown.length ? groups.map((g) => `<h3 class="cn-group">${esc(shown.find((i) => i.category === g).categoryName)}</h3>
          <div class="cn-grid">${shown.filter((i) => i.category === g).map((i) => this.card(i)).join('')}</div>`).join('')
        : `<div class="empty">${icon('search')}<div>No integrations match.</div></div>`;
      $$('[data-cn]', el).forEach((c) => (c.onclick = (e) => { if (e.target.closest('.switch')) return; this.details(c.dataset.cn, () => load(false)); }));
      $$('[data-cn-tg]', el).forEach((t) => (t.onchange = async () => {
        t.disabled = true;
        try { const i = await api('connect:setEnabled', t.dataset.cnTg, t.checked); list = list.map((x) => (x.id === i.id ? i : x)); toast(`${i.name} ${i.enabled ? 'on' : 'off'}`); } catch (e) { toastErr(e); t.checked = !t.checked; }
        draw();
      }));
    };
    const load = async (spin = true) => {
      if (spin) $('#cn-refresh', el).innerHTML = `${icon('refresh', 'spin')}Checking…`;
      try { list = await api('connect:list'); } catch (e) { $('#cn-list', el).innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
      if (el.isConnected) $('#cn-refresh', el).innerHTML = `${icon('refresh')}Check again`;
      draw();
    };
    $$('#cn-tabs [data-tab]', el).forEach((b) => (b.onclick = () => { v.tab = b.dataset.tab; draw(); }));
    $('#cn-q', el).oninput = (e) => { v.q = e.target.value; draw(); };
    $('#cn-refresh', el).onclick = () => load();
    await load(false);
    // statuses follow what happens elsewhere in Astra (servers starting, playit.gg connecting…)
    const soon = debounce(() => load(false), 1500);
    ctx.on('hosted', soon); ctx.on('playit', soon); ctx.on('connect-watch', soon);
  },

  /** An integration's live table (e.g. the watched servers), from connect:details. */
  async table(box, id) {
    try {
      const t = await api('connect:details', id);
      if (!box.isConnected) return;
      if (!t) { box.innerHTML = ''; return; }
      box.innerHTML = (t.rows.length ? `<table class="hs-ptable"><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td class="small">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '<div class="faint small">Nothing to show yet.</div>')
        + (t.note ? `<div class="faint small" style="margin-top:4px">${esc(t.note)}</div>` : '');
    } catch (e) { if (box.isConnected) box.innerHTML = `<div class="danger-text small">${esc(e.message)}</div>`; }
  },

  dot(s) { const [cls, label] = CONNECT_STATE[s?.state] || ['off', '…']; return `<span class="cn-state ${cls}"><i></i>${label}</span>`; },

  card(i) {
    return `<div class="cn-card ${i.status?.state === 'planned' || i.status?.state === 'unavailable' ? 'dim' : ''}" data-cn="${esc(i.id)}">
      <div class="row" style="gap:10px"><span class="cn-ic">${icon(i.icon)}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(i.name)}</b><div class="faint small ellipsis">${i.types.map((t) => esc(t.name)).join(' · ')}</div></div>
        ${i.canToggle ? `<label class="switch" title="${i.enabled ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-cn-tg="${esc(i.id)}" ${i.enabled ? 'checked' : ''}><span></span></label>` : ''}</div>
      <div class="small cn-desc">${esc(i.description)}</div>
      <div class="row small" style="gap:8px">${this.dot(i.status)}<span class="faint ellipsis grow" title="${esc(i.status?.text || '')}">${esc(i.status?.text || '')}</span></div></div>`;
  },

  /** One integration: what it is, real status, compatibility with your servers, settings, recent problems, docs. */
  async details(id, onChange) {
    let i; try { i = await api('connect:get', id); } catch (e) { return toastErr(e); }
    const compat = i.compat?.software ? await api('connect:compatibility', id).catch(() => []) : null;
    const m = modal({ title: i.name, wide: true, body: '<div id="cn-d"></div>', footer: `<button class="btn" data-x>${T('Close')}</button>` });
    m.$('[data-x]').onclick = () => m.close();
    const field = (f) => {
      const val = i.values[f.key];
      if (f.type === 'bool') return `<div class="hs-set"><span class="grow">${esc(f.label)}${f.help ? ` <span class="info" title="${esc(f.help)}">${icon('info')}</span>` : ''}</span><label class="switch"><input type="checkbox" data-cf="${esc(f.key)}" ${val ? 'checked' : ''}><span></span></label></div>`;
      if (f.type === 'select') return `<label class="field">${esc(f.label)}<select data-cf="${esc(f.key)}">${f.options.map((o) => { const ov = o.value ?? o, on = o.label ?? o; return `<option value="${esc(ov)}" ${ov === val ? 'selected' : ''}>${esc(on)}</option>`; }).join('')}</select></label>`;
      if (f.type === 'secret') return `<label class="field">${esc(f.label)} <span class="faint small">${val?.set ? '(saved — type to replace)' : '(not set)'}</span><input type="password" data-cf="${esc(f.key)}" autocomplete="off" spellcheck="false" placeholder="${val?.set ? '••••••••' : ''}"></label>`;
      return `<label class="field">${esc(f.label)}<input type="${f.type === 'number' ? 'number' : 'text'}" data-cf="${esc(f.key)}" value="${esc(val ?? '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} spellcheck="false"></label>`;
    };
    const draw = () => {
      const st = i.status || {};
      m.$('#cn-d').innerHTML = `<div class="stack">
        <div class="row" style="gap:12px"><span class="cn-ic lg">${icon(i.icon)}</span><div class="grow"><div class="faint small">${esc(i.categoryName)} · ${i.types.map((t) => esc(t.name)).join(' · ')}</div><div>${esc(i.description)}</div></div>
          ${i.canToggle ? `<label class="row small" style="gap:8px"><label class="switch"><input type="checkbox" id="cn-on" ${i.enabled ? 'checked' : ''}><span></span></label>${i.enabled ? 'On' : 'Off'}</label>` : i.core ? '<span class="chip">Part of Astra</span>' : ''}</div>
        <div class="card row" style="gap:10px;padding:10px 12px">${this.dot(st)}<span class="grow small">${esc(st.text || '')}</span>${st.at ? `<span class="faint small">checked ${timeAgo(st.at)}</span>` : ''}${['planned', 'unavailable'].includes(st.state) ? '' : `<button class="btn sm" id="cn-check">${icon('refresh')}Check</button>`}</div>
        ${i.hasDetails && i.enabled ? '<div id="cn-table"><div class="faint small">Loading…</div></div>' : ''}
        ${compat ? `<div><h4 style="margin:4px 0">Works with your servers</h4>${compat.length ? `<div class="stack" style="gap:2px">${compat.map((c) => `<div class="row small hs-person">${c.ok ? `<span class="ok-text">${icon('check')}</span>` : `<span class="faint">${icon('close')}</span>`}<b class="grow">${esc(c.name)}</b><span class="faint">${c.ok ? esc(c.software) : esc(c.why)}</span></div>`).join('')}</div>` : '<div class="faint small">You don’t host any servers yet.</div>'}${i.compat.note ? `<div class="faint small">${esc(i.compat.note)}</div>` : ''}</div>` : ''}
        ${i.config.length ? `<div><h4 style="margin:4px 0">Settings</h4><div class="stack" id="cn-cfg">${i.config.map(field).join('')}</div><div class="row" style="margin-top:8px"><div class="grow"></div><button class="btn sm primary" id="cn-save">${icon('check')}Save</button></div></div>` : ''}
        ${i.errors.length ? `<div><div class="row"><h4 class="grow" style="margin:4px 0">Recent problems</h4><button class="btn sm ghost" id="cn-clear">Clear</button></div><div class="stack" style="gap:2px">${i.errors.map((e) => `<div class="small"><span class="faint">${timeAgo(e.at)}</span> · <span class="danger-text">${esc(e.message)}</span></div>`).join('')}</div></div>` : ''}
        <div class="row" style="gap:8px">${i.page ? `<button class="btn sm primary" id="cn-open">${icon('fwd')}Open in Astra</button>` : ''}${i.docs ? `<button class="btn sm" id="cn-docs">${icon('external')}Documentation</button>` : ''}</div></div>`;
      if (m.$('#cn-table')) this.table(m.$('#cn-table'), id);
      const on = m.$('#cn-on');
      if (on) on.onchange = async () => { on.disabled = true; try { i = await api('connect:setEnabled', id, on.checked); onChange && onChange(); } catch (e) { toastErr(e); } draw(); };
      if (m.$('#cn-check')) m.$('#cn-check').onclick = async () => { try { i = await api('connect:get', id); onChange && onChange(); } catch (e) { toastErr(e); } draw(); };
      if (m.$('#cn-save')) m.$('#cn-save').onclick = async () => {
        const patch = {};
        $$('[data-cf]', m.el).forEach((c) => { const f = i.config.find((x) => x.key === c.dataset.cf); if (f.type === 'secret' && !c.value) return; patch[f.key] = f.type === 'bool' ? c.checked : c.value; });
        try { i = await api('connect:setConfig', id, patch); toast('Saved'); onChange && onChange(); } catch (e) { toastErr(e); }
        draw();
      };
      if (m.$('#cn-clear')) m.$('#cn-clear').onclick = async () => { await api('connect:clearErrors', id).catch(toastErr); i.errors = []; draw(); };
      if (m.$('#cn-open')) m.$('#cn-open').onclick = () => { m.close(); Router.go(i.page); };
      if (m.$('#cn-docs')) m.$('#cn-docs').onclick = () => api('shell:open', i.docs);
    };
    draw();
  },
};

window.solaris.on('connect:watch', (v) => Bus.emit('connect-watch', v));
