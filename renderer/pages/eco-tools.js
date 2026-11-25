/* Astra ecosystem pages, part 1: Modpack health, Assistant, Analytics, Developer Hub. Backend: src/eco/. */
const sevChip = (s) => `<span class="chip ${s === 'error' ? 'danger' : s === 'warning' ? 'warn' : 'info'}">${s === 'error' ? 'Problem' : s === 'warning' ? 'Warning' : 'Note'}</span>`;
const gradeColor = (g) => ({ healthy: 'var(--ok)', good: 'var(--ok)', 'needs-attention': 'var(--warn)', broken: 'var(--danger)' }[g] || 'var(--muted)');
const ecoBar = (frac, color = 'var(--accent)') => `<div class="eco-bar"><div style="width:${Math.max(0, Math.min(100, frac * 100))}%;background:${color}"></div></div>`;

/** Runs fn with a spinner on the button; errors become a toast (installFeedback hides them). */
async function ecoBusy(btn, fn) {
  if (!btn || btn.disabled) return;
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = icon('refresh', 'spin') + (btn.classList.contains('sm') ? '' : 'Working…');
  try { await fn(); } catch (e) { toastErr(e); }
  if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; }
}
/** Turns a mod on/off after the player confirms (the file is only renamed, so it can be undone). */
async function ecoToggleMod(instanceId, file, on) {
  if (!(await confirmDialog(`${on ? 'Turn on' : 'Turn off'} ${file}?\n\nThe file is only renamed (.disabled), so you can switch it back on the instance’s Content tab.`, { title: on ? 'Turn mod on' : 'Turn mod off', ok: on ? 'Turn on' : 'Turn off' }))) return false;
  try { await api('assistant:apply', { kind: on ? 'enable-mod' : 'disable-mod', instanceId, file }); toast(`${file} turned ${on ? 'on' : 'off'}`); return true; } catch (e) { toastErr(e); return false; }
}
/** Modrinth projects that may be a missing dependency; the player picks one to install. */
async function ecoFindMissing(instanceId, modId, done) {
  const m = modal({ title: `Find “${modId}”`, wide: true, body: '<div class="faint">Searching Modrinth…</div>' });
  try {
    const hits = await api('modpack:findMissing', instanceId, modId);
    m.$('.content').innerHTML = hits.length ? `<p class="muted small">Pick the right project. Astra installs the version that matches this instance, with its own dependencies.</p><div class="stack">${hits.map((h, i) => `<div class="row card" style="padding:10px">${h.icon ? `<img src="${esc(h.icon)}" style="width:36px;height:36px;border-radius:8px">` : icon('box')}<div class="grow" style="min-width:0"><b>${esc(h.title)}</b> ${h.exact ? '<span class="chip ok">exact id</span>' : ''}<div class="faint small ellipsis">${esc(h.description || '')}</div></div><button class="btn sm primary" data-i="${i}">${icon('download')}Install</button></div>`).join('')}</div>`
      : `<div class="empty">${icon('search')}<div>Nothing on Modrinth matches “${esc(modId)}”. Search the mod’s name in Browse, or check the mod’s page for where to get it.</div></div>`;
    $$('[data-i]', m.el).forEach((b) => (b.onclick = () => ecoBusy(b, async () => { await api('modrinth:install', instanceId, { projectId: hits[+b.dataset.i].id }); toast(`${hits[+b.dataset.i].title} installed`); m.close(); done && done(); })));
  } catch (e) { m.$('.content').innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
}

/* ---------- Modpack health ---------- */
Pages.modhealth = {
  async render(el, params) {
    const inst = State.instances.find((i) => i.id === params.id);
    if (!inst) { el.innerHTML = `<div class="empty">${icon('alert')}<div>That instance doesn’t exist any more.</div></div>`; return; }
    el.innerHTML = `<div class="page-head"><div><a href="#" id="mh-back" class="small">← ${esc(inst.name)}</a><h1>Modpack health</h1><div class="sub">Checks every mod’s own requirements: dependencies, versions, loader, duplicates and conflicts. Nothing is changed unless you press a fix.</div></div>
      <div class="actions"><button class="btn" id="mh-cmp">${icon('layers')}Compare with…</button><button class="btn" id="mh-upd">${icon('refresh')}Check for updates</button><button class="btn primary" id="mh-run">${icon('shield')}Check again</button></div></div><div id="mh-body"><div class="faint">Reading ${esc(inst.name)}’s mods…</div></div>`;
    $('#mh-back', el).onclick = (e) => { e.preventDefault(); Router.go('instance', { id: inst.id }); };
    const draw = async (withUpdates) => {
      const body = $('#mh-body', el);
      let r; try { r = await api(withUpdates ? 'modpack:checkUpdates' : 'modpack:check', inst.id); } catch (e) { body.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; return; }
      if (!el.isConnected) return;
      const h = r.health;
      body.innerHTML = `<div class="grid cols-3">
          <div class="card stat"><span class="v" style="color:${gradeColor(h.grade)}">${h.score}</span><span class="l">${esc(h.label)}</span>${ecoBar(h.score / 100, gradeColor(h.grade))}</div>
          <div class="card stat"><span class="v">${r.counts.enabled}<span class="faint small"> / ${r.counts.mods}</span></span><span class="l">Mods on${r.counts.notMods ? ` · ${r.counts.notMods} without mod info` : ''}</span></div>
          <div class="card stat"><span class="v">${r.counts.errors}<span class="faint small"> · ${r.counts.warnings}</span></span><span class="l">Problems · warnings${r.updates ? ` · ${r.updates.length} update${r.updates.length === 1 ? '' : 's'}` : ''}</span></div></div>
        ${r.recommendations.length ? `<h2>${icon('zap')} What to do</h2><div class="card stack">${r.recommendations.map((x) => `<div class="row"><span class="chip ${x.priority === 1 ? 'danger' : x.priority === 2 ? 'warn' : 'info'}">${x.priority === 1 ? 'First' : x.priority === 2 ? 'Next' : 'Later'}</span><span>${esc(x.text)}</span></div>`).join('')}</div>` : ''}
        <h2>${icon('list')} Findings</h2>
        ${r.findings.length ? `<div class="stack">${r.findings.map((f, i) => `<div class="card eco-finding"><div class="row">${sevChip(f.severity)}<b class="grow">${esc(f.title)}</b>${fixButton(f, i)}</div><div class="muted small">${esc(f.detail || '')}</div>${f.file ? `<div class="faint small mono">${esc(f.file)}</div>` : ''}</div>`).join('')}</div>`
          : `<div class="empty">${icon('check')}<div>No problems found — every mod has what it needs.</div></div>`}
        ${r.updatesError ? `<p class="small" style="color:var(--warn)">${esc(r.updatesError)}</p>` : ''}
        ${r.updates?.length ? `<h2>${icon('download')} Updates on Modrinth</h2><div class="card"><table class="hs-ptable"><tr><th>Mod</th><th>Installed</th><th>Newest</th><th></th></tr>${r.updates.map((u, i) => `<tr><td><b>${esc(u.name)}</b></td><td class="faint small">${esc(u.current || '?')}</td><td>${esc(u.latest.version)}</td><td><button class="btn sm" data-up="${i}">${icon('download')}Update</button></td></tr>`).join('')}</table></div>` : ''}
        <p class="faint small">Checked ${timeAgo(r.checkedAt)}. Astra reads fabric.mod.json, quilt.mod.json and mods.toml inside each jar, including mods carried inside other mods.</p>`;
      $$('[data-fix]', body).forEach((b) => (b.onclick = () => runFix(r.findings[+b.dataset.fix])));
      $$('[data-up]', body).forEach((b) => (b.onclick = () => ecoBusy(b, async () => { const u = r.updates[+b.dataset.up]; await api('instances:applyUpdate', inst.id, 'mods', u.file, u.latest.id); toast(`${u.name} updated`); draw(false); })));
    };
    const fixButton = (f, i) => {
      const k = f.fix?.kind;
      const label = { disable: 'Turn off', enable: 'Turn on', 'disable-older': 'Turn off older', install: 'Find it', choose: 'Choose one', update: 'Check updates', loader: 'Loader settings' }[k];
      return label ? `<button class="btn sm" data-fix="${i}">${esc(label)}</button>` : '';
    };
    const runFix = async (f) => {
      const k = f.fix.kind;
      if (k === 'disable') { if (await ecoToggleMod(inst.id, f.fix.file, false)) draw(false); }
      else if (k === 'enable') { if (await ecoToggleMod(inst.id, f.fix.file, true)) draw(false); }
      else if (k === 'disable-older') {
        if (!(await confirmDialog(`Keep ${f.fix.keep} and turn off:\n${f.fix.files.join('\n')}\n\nThe files are only renamed (.disabled).`, { title: 'Duplicate mod', ok: 'Turn off' }))) return;
        try { await api('instances:setEnabled', inst.id, 'mods', f.fix.files, false); toast('Older copies turned off'); draw(false); } catch (e) { toastErr(e); }
      } else if (k === 'install') ecoFindMissing(inst.id, f.fix.id, () => draw(false));
      else if (k === 'choose') {
        const m = modal({ title: 'Keep which one?', body: `<p class="muted">These two mods say they can’t run together. Turn one off (it’s only renamed).</p><div class="stack">${f.fix.files.map((x, i) => `<button class="btn" data-k="${i}">${icon('eye')}Turn off ${esc(x)}</button>`).join('')}</div>` });
        $$('[data-k]', m.el).forEach((b) => (b.onclick = async () => { m.close(); try { await api('instances:setEnabled', inst.id, 'mods', [f.fix.files[+b.dataset.k]], false); toast('Turned off'); draw(false); } catch (e) { toastErr(e); } }));
      } else if (k === 'update') draw(true);
      else if (k === 'loader') Router.go('instance', { id: inst.id, tab: 'settings' });
    };
    $('#mh-run', el).onclick = () => draw(false);
    $('#mh-upd', el).onclick = () => draw(true);
    $('#mh-cmp', el).onclick = async () => {
      const other = await chooseInstance({ title: `Compare ${inst.name} with…`, filter: (i) => i.id !== inst.id });
      if (!other) return;
      const c = await api('modpack:compare', inst.id, other.id).catch((e) => (toastErr(e), null));
      if (!c) return;
      const list = (rows) => rows.length ? rows.map((x) => `<div class="small">${esc(x.name)} <span class="faint">${esc(x.version || '')}</span></div>`).join('') : '<div class="faint small">—</div>';
      modal({ title: `${c.a.name} ↔ ${c.b.name}`, wide: true, body: `<p class="muted small">${c.same} mod${c.same === 1 ? ' is' : 's are'} the same in both. ${esc(c.a.mc)} ${esc(c.a.loader?.type || '')} vs ${esc(c.b.mc)} ${esc(c.b.loader?.type || '')}.</p>
        <div class="grid cols-3"><div class="card"><h4>Only in ${esc(c.a.name)} (${c.onlyA.length})</h4>${list(c.onlyA)}</div><div class="card"><h4>Only in ${esc(c.b.name)} (${c.onlyB.length})</h4>${list(c.onlyB)}</div>
        <div class="card"><h4>Different versions (${c.different.length})</h4>${c.different.length ? c.different.map((d) => `<div class="small">${esc(d.name)}: <span class="${d.newer === 'a' ? '' : 'faint'}">${esc(d.a || '?')}</span> ↔ <span class="${d.newer === 'b' ? '' : 'faint'}">${esc(d.b || '?')}</span></div>`).join('') : '<div class="faint small">—</div>'}</div></div>` });
    };
    draw(false);
  },
};

/* ---------- Assistant ---------- */
Pages.assistant = {
  async render(el, params) {
    let tab = params.tab || 'crash';
    let ai = await api('assistant:settings').catch(() => ({ status: { available: false } }));
    el.innerHTML = `<div class="page-head"><div><h1>Assistant</h1><div class="sub">Explains crashes, launcher errors and server problems, and suggests fixes. It never changes anything until you press a fix and confirm.</div></div>
      <div class="actions"><button class="btn" id="as-set">${icon('settings')}Ask Claude settings</button></div></div>
      <div class="tabs"><button data-t="crash">Game crash</button><button data-t="error">Launcher error</button><button data-t="server">Can’t join a server</button></div><div id="as-in"></div><div id="as-out"></div>`;
    const out = () => $('#as-out', el);
    const show = (t) => { tab = t; $$('[data-t]', el).forEach((b) => b.classList.toggle('on', b.dataset.t === t)); input(); out().innerHTML = ''; };
    $$('[data-t]', el).forEach((b) => (b.onclick = () => show(b.dataset.t)));
    $('#as-set', el).onclick = () => this.settings(async () => { ai = await api('assistant:settings'); });
    const input = async () => {
      const box = $('#as-in', el);
      if (tab === 'crash') {
        const runs = await api('launch:list').catch(() => ({ history: [] }));
        const recent = runs.history.filter((h) => h.code !== 0).slice(0, 10);
        box.innerHTML = `<div class="card stack"><div class="row wrap"><label class="field grow">A game session from this run of Astra<select id="as-run"><option value="">— paste a report instead —</option>${recent.map((h) => `<option value="${esc(h.runId)}" ${h.runId === params.runId ? 'selected' : ''}>${esc(h.name)} · exit ${h.code} · ${timeAgo(h.end)}</option>`).join('')}</select></label>
          <label class="field">Instance (for the mod check)<select id="as-inst"><option value="">None</option>${State.instances.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select></label></div>
          <textarea id="as-text" rows="8" placeholder="…or paste a crash report / latest.log here" style="width:100%;font-family:var(--mono);font-size:12px"></textarea>
          <div class="row"><div class="grow faint small">Read on this PC. Nothing is sent anywhere unless you press “Ask Claude”.</div><button class="btn primary" id="as-go">${icon('search')}Diagnose</button></div></div>`;
        $('#as-go', box).onclick = async () => {
          const runId = $('#as-run', box).value || null, text = $('#as-text', box).value, instanceId = $('#as-inst', box).value || null;
          out().innerHTML = '<div class="faint">Reading…</div>';
          try { const d = await api('assistant:crash', runId ? { runId } : { text, instanceId }); this.result(out(), d, { kind: 'crash', text: runId ? null : text, runId, instanceId: d.instanceId }, ai); }
          catch (e) { out().innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
        };
        if (params.runId) $('#as-go', box).click();
      } else if (tab === 'error') {
        box.innerHTML = `<div class="card stack"><textarea id="as-err" rows="4" placeholder="Paste the error message Astra showed" style="width:100%">${esc(params.error || '')}</textarea><div class="row"><div class="grow"></div><button class="btn primary" id="as-go">${icon('search')}Explain</button></div></div>`;
        $('#as-go', box).onclick = async () => { const d = await api('assistant:error', $('#as-err', box).value); this.result(out(), { kind: 'error', causes: d.causes, actions: [] }, { kind: 'launcher error', text: d.message }, ai); };
        if (params.error) $('#as-go', box).click();
      } else {
        box.innerHTML = `<div class="card row wrap"><label class="field grow">Server address<input type="text" id="as-addr" placeholder="play.example.com" value="${esc(params.address || '')}"></label>
          <label class="field">With instance<select id="as-inst"><option value="">Any</option>${State.instances.map((i) => `<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.versionId)})</option>`).join('')}</select></label><button class="btn primary" id="as-go" style="align-self:flex-end">${icon('wifi')}Test connection</button></div>`;
        $('#as-go', box).onclick = async () => {
          out().innerHTML = '<div class="faint">Testing each step…</div>';
          try { const d = await api('assistant:server', $('#as-addr', box).value, $('#as-inst', box).value || null); this.result(out(), d, { kind: 'server connection test', text: d.steps.map((s) => `${s.ok ? 'OK' : 'FAIL'} ${s.id}: ${s.text}`).join('\n'), local: d }, ai); }
          catch (e) { out().innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
        };
      }
    };
    show(tab);
  },
  /** Draws a diagnosis: causes, suspects, server steps, findings, fix buttons, and the optional Ask Claude box. */
  result(box, d, askInput, ai) {
    box.innerHTML = `${d.description ? `<p class="muted">Crash report: <b>${esc(d.description)}</b></p>` : ''}
      ${d.steps ? `<h2>${d.ok ? icon('check') : icon('alert')} ${esc(d.summary)}</h2><div class="card stack">${d.steps.map((s) => `<div class="row"><span class="chip ${s.ok ? (s.warn ? 'warn' : 'ok') : 'danger'}">${s.ok ? (s.warn ? 'Note' : 'OK') : 'Failed'}</span><b style="min-width:70px">${esc(s.id)}</b><span class="small">${esc(s.text)}</span></div>`).join('')}${d.software?.name ? `<div class="faint small">Server software: ${esc(d.software.name)} (${esc(d.software.confidence)})</div>` : ''}</div>` : ''}
      ${d.causes ? `<h2>What probably happened</h2>${d.causes.map((c) => `<div class="crash-cause"><b>${esc(c.title)}</b><div class="muted small">${esc(c.fix)}</div></div>`).join('')}` : ''}
      ${d.suspects?.length ? `<h2>Mods the crash points at</h2><div class="card stack">${d.suspects.map((s) => `<div class="row"><b>${esc(s.name || s.id)}</b>${s.file ? `<span class="faint small mono">${esc(s.file)}</span>` : '<span class="chip">not installed here</span>'}<span class="faint small grow">${esc(s.reasons.join(', '))}</span></div>`).join('')}</div>` : ''}
      ${d.findings?.length ? `<h2>Instance check</h2><div class="stack">${d.findings.map((f) => `<div class="row">${sevChip(f.severity)}<span class="small">${esc(f.title)}</span></div>`).join('')}</div>` : ''}
      ${d.actions?.length ? `<h2>Suggested fixes</h2><div class="stack">${d.actions.map((a, i) => `<div class="row card" style="padding:10px"><div class="grow"><b>${esc(a.label)}</b>${a.why ? `<div class="faint small">${esc(a.why)}</div>` : ''}</div><button class="btn sm" data-a="${i}">${icon('check')}Do it</button></div>`).join('')}</div>` : ''}
      <h2>${icon('zap')} Ask Claude</h2><div class="card stack" id="as-ai">${ai?.status?.configured ? `<p class="muted small">Sends a short summary to Anthropic (your API key): the report without your name, folders or tokens, the mod list and Astra’s findings above.</p><div class="row"><button class="btn" id="as-prev">${icon('eye')}See what’s sent</button><button class="btn primary" id="as-ask">${icon('zap')}Ask Claude</button></div><div id="as-ans"></div>` : `<p class="faint small">${esc(ai?.status?.why || 'Not set up.')}</p>`}</div>`;
    $$('[data-a]', box).forEach((b) => (b.onclick = async () => {
      const a = d.actions[+b.dataset.a];
      if (a.kind === 'find-mod') return ecoFindMissing(a.instanceId, a.modId);
      if (a.kind === 'open-settings') return Router.go('instance', { id: a.instanceId, tab: 'settings' });
      if (a.kind === 'disable-mod' || a.kind === 'enable-mod') { if (await ecoToggleMod(a.instanceId, a.file, a.kind === 'enable-mod')) b.disabled = true; return; }
      if (!(await confirmDialog(a.label + '?', { title: 'Suggested fix', ok: 'Do it' }))) return;
      try { const r = await api('assistant:apply', a); toast(r.text); b.disabled = true; } catch (e) { toastErr(e); }
    }));
    const prev = $('#as-prev', box), ask = $('#as-ask', box);
    const payload = { ...askInput, local: askInput.local || d };
    if (prev) prev.onclick = async () => { const t = await api('assistant:preview', payload); modal({ title: 'Sent to Claude', wide: true, body: `<pre class="mono small" style="white-space:pre-wrap;max-height:60vh;overflow:auto">${esc(t)}</pre>` }); };
    if (ask) ask.onclick = () => ecoBusy(ask, async () => {
      const r = await api('assistant:ask', payload);
      $('#as-ans', box).innerHTML = r.refused ? '<p class="muted">Claude declined to answer this one. Astra’s own diagnosis above still applies.</p>' : `<div class="eco-answer">${esc(r.text).replace(/\n/g, '<br>')}</div><div class="faint small">${esc(r.model || '')}${r.truncated ? ' · cut short' : ''} · Check suggestions before acting on them.</div>`;
    });
  },
  settings(onDone) {
    api('assistant:settings').then((s) => {
      const m = modal({ title: 'Ask Claude', body: `<p class="muted small">Optional. Astra’s own diagnosis always works offline. “Ask Claude” sends a cleaned-up summary to Anthropic’s API with <b>your own</b> API key (console.anthropic.com), only when you press it. The key is stored with Windows’ protected storage.</p>
        ${s.status.available ? '' : `<p class="small" style="color:var(--warn)">${esc(s.status.why)}</p>`}
        <div class="row" style="margin:10px 0"><b class="grow">Turn on “Ask Claude”</b><label class="switch"><input type="checkbox" id="ai-on" ${s.enabled ? 'checked' : ''}><span></span></label></div>
        <label class="field">Anthropic API key ${s.keySet ? '<span class="chip ok">saved</span>' : ''}<input type="password" id="ai-key" placeholder="${s.keySet ? 'Leave empty to keep the saved key' : 'sk-ant-…'}"></label>`,
        footer: `${s.keySet ? `<button class="btn ghost" data-clear>${icon('trash')}Forget key</button>` : ''}<button class="btn primary" data-save>${T('Save')}</button>` });
      const c = m.$('[data-clear]'); if (c) c.onclick = async () => { await api('assistant:setSettings', { clearKey: true }); m.close(); onDone && onDone(); };
      m.$('[data-save]').onclick = async () => { try { await api('assistant:setSettings', { enabled: m.$('#ai-on').checked, key: m.$('#ai-key').value }); m.close(); toast('Saved'); onDone && onDone(); } catch (e) { toastErr(e); } };
    });
  },
};

/* ---------- Analytics ---------- */
Pages.analytics = {
  async render(el) {
    el.innerHTML = `<div class="page-head"><div><h1>Analytics</h1><div class="sub">Your play sessions, recorded on this PC since this version of Astra. Nothing is sent anywhere.</div></div><div class="actions"><button class="btn ghost" id="an-clear">${icon('trash')}Clear history</button></div></div><div id="an"><div class="faint">Adding it up…</div></div>`;
    $('#an-clear', el).onclick = async () => { if (await confirmDialog('Delete the recorded session history? Play time per instance stays.', { title: 'Clear history', ok: 'Clear', danger: true })) { await api('analytics:clear'); this.render(el); } };
    const [r, w] = await Promise.all([api('analytics:overview'), api('analytics:worlds').catch(() => null)]);
    if (!el.isConnected) return;
    const t = r.totals;
    const maxDay = Math.max(1, ...r.perDay.map((d) => d.ms));
    const maxInst = Math.max(1, ...r.instances.map((i) => i.ms));
    $('#an', el).innerHTML = `<div class="grid cols-3">
        <div class="card stat"><span class="v">${fmtDuration(t.week)}</span><span class="l">This week · ${fmtDuration(t.month)} in 30 days</span></div>
        <div class="card stat"><span class="v">${t.sessions}</span><span class="l">Sessions · ${fmtDuration(t.avgSessionMs)} average · ${t.streakDays}-day streak</span></div>
        <div class="card stat"><span class="v">${t.medianLaunchMs != null ? (t.medianLaunchMs / 1000).toFixed(1) + ' s' : '—'}</span><span class="l">Typical launch time · ${t.crashRate}% crashed</span></div></div>
      ${!t.sessions ? `<div class="empty">${icon('clock')}<div>No sessions recorded yet — play something and it shows up here. (Before this version, Astra only kept the total: ${fmtDuration(t.lifetimeMs)}.)</div></div>` : `
      <h2>Last 30 days</h2><div class="card"><div class="eco-days">${r.perDay.map((d) => `<div title="${esc(d.day)} · ${fmtDuration(d.ms)}"><i style="height:${Math.max(d.ms ? 4 : 1, (d.ms / maxDay) * 100)}%"></i></div>`).join('')}</div></div>
      <div class="grid cols-2" style="margin-top:14px"><div><h2>Instances</h2><div class="card stack">${r.instances.slice(0, 10).map((i) => `<div><div class="row"><b class="grow ellipsis">${esc(i.name)}${i.deleted ? ' <span class="chip">deleted</span>' : ''}</b><span class="small">${fmtDuration(i.ms)}</span><span class="faint small">${i.sessions}×${i.crashes ? ` · ${i.crashes} crash${i.crashes === 1 ? '' : 'es'}` : ''}</span></div>${ecoBar(i.ms / maxInst)}</div>`).join('')}</div></div>
      <div><h2>Trends (weekly)</h2><div class="card"><table class="hs-ptable"><tr><th>Week of</th><th>Sessions</th><th>Avg session</th><th>Launch</th><th>Crashes</th></tr>${r.weeks.map((x) => `<tr><td class="small">${new Date(x.from).toLocaleDateString()}</td><td>${x.sessions || '—'}</td><td>${x.avgSessionMs ? fmtDuration(x.avgSessionMs) : '—'}</td><td>${x.launchMs != null ? (x.launchMs / 1000).toFixed(1) + ' s' : '—'}</td><td>${x.crashRate != null ? x.crashRate + '%' : '—'}</td></tr>`).join('')}</table></div></div></div>
      <div class="grid cols-2" style="margin-top:14px"><div><h2>Minecraft versions</h2><div class="card stack">${r.versions.map((v) => `<div class="row"><b class="grow">${esc(v.mc)}</b><span class="small">${fmtDuration(v.ms)}</span></div>`).join('')}</div>
        ${r.crashes.length ? `<h2>Crash causes</h2><div class="card stack">${r.crashes.map((c) => `<div class="row"><span class="grow">${esc(c.title)}</span><span class="chip danger">${c.n}</span></div>`).join('')}</div>` : ''}
        ${r.servers.length ? `<h2>Servers</h2><div class="card stack">${r.servers.map((s) => `<div class="row"><span class="grow mono small">${esc(s.address)}</span><span class="small">${fmtDuration(s.ms)}</span></div>`).join('')}</div>` : ''}</div>
      <div><h2>Recent sessions</h2><div class="card"><table class="hs-ptable"><tr><th>Instance</th><th>When</th><th>Length</th><th></th></tr>${r.recent.slice(0, 15).map((s) => `<tr><td>${esc(s.name)}</td><td class="faint small">${timeAgo(s.start)}</td><td>${fmtDuration(s.end - s.start)}</td><td>${s.interrupted ? '<span class="chip" title="Astra was closed while the game kept running">Astra closed</span>' : s.crashed ? `<span class="chip danger" title="${esc(s.crash || '')}">crashed</span>` : s.server ? `<span class="chip">${esc(s.server)}</span>` : ''}</td></tr>`).join('')}</table></div></div></div>`}
      ${w ? `<h2>Worlds</h2><div class="card row wrap"><span>${w.worlds} worlds (${w.servers} on servers you host), ${w.withStats} with player statistics.</span>${w.topPlayers.length ? `<span class="faint small">Most played: ${w.topPlayers.map((p) => `${esc(p.name || p.uuid.slice(0, 8))} ${fmtDuration(p.playMs)}`).join(' · ')}</span>` : ''}<button class="btn sm" id="an-stats">${icon('chart')}Open Stats</button></div>` : ''}`;
    const s = $('#an-stats', el); if (s) s.onclick = () => Router.go('stats');
  },
};
