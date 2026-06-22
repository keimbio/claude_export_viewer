/* =========================================================================
   app.js — Claude Export Viewer application
   ========================================================================= */
(function () {
  'use strict';
  const P = window.ClaudeParser, X = window.ClaudeExport;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // background presets (drop the matching files into assets/backgrounds/)
  const BACKGROUNDS = [
    { id: 'dark1',  label: 'Green',  file: 'DARK-MODE-susan-wilkinson-4rDgxdT_4wI-unsplash.jpg' },
    { id: 'dark2',  label: 'Blue',   file: 'DARK-MODE-pawel-czerwinski-4x3VAM19wDA-unsplash.jpg' },
    { id: 'light1', label: 'Grey',   file: 'LIGHT-MODE-aljoscha-laschgari-Nm_liipBlsY-unsplash.jpg' },
    { id: 'light2', label: 'Aqua',   file: 'LIGHT-MODE-susan-wilkinson-_vpDiW27L0k-unsplash.jpg' }
  ];

  const state = {
    library: [],          // all conversations (merged, deduped by id)
    activeId: null,
    selecting: false,
    selected: new Set(),  // message ids in active conversation
    convSelecting: false,
    convSelected: new Set(), // conversation ids selected in the sidebar
    settings: { theme: 'dark', bg: 'dark1', customBg: null, bgOpacity: 0.55, fsScale: 1 }
  };

  /* ---------------- IndexedDB (library persistence) ---------------- */
  const DB = (() => {
    let dbp;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('claude-export-viewer', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    async function get(k) { const db = await open(); return new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); }
    async function set(k, v) { const db = await open(); return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }
    return { get, set };
  })();

  /* ---------------- settings persistence ---------------- */
  function loadSettings() {
    try { const s = JSON.parse(localStorage.getItem('cev-settings')); if (s) Object.assign(state.settings, s); } catch (e) {}
  }
  function saveSettings() { try { localStorage.setItem('cev-settings', JSON.stringify(state.settings)); } catch (e) {} }

  /* ---------------- toast ---------------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900); }

  /* ---------------- theme / background apply ---------------- */
  function applyAppearance() {
    const s = state.settings;
    document.documentElement.setAttribute('data-theme', s.theme);
    document.documentElement.style.setProperty('--fs-scale', s.fsScale);
    document.documentElement.style.setProperty('--bg-overlay', s.bgOpacity);
    // Resolve the chosen background to a plain URL (or null = solid colour).
    let url = null, presetFile = null;
    if (s.bg === 'custom' && s.customBg) url = s.customBg;
    else if (s.bg && s.bg !== 'none') {
      const b = BACKGROUNDS.find(x => x.id === s.bg);
      if (b) { url = `./assets/backgrounds/${b.file}`; presetFile = b.file; }
    }
    // Set the image DIRECTLY on the layer element — same mechanism the grid
    // thumbnails use — rather than routing a url() through a CSS variable.
    const layer = $('#bg-layer');
    if (layer) layer.style.backgroundImage = url ? `url("${url}")` : 'none';
    document.documentElement.style.setProperty('--bg-image', url ? `url("${url}")` : 'none');
    // For preset files, confirm the file actually loads; warn by name if not.
    if (presetFile) {
      const probe = new Image();
      probe.onerror = () => toast('Background image not found — add “' + presetFile + '” to assets/backgrounds/');
      probe.src = url;
    }
    if ($('#fs-range')) $('#fs-range').value = s.fsScale;
    if ($('#bg-opacity')) $('#bg-opacity').value = s.bgOpacity;
    renderBgGrid();
  }

  /* ---------------- markdown renderer (lightweight, safe) ---------------- */
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function inlineMd(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + codes[+i] + '</code>');
    return s;
  }
  function renderMarkdown(src) {
    src = String(src || '').replace(/\r\n/g, '\n');
    const fences = [];
    src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => { fences.push(code.replace(/\n$/, '')); return '\u0002' + (fences.length - 1) + '\u0002'; });
    src = escapeHtml(src);
    const lines = src.split('\n');
    let html = '', i = 0, list = null;
    const close = () => { if (list) { html += '</' + list + '>'; list = null; } };
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\u0002(\d+)\u0002$/))) { close(); html += '<pre><code>' + escapeHtml(fences[+m[1]]) + '</code></pre>'; i++; continue; }
      if (/^\s*$/.test(line)) { close(); i++; continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); const lv = m[1].length; html += `<h${lv}>${inlineMd(m[2])}</h${lv}>`; i++; continue; }
      if (/^(---|\*\*\*|___)\s*$/.test(line)) { close(); html += '<hr>'; i++; continue; }
      // table
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        close();
        const pr = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = pr(line); i += 2; const rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && !/^\s*$/.test(lines[i])) { rows.push(pr(lines[i])); i++; }
        html += '<table><thead><tr>' + head.map(h => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
        continue;
      }
      if (/^>\s?/.test(line)) { close(); const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; } html += '<blockquote>' + inlineMd(q.join(' ')) + '</blockquote>'; continue; }
      if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += '<li>' + inlineMd(m[1]) + '</li>'; i++; continue; }
      if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += '<li>' + inlineMd(m[1]) + '</li>'; i++; continue; }
      close(); const para = [line]; i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\u0002\d+\u0002$/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) { para.push(lines[i]); i++; }
      html += '<p>' + inlineMd(para.join('\n')).replace(/\n/g, '<br>') + '</p>';
    }
    close();
    return html;
  }

  /* ---------------- import / merge ---------------- */
  async function importFiles(files) {
    const status = $('#import-status');
    let added = 0, updated = 0, errs = [];
    for (const f of files) {
      status.textContent = 'Reading ' + f.name + '…';
      try {
        const convs = await P.parseFile(f);
        convs.forEach(c => {
          const ix = state.library.findIndex(x => x.id === c.id);
          if (ix === -1) { state.library.push(c); added++; }
          else {
            const old = state.library[ix];
            if (new Date(c.updated || 0) >= new Date(old.updated || 0)) { state.library[ix] = c; updated++; }
          }
        });
      } catch (e) { errs.push(f.name + ': ' + e.message); }
    }
    await persistLibrary();
    renderList();
    let msg = `Imported ${added} new` + (updated ? `, ${updated} updated` : '');
    if (errs.length) msg += ` · ${errs.length} failed`;
    status.textContent = msg;
    toast(msg);
    if (errs.length) console.warn('Import errors:\n' + errs.join('\n'));
    if (!state.activeId && state.library.length) selectConversation(sortedFiltered()[0].id);
  }
  async function persistLibrary() { await DB.set('lib', state.library); }

  /* ---------------- filtering / sorting ---------------- */
  function sortedFiltered() {
    const q = $('#search').value.trim().toLowerCase();
    const scope = (document.querySelector('input[name="scope"]:checked') || {}).value || 'full';
    const onlyArt = $('#f-artifacts').checked;
    const from = $('#date-from').value ? new Date($('#date-from').value) : null;
    const to = $('#date-to').value ? new Date($('#date-to').value + 'T23:59:59') : null;
    const key = (document.querySelector('input[name="sortkey"]:checked') || {}).value || 'updated';
    const dir = (document.querySelector('input[name="sortdir"]:checked') || {}).value || 'desc';

    let list = state.library.filter(c => {
      if (onlyArt && !c.artifacts.length) return false;
      const d = new Date(c[key] || c.updated || c.created || 0);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (!q) return true;
      if (c.title.toLowerCase().includes(q)) return true;
      if (scope === 'title') return false;
      if (c.messages.some(m => (m.text || '').toLowerCase().includes(q))) return true;
      if (c.messages.some(m => m.attachments.some(a => (a.content || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q)))) return true;
      if (c.artifacts.some(a => (a.content || '').toLowerCase().includes(q) || (a.title || '').toLowerCase().includes(q))) return true;
      return false;
    });
    list.sort((a, b) => {
      const da = new Date(a[key] || 0), db = new Date(b[key] || 0);
      return dir === 'desc' ? db - da : da - db;
    });
    return list;
  }

  /* ---------------- render conversation list ---------------- */
  function renderList() {
    const list = sortedFiltered();
    const wrap = $('#conv-list'); wrap.innerHTML = '';
    $('#conv-count').textContent = state.library.length
      ? `${list.length} of ${state.library.length} conversation${state.library.length !== 1 ? 's' : ''}`
      : 'No conversations';
    list.forEach(c => {
      const firstUser = c.messages.find(m => m.sender === 'human');
      const preview = (firstUser ? firstUser.text : (c.messages[0] && c.messages[0].text) || c.summary || '').slice(0, 160);
      const el = document.createElement('div');
      el.className = 'conv-card' + (c.id === state.activeId ? ' active' : '') + (state.convSelected.has(c.id) ? ' csel' : '');
      el.innerHTML =
        `<input type="checkbox" class="sel-box"${state.convSelected.has(c.id) ? ' checked' : ''}>` +
        `<div class="title">${escapeHtml(c.title)}</div>` +
        `<div class="preview">${escapeHtml(preview)}</div>` +
        `<div class="meta"><span>${X.fmtDate(c.updated || c.created)}</span>` +
        `<span>${c.messages.length} msg</span>` +
        (c.artifacts.length ? `<span class="badge-art">🧩 ${c.artifacts.length}</span>` : '') + `</div>`;
      const toggle = () => {
        if (state.convSelected.has(c.id)) state.convSelected.delete(c.id); else state.convSelected.add(c.id);
        el.classList.toggle('csel', state.convSelected.has(c.id));
        const cb = el.querySelector('.sel-box'); if (cb) cb.checked = state.convSelected.has(c.id);
        updateConvSelBar();
      };
      el.querySelector('.sel-box').onclick = (e) => { e.stopPropagation(); toggle(); };
      el.onclick = () => { if (state.convSelecting) toggle(); else selectConversation(c.id); };
      wrap.appendChild(el);
    });
  }

  /* ---------------- render active conversation ---------------- */
  function activeConv() { return state.library.find(c => c.id === state.activeId); }

  function selectConversation(id) {
    state.activeId = id;
    state.selected.clear();
    updateSelBar();
    renderList();
    renderConversation();
  }

  function renderConversation() {
    const c = activeConv();
    const inner = $('#messages-inner'), empty = $('#empty-state');
    if (!c) { inner.style.display = 'none'; empty.style.display = 'grid'; $('#conv-title').textContent = 'Claude Export Viewer'; $('#conv-dates').textContent = 'Import an export to begin'; return; }
    empty.style.display = 'none'; inner.style.display = 'block';
    $('#conv-title').textContent = c.title;
    $('#conv-dates').textContent = `Created ${X.fmtDate(c.created)} · Updated ${X.fmtDate(c.updated)} · ${c.messages.length} messages` + (c.artifacts.length ? ` · ${c.artifacts.length} artifacts` : '');
    inner.innerHTML = '';
    c.messages.forEach(m => inner.appendChild(renderMessage(m, c)));
    $('#messages').scrollTop = 0;
  }

  function renderMessage(m, c) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + m.sender + (state.selected.has(m.id) ? ' selected' : '');
    wrap.dataset.id = m.id;

    const avatar = `<div class="avatar">${m.sender === 'human' ? 'H' : 'A'}</div>`;
    const head = `<div class="msg-head"><span class="who">${m.sender === 'human' ? 'Human' : 'Claude'}</span><span>${X.fmtDate(m.created)}</span></div>`;

    // body
    let bodyHtml = m.text ? renderMarkdown(m.text) : '<em style="opacity:.6">(no text content)</em>';

    // attachments
    let attHtml = '';
    if (m.attachments.length || m.files.length) {
      attHtml = '<div class="attach-row">';
      m.attachments.forEach((a, i) => { attHtml += `<span class="attach-chip" data-att="${i}">📎 ${escapeHtml(a.name)}${a.size ? ' <span class="x">' + fmtSize(a.size) + '</span>' : ''}</span>`; });
      m.files.forEach(f => { attHtml += `<span class="attach-chip" title="binary not included in export">📄 ${escapeHtml(f.name)} <span class="x">image/binary</span></span>`; });
      attHtml += '</div>';
    }

    // artifacts
    let artHtml = '';
    m.artifactIds.forEach(id => {
      const art = c.artifacts.find(a => a.id === id); if (!art) return;
      artHtml += `<div class="artifact-card" data-art="${escapeHtml(art.id)}">
        <div class="ah"><span class="ico">🧩</span><span class="at">${escapeHtml(art.title)}</span><span class="type-badge">${escapeHtml(art.ext.toUpperCase())}</span></div>
        <div class="aa"><button class="btn sm" data-art-view="${escapeHtml(art.id)}">View</button>
        <button class="btn sm" data-art-dl="${escapeHtml(art.id)}">↧ .${escapeHtml(art.ext)}</button>
        <button class="btn sm" data-art-alt="${escapeHtml(art.id)}">Download as…</button></div></div>`;
    });

    // action bar
    const actions = `<div class="msg-actions">
      <button class="act-btn" data-copy="${m.id}">⧉ Copy</button>
      <button class="act-btn" data-exp="${m.id}">↧ Export</button>
      <button class="act-btn" data-sel="${m.id}">☑ Select</button>
    </div>`;

    wrap.innerHTML = avatar + `<div class="msg-col">${head}<div class="bubble">${bodyHtml}</div>${attHtml}${artHtml}${actions}</div>`;

    // wire artifact + attachment + actions
    wrap.querySelectorAll('[data-art-view]').forEach(b => b.onclick = () => viewArtifact(c.artifacts.find(a => a.id === b.dataset.artView)));
    wrap.querySelectorAll('[data-art-dl]').forEach(b => b.onclick = () => X.downloadArtifact(c.artifacts.find(a => a.id === b.dataset.artDl)));
    wrap.querySelectorAll('[data-art-alt]').forEach(b => b.onclick = (e) => artifactAltMenu(e.currentTarget, c.artifacts.find(a => a.id === b.dataset.artAlt)));
    wrap.querySelectorAll('[data-att]').forEach(b => b.onclick = () => viewAttachment(m.attachments[+b.dataset.att]));
    wrap.querySelector('[data-copy]').onclick = () => { copyText(X.messageToText(m)); };
    wrap.querySelector('[data-exp]').onclick = (e) => messageExportMenu(e.currentTarget, m, c);
    wrap.querySelector('[data-sel]').onclick = () => toggleSelect(m.id);
    return wrap;
  }

  function fmtSize(n) { if (!n) return ''; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }

  /* ---------------- selection ---------------- */
  function toggleSelect(id) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    if (state.selected.size && !state.selecting) { state.selecting = true; document.body.classList.add('selecting'); }
    const node = document.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
    if (node) node.classList.toggle('selected', state.selected.has(id));
    updateSelBar();
  }
  function updateSelBar() {
    const bar = $('#sel-bar');
    $('#sel-count').textContent = state.selected.size + ' selected';
    bar.classList.toggle('show', state.selected.size > 0);
  }
  function clearSelection() { state.selected.clear(); state.selecting = false; document.body.classList.remove('selecting'); $$('.msg.selected').forEach(n => n.classList.remove('selected')); updateSelBar(); }

  /* ---------------- conversation (multi-chat) selection ---------------- */
  function updateConvSelBar() {
    const n = state.convSelected.size;
    $('#conv-sel-count').textContent = n + ' conversation' + (n === 1 ? '' : 's');
    $('#conv-sel-bar').classList.toggle('show', state.convSelecting);
  }
  function toggleConvSelectMode(on) {
    state.convSelecting = (on === undefined) ? !state.convSelecting : on;
    if (state.convSelecting) clearSelection(); // the two select modes are mutually exclusive
    document.body.classList.toggle('conv-selecting', state.convSelecting);
    if (!state.convSelecting) { state.convSelected.clear(); renderList(); }
    $('#btn-conv-select').classList.toggle('primary', state.convSelecting);
    updateConvSelBar();
  }
  function getConvSelected() {
    return state.library.filter(c => state.convSelected.has(c.id));
  }
  function convSelectionExportMenu(anchor) {
    const sel = getConvSelected();
    if (!sel.length) return toast('No conversations selected');
    const base = 'claude-' + sel.length + '-conversations';
    showMenu(anchor, [
      { header: sel.length + ' selected' },
      { label: 'ZIP (md + artifacts)', fn: async () => { toast('Zipping…'); const blob = await X.libraryToZip(sel, { md: true, artifacts: true }); X.download(base + '.zip', blob); } },
      { label: 'Merged JSON (.json)', fn: () => X.download(base + '.json', X.libraryToJson(sel), 'application/json') },
      { label: 'Combined Markdown (.md)', fn: () => X.download(base + '.md', sel.map(X.conversationToMarkdown).join('\n\n'), 'text/markdown') },
      { label: 'Combined PDF (.pdf)', fn: () => { toast('Building PDF…'); setTimeout(() => X.conversationsToPdf(sel).save(base + '.pdf'), 30); } }
    ]);
  }

  /* ---------------- copy helpers ---------------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied'), () => fallbackCopy(text));
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed'); } t.remove(); }

  /* ---------------- popover menu ---------------- */
  function showMenu(anchor, items) {
    const menu = $('#popmenu'); menu.innerHTML = '';
    items.forEach(it => {
      if (it.sep) { const d = document.createElement('div'); d.className = 'sep'; menu.appendChild(d); return; }
      if (it.header) { const h = document.createElement('div'); h.className = 'mlabel'; h.textContent = it.header; menu.appendChild(h); return; }
      const b = document.createElement('button'); b.textContent = it.label; b.onclick = () => { menu.classList.remove('open'); it.fn(); }; menu.appendChild(b);
    });
    const r = anchor.getBoundingClientRect();
    menu.classList.add('open');
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.left, top = r.bottom + 6;
    if (left + mw > innerWidth - 8) left = innerWidth - mw - 8;
    if (top + mh > innerHeight - 8) top = r.top - mh - 6;
    menu.style.left = Math.max(8, left) + 'px'; menu.style.top = Math.max(8, top) + 'px';
  }
  document.addEventListener('click', e => { const m = $('#popmenu'); if (m.classList.contains('open') && !m.contains(e.target) && !e.target.closest('[data-exp],[data-art-alt],#btn-export-conv,#btn-lib-menu,#sel-export')) m.classList.remove('open'); });

  /* ---------------- export menus ---------------- */
  function messageExportMenu(anchor, m, c) {
    showMenu(anchor, [
      { header: 'Export this message' },
      { label: 'Copy text', fn: () => copyText(X.messageToText(m)) },
      { label: 'Copy as Markdown', fn: () => copyText(X.messageToMarkdown(m, c)) },
      { sep: true },
      { label: 'Download .txt', fn: () => X.download(stub(c, m) + '.txt', X.messageToText(m)) },
      { label: 'Download .md', fn: () => X.download(stub(c, m) + '.md', X.messageToMarkdown(m, c), 'text/markdown') },
      { label: 'Download .json', fn: () => X.download(stub(c, m) + '.json', JSON.stringify(m, null, 2), 'application/json') },
      { label: 'Download .png', fn: () => { const node = document.querySelector(`.msg[data-id="${CSS.escape(m.id)}"] .msg-col`); X.nodeToPng(node, stub(c, m) + '.png'); } }
    ]);
  }
  function stub(c, m) { return P.safeName(c.title) + '_' + m.sender; }

  function conversationExportMenu(anchor) {
    const c = activeConv(); if (!c) return toast('No conversation selected');
    showMenu(anchor, [
      { header: 'Export conversation' },
      { label: 'Markdown (.md)', fn: () => X.download(P.safeName(c.title) + '.md', X.conversationToMarkdown(c), 'text/markdown') },
      { label: 'Plain text (.txt)', fn: () => X.download(P.safeName(c.title) + '.txt', X.conversationToText(c)) },
      { label: 'JSON (.json)', fn: () => X.download(P.safeName(c.title) + '.json', X.conversationToJson(c), 'application/json') },
      { label: 'Web page (.html)', fn: () => X.download(P.safeName(c.title) + '.html', X.conversationToHtml(c), 'text/html') },
      { label: 'PDF (.pdf)', fn: () => { toast('Building PDF…'); setTimeout(() => X.conversationToPdf(c).save(P.safeName(c.title) + '.pdf'), 30); } },
      { label: 'Image (.png)', fn: () => { toast('Rendering image…'); X.nodeToPng($('#messages-inner'), P.safeName(c.title) + '.png'); } },
      { sep: true },
      { label: 'Artifacts only (.zip)', fn: () => exportConvArtifacts(c) }
    ]);
  }

  async function exportConvArtifacts(c) {
    if (!c.artifacts.length) return toast('No artifacts in this conversation');
    const zip = new window.JSZip(); const used = {};
    c.artifacts.forEach(a => { let fn = a.filename; if (used[fn]) fn = fn.replace(/(\.\w+)$/, '_' + (++used[a.filename]) + '$1'); else used[fn] = 1; zip.file(fn, a.content); });
    const blob = await zip.generateAsync({ type: 'blob' });
    X.download(P.safeName(c.title) + '_artifacts.zip', blob);
  }

  function libraryMenu(anchor) {
    showMenu(anchor, [
      { header: 'All ' + state.library.length + ' conversations' },
      { label: 'Export ALL as merged JSON', fn: () => X.download('claude-library.json', X.libraryToJson(state.library), 'application/json') },
      { label: 'Export ALL as ZIP (md + artifacts)', fn: async () => { toast('Zipping library…'); const blob = await X.libraryToZip(state.library, { md: true, artifacts: true }); X.download('claude-library.zip', blob); } },
      { label: 'Export ALL as combined PDF', fn: () => { toast('Building PDF…'); setTimeout(() => X.conversationsToPdf(state.library).save('claude-library.pdf'), 30); } },
      { sep: true },
      { label: 'Clear library…', fn: clearLibrary }
    ]);
  }
  async function clearLibrary() {
    if (!confirm('Remove all imported conversations from this viewer? Your original export files are not touched.')) return;
    state.library = []; state.activeId = null; state.convSelected.clear(); await persistLibrary(); clearSelection(); toggleConvSelectMode(false); renderList(); renderConversation(); toast('Library cleared');
  }

  function artifactAltMenu(anchor, art) {
    if (!art) return;
    const alts = altFormats(art);
    showMenu(anchor, [
      { header: 'Download artifact as' },
      { label: `Original (.${art.ext})`, fn: () => X.downloadArtifact(art) },
      ...alts.map(ext => ({ label: '.' + ext, fn: () => X.downloadArtifact(art, ext) }))
    ]);
  }
  function altFormats(art) {
    const base = ['txt'];
    if (art.ext === 'md') base.push('html');
    if (art.ext === 'html') base.push('txt');
    if (art.kind === 'code') base.push('md');
    if (art.ext === 'svg') base.push('txt');
    return [...new Set(base.filter(e => e !== art.ext))];
  }

  /* ---------------- artifact / attachment viewers ---------------- */
  let modalArt = null;
  function viewArtifact(art) {
    if (!art) return; modalArt = art;
    $('#modal-title').textContent = art.title + '  ·  .' + art.ext;
    const body = $('#modal-body'); body.innerHTML = '';
    if (art.kind === 'svg') { body.innerHTML = art.content; }
    else if (art.kind === 'markdown') { body.innerHTML = renderMarkdown(art.content); }
    else if (art.kind === 'html') { const f = document.createElement('iframe'); f.sandbox = 'allow-scripts'; f.srcdoc = art.content; body.appendChild(f); }
    else { const pre = document.createElement('pre'); pre.textContent = art.content; body.appendChild(pre); }
    $('#modal-dl').onclick = () => X.downloadArtifact(art);
    $('#modal-dl-alt').style.display = '';
    $('#modal-dl-alt').onclick = (e) => artifactAltMenu(e.currentTarget, art);
    $('#modal-back').classList.add('open');
  }
  function viewAttachment(att) {
    if (!att) return;
    $('#modal-title').textContent = att.name + (att.type ? '  ·  ' + att.type : '');
    const body = $('#modal-body'); body.innerHTML = '';
    if (att.content) { const pre = document.createElement('pre'); pre.textContent = att.content; body.appendChild(pre); }
    else { body.innerHTML = '<p style="color:var(--text-dim)">This attachment\'s binary content is not included in Claude exports — only extracted text is stored, and none was found here.</p>'; }
    $('#modal-dl').onclick = () => att.content ? X.download(P.safeName(att.name) + '.txt', att.content) : toast('No extractable content');
    $('#modal-dl-alt').style.display = 'none';
    $('#modal-back').classList.add('open');
  }

  /* ---------------- bg grid ---------------- */
  function renderBgGrid() {
    const grid = $('#bg-grid'); if (!grid) return; grid.innerHTML = '';
    const mk = (id, label, style, cls, fileUrl) => {
      const d = document.createElement('div'); d.className = 'bg-opt ' + (cls || '') + (state.settings.bg === id ? ' sel' : '');
      if (style) d.style.cssText = style; if (label) d.textContent = label;
      d.onclick = () => { state.settings.bg = id; saveSettings(); applyAppearance(); };
      grid.appendChild(d);
      if (fileUrl) { const p = new Image(); p.onerror = () => { d.classList.add('bg-missing'); d.title = 'Image file not found in assets/backgrounds/'; }; p.src = fileUrl; }
    };
    BACKGROUNDS.forEach(b => mk(b.id, '', `background-image:url('./assets/backgrounds/${b.file}')`, '', `./assets/backgrounds/${b.file}`));
    if (state.settings.customBg) mk('custom', '', `background-image:url('${state.settings.customBg}')`);
    mk('none', 'None', '', 'none');
    const up = document.createElement('div'); up.className = 'bg-opt none'; up.textContent = '+ Upload';
    up.onclick = () => $('#bg-upload').click(); grid.appendChild(up);
  }

  /* ---------------- wire global controls ---------------- */
  function wire() {
    $('#btn-choose').onclick = () => $('#file-input').click();
    $('#file-input').onchange = e => { if (e.target.files.length) importFiles(e.target.files); e.target.value = ''; };
    const dz = $('#dropzone');
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); if (ev !== 'drop' && dz.contains(e.relatedTarget)) return; dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
    // also accept drops anywhere on the window
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => { e.preventDefault(); if (e.target.closest('#dropzone')) return; if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

    ['#search'].forEach(s => $(s).addEventListener('input', renderList));
    $$('input[name="scope"],input[name="sortkey"],input[name="sortdir"],#f-artifacts,#date-from,#date-to').forEach(el => el.addEventListener('change', renderList));

    $('#btn-export-conv').onclick = e => conversationExportMenu(e.currentTarget);
    $('#btn-share-conv').onclick = () => { const c = activeConv(); if (!c) return toast('No conversation'); copyText(X.conversationToMarkdown(c)); };
    $('#btn-lib-menu').onclick = e => libraryMenu(e.currentTarget);
    $('#btn-select').onclick = () => { if (state.convSelecting) toggleConvSelectMode(false); state.selecting = !state.selecting; document.body.classList.toggle('selecting', state.selecting); if (!state.selecting) clearSelection(); else toast('Tap ☑ on messages to select'); };

    // conversation (multi-chat) selection
    $('#btn-conv-select').onclick = () => { toggleConvSelectMode(); renderList(); if (state.convSelecting) toast('Tick conversations, then “Export selected”'); };
    $('#conv-sel-all').onclick = () => { sortedFiltered().forEach(c => state.convSelected.add(c.id)); renderList(); updateConvSelBar(); };
    $('#conv-sel-clear').onclick = () => { state.convSelected.clear(); renderList(); updateConvSelBar(); };
    $('#conv-sel-export').onclick = e => convSelectionExportMenu(e.currentTarget);
    $('#conv-sel-done').onclick = () => toggleConvSelectMode(false);

    // selection bar
    $('#sel-clear').onclick = clearSelection;
    $('#sel-copy').onclick = () => { const c = activeConv(); const msgs = c.messages.filter(m => state.selected.has(m.id)); copyText(msgs.map(m => X.messageToText(m)).join('\n' + '-'.repeat(30) + '\n\n')); };
    $('#sel-export').onclick = e => {
      const c = activeConv(); const msgs = c.messages.filter(m => state.selected.has(m.id));
      if (!msgs.length) return toast('Nothing selected');
      const sub = Object.assign({}, c, { messages: msgs });
      showMenu(e.currentTarget, [
        { header: state.selected.size + ' selected message(s)' },
        { label: 'Markdown (.md)', fn: () => X.download(P.safeName(c.title) + '_selection.md', X.conversationToMarkdown(sub), 'text/markdown') },
        { label: 'Plain text (.txt)', fn: () => X.download(P.safeName(c.title) + '_selection.txt', X.conversationToText(sub)) },
        { label: 'JSON (.json)', fn: () => X.download(P.safeName(c.title) + '_selection.json', JSON.stringify(msgs, null, 2), 'application/json') }
      ]);
    };

    // font size
    $('#fs-inc').onclick = () => setFs(+(state.settings.fsScale + 0.1).toFixed(2));
    $('#fs-dec').onclick = () => setFs(+(state.settings.fsScale - 0.1).toFixed(2));
    $('#fs-range').oninput = e => setFs(+e.target.value);
    function setFs(v) { state.settings.fsScale = Math.min(1.5, Math.max(0.8, v)); saveSettings(); applyAppearance(); }

    // theme
    $('#btn-theme').onclick = () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyAppearance(); };

    // settings modal
    $('#btn-settings').onclick = () => $('#settings-back').classList.add('open');
    $('#settings-close').onclick = () => $('#settings-back').classList.remove('open');
    $$('[data-theme-set]').forEach(b => b.onclick = () => { state.settings.theme = b.dataset.themeSet; saveSettings(); applyAppearance(); });
    $('#bg-opacity').oninput = e => { state.settings.bgOpacity = +e.target.value; saveSettings(); applyAppearance(); };
    $('#bg-upload').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { state.settings.customBg = r.result; state.settings.bg = 'custom'; saveSettings(); applyAppearance(); }; r.readAsDataURL(f); };

    // modal close
    $('#modal-close').onclick = () => $('#modal-back').classList.remove('open');
    $('#modal-back').onclick = e => { if (e.target.id === 'modal-back') $('#modal-back').classList.remove('open'); };
    $('#settings-back').onclick = e => { if (e.target.id === 'settings-back') $('#settings-back').classList.remove('open'); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal-back').classList.remove('open'); $('#settings-back').classList.remove('open'); $('#popmenu').classList.remove('open'); } });
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    loadSettings(); applyAppearance(); wire();
    const lib = await DB.get('lib');
    if (Array.isArray(lib) && lib.length) { state.library = lib; renderList(); selectConversation(sortedFiltered()[0].id); }
    else renderList();
  }
  boot();
})();
