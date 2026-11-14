Pages.console = {
  lineClass(l) {
    if (l.startsWith('[Solaris]')) return 'l-solaris';
    if (/\b(ERROR|FATAL|Exception|Caused by)\b|^\s+at /.test(l)) return 'l-error';
    if (/\bWARN\b/.test(l)) return 'l-warn';
    if (/\bDEBUG\b/.test(l)) return 'l-debug';
    return '';
  },
  /** Mounts a live log view for a run into `box`. Returns an unsubscribe fn. */
  mount(box, runId) {
    const run = State.runs[runId];
    let filter = '', level = 'all', follow = true;
    box.innerHTML = `<div class="row" style="margin-bottom:10px">
        <div class="search" style="width:260px">${icon('search')}<input type="search" placeholder="Filter log…" id="lf"></div>
        <div class="seg"><button data-lv="all" class="on">All</button><button data-lv="warn">Warnings</button><button data-lv="error">Errors</button></div>
        <label class="row small"><input type="checkbox" id="follow" checked>Auto-scroll</label>
        <div class="grow"></div>
        <button class="btn sm" id="lcopy">${icon('copy')}Copy</button>
        <button class="btn sm" id="lshare">${icon('share')}Share log</button>
        ${run?.running ? `<button class="btn sm stop" id="lkill">${icon('stop')}Kill</button>` : ''}
      </div><div class="console" id="con"></div>`;
    const con = $('#con', box);
    const match = (l) => (!filter || l.toLowerCase().includes(filter)) && (level === 'all' || (level === 'error' ? this.lineClass(l) === 'l-error' : ['l-error', 'l-warn'].includes(this.lineClass(l))));
    const render = () => {
      const lines = (State.runs[runId]?.lines || []).filter(match).slice(-4000);
      con.innerHTML = lines.map((l) => `<div class="${this.lineClass(l)}">${esc(l)}</div>`).join('');
      if (follow) con.scrollTop = con.scrollHeight;
    };
    const append = (lines) => {
      const frag = document.createDocumentFragment();
      for (const l of lines) {
        if (!match(l)) continue;
        const d = document.createElement('div'); d.className = this.lineClass(l); d.textContent = l;
        frag.appendChild(d);
      }
      if (!frag.childNodes.length) return;
      con.appendChild(frag);
      let extra = con.childElementCount - 5000;
      while (extra-- > 0) con.firstChild.remove();
      if (follow) con.scrollTop = con.scrollHeight;
    };
    $('#lf', box).oninput = debounce((e) => { filter = e.target.value.toLowerCase(); render(); }, 150);
    $$('[data-lv]', box).forEach((b) => (b.onclick = () => { level = b.dataset.lv; $$('[data-lv]', box).forEach((x) => x.classList.toggle('on', x === b)); render(); }));
    $('#follow', box).onchange = (e) => { follow = e.target.checked; };
    $('#lcopy', box).onclick = () => { api('clipboard:write', (State.runs[runId]?.lines || []).join('\n')); toast('Log copied'); };
    $('#lshare', box).onclick = () => shareLog(runId);
    const k = $('#lkill', box); if (k) k.onclick = () => api('launch:stop', runId);
    render();
    return Bus.on('log', (e) => { if (e.runId === runId) append(e.lines); });
  },
  async render(el, params, ctx) {
    let runId = params.runId || Object.keys(State.runs).pop();
    const draw = () => {
      const runs = Object.entries(State.runs).reverse();
      // nothing picked yet (or the picked run vanished): follow the newest run, e.g. a game started after opening this page
      if (!runId || !State.runs[runId]) runId = runs[0]?.[0];
      el.innerHTML = `<div class="page-head"><div><h1>${T('Console')}</h1><div class="sub">Live game output for this session · logs are saved in the Solaris logs folder</div></div>
        <div class="actions"><button class="btn" id="ologs">${icon('folder')}Logs folder</button></div></div>
        ${runs.length ? `<div class="tabs">${runs.map(([id, r]) => `<button data-run="${esc(id)}" class="${id === runId ? 'on' : ''}">${r.running ? '<span class="dot pulse" style="display:inline-block;margin-right:6px"></span>' : ''}${esc(r.name)} <span class="faint small">${new Date(r.start).toLocaleTimeString()}</span></button>`).join('')}</div><div id="cbox"></div>`
          : `<div class="empty">${icon('console')}<div>Nothing has run yet this session. Launch an instance to see its live console here.</div></div>`}`;
      $('#ologs', el).onclick = () => api('diag:openLogs');
      $$('[data-run]', el).forEach((b) => (b.onclick = () => { runId = b.dataset.run; draw(); }));
      if (unsub) unsub();
      unsub = runs.length && runId && State.runs[runId] ? this.mount($('#cbox', el), runId) : null;
    };
    let unsub = null;
    draw();
    ctx.on('runs', draw);
    return () => unsub && unsub();
  },
};
