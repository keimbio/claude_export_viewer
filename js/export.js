/* =========================================================================
   export.js — convert messages / conversations / artifacts / library to
   txt, md, json, html, pdf, png, zip. All client-side.
   ========================================================================= */
(function (global) {
  'use strict';
  const P = global.ClaudeParser;

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function who(sender) { return sender === 'human' ? 'Human' : 'Assistant'; }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  // ---------- plain text ----------
  function messageToText(m) {
    let s = who(m.sender) + (m.created ? ' · ' + fmtDate(m.created) : '') + '\n';
    s += (m.text || '') + '\n';
    m.attachments.forEach(a => { s += `[attachment: ${a.name}]\n`; if (a.content) s += a.content + '\n'; });
    m.files.forEach(f => { s += `[file: ${f.name}]\n`; });
    return s;
  }
  function conversationToText(c) {
    let s = c.title + '\n' + 'Created: ' + fmtDate(c.created) + '  Updated: ' + fmtDate(c.updated) + '\n' + '='.repeat(60) + '\n\n';
    c.messages.forEach(m => {
      s += messageToText(m) + '\n';
      m.artifactIds.forEach(id => {
        const art = c.artifacts.find(a => a.id === id);
        if (art) s += `--- Artifact: ${art.title} (${art.filename}) ---\n${art.content}\n\n`;
      });
      s += '-'.repeat(40) + '\n\n';
    });
    return s;
  }

  // ---------- markdown ----------
  function messageToMarkdown(m, conv) {
    let s = `**${who(m.sender)}**` + (m.created ? ` · _${fmtDate(m.created)}_` : '') + '\n\n';
    s += (m.text || '') + '\n\n';
    m.attachments.forEach(a => {
      s += `> 📎 **Attachment:** ${a.name}\n`;
      if (a.content) s += '\n```\n' + a.content + '\n```\n';
    });
    m.files.forEach(f => { s += `> 📄 **File:** ${f.name}\n`; });
    if (conv) m.artifactIds.forEach(id => {
      const art = conv.artifacts.find(a => a.id === id);
      if (art) {
        const lang = art.kind === 'code' ? (art.language || '') : (art.ext === 'md' ? 'markdown' : art.ext);
        s += `\n> 🧩 **Artifact:** ${art.title} \`(${art.filename})\`\n\n` + '```' + lang + '\n' + art.content + '\n```\n';
      }
    });
    return s;
  }
  function conversationToMarkdown(c) {
    let s = `# ${c.title}\n\n_Created: ${fmtDate(c.created)} · Updated: ${fmtDate(c.updated)}_\n\n---\n\n`;
    c.messages.forEach(m => { s += messageToMarkdown(m, c) + '\n---\n\n'; });
    return s;
  }

  // ---------- json ----------
  function conversationToJson(c) { return JSON.stringify(c, null, 2); }

  // ---------- html (standalone, self-contained) ----------
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function conversationToHtml(c) {
    const rows = c.messages.map(m => {
      const arts = m.artifactIds.map(id => {
        const a = c.artifacts.find(x => x.id === id); if (!a) return '';
        return `<div class="art"><b>🧩 ${escapeHtml(a.title)}</b> <span>(${escapeHtml(a.filename)})</span><pre>${escapeHtml(a.content)}</pre></div>`;
      }).join('');
      const atts = m.attachments.map(a => `<div class="att">📎 ${escapeHtml(a.name)}${a.content ? '<pre>' + escapeHtml(a.content) + '</pre>' : ''}</div>`).join('');
      return `<div class="m ${m.sender}"><div class="hd">${who(m.sender)} · ${escapeHtml(fmtDate(m.created))}</div><div class="bd">${escapeHtml(m.text).replace(/\n/g, '<br>')}</div>${atts}${arts}</div>`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(c.title)}</title>
<style>body{font-family:'Hanken Grotesk',system-ui,sans-serif;max-width:820px;margin:0 auto;padding:30px;background:#0e1719;color:#e8f0f0}
h1{letter-spacing:-.3px}.m{margin:18px 0;padding:14px 16px;border-radius:12px;border:1px solid #24383c}
.m.human{background:rgba(46,89,110,.4)}.m.assistant{background:rgba(28,48,46,.5)}
.hd{font-size:.78em;color:#9fb4b6;margin-bottom:6px;font-weight:700}.bd{white-space:normal;line-height:1.55}
pre{background:rgba(0,0,0,.35);padding:12px;border-radius:8px;overflow:auto;font-size:.85em}
.art,.att{margin-top:10px;border:1px solid #2f5a4a;border-radius:9px;padding:10px;font-size:.9em}</style></head>
<body><h1>${escapeHtml(c.title)}</h1><p style="color:#9fb4b6">Created: ${escapeHtml(fmtDate(c.created))} · Updated: ${escapeHtml(fmtDate(c.updated))}</p>${rows}</body></html>`;
  }

  // ============================ pdf (chat-log layout) ============================
  // Renders a conversation the way the web app shows it: speaker-coloured headers
  // with a left accent bar, markdown-aware body (headings, bold/italic, inline
  // code, lists), and shaded monospace code boxes. Real (selectable / copy-able)
  // text throughout. Uses embedded Hanken Grotesk + DejaVu Sans Mono when present,
  // else falls back to the built-in helvetica / courier.
  const PDF = {
    M: 50, bodySize: 10.3, bodyLH: 1.5, codeSize: 8.6, codeLH: 1.45, indent: 15,
    ink: '#1f2a2e', muted: '#6a7b80', rule: '#e1e7e7',
    human: { accent: '#3d8bb5', label: '#2a6f95', name: 'Human' },
    asst: { accent: '#3fa17d', label: '#2f8f63', name: 'Claude' },
    codeBg: '#f3f5f6', codeBorder: '#dde4e5', codeInk: '#26323a', inlineBg: '#eceff0', inlineInk: '#1c3a4a'
  };

  function newCtx() {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    let sans = 'helvetica', mono = 'courier';
    if (global.ClaudePdfFonts && global.ClaudePdfFonts.register(doc)) { sans = 'Hanken'; mono = 'Mono'; }
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    return { doc, fam: { sans, mono }, W, H, M: PDF.M, y: PDF.M, accent: null };
  }

  function measure(ctx, r) { ctx.doc.setFont(r.font, r.style); ctx.doc.setFontSize(r.size); return ctx.doc.getTextWidth(r.text); }

  // Split inline markdown (`code`, **bold**, *italic*) into styled runs.
  function inlineRuns(text, fam, size, color) {
    const runs = [];
    const push = (t, style, code) => { if (t) runs.push({ text: t, font: code ? fam.mono : fam.sans, style: code ? 'normal' : (style || 'normal'), size: code ? size * 0.92 : size, color: code ? PDF.inlineInk : color, code: !!code }); };
    const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|(?:^|\s)_[^_\n]+_(?=\s|$))/g;
    let last = 0, m;
    while ((m = re.exec(String(text)))) {
      let tok = m[0], lead = '';
      if (/^\s/.test(tok) && tok[1] === '_') { lead = tok[0]; tok = tok.slice(1); }
      push(String(text).slice(last, m.index) + lead, 'normal', false);
      if (tok[0] === '`') push(tok.slice(1, -1), 'normal', true);
      else if (tok.startsWith('**') || tok.startsWith('__')) push(tok.slice(2, -2), 'bold', false);
      else push(tok.slice(1, -1), 'italic', false);
      last = m.index + m[0].length;
    }
    push(String(text).slice(last), 'normal', false);
    return runs.length ? runs : [{ text: '', font: fam.sans, style: 'normal', size, color, code: false }];
  }

  // Greedy line-break a list of styled runs to maxW; hard-breaks over-long tokens.
  function wrapRuns(ctx, runs, maxW) {
    const lines = []; let line = [], lineW = 0;
    const flush = () => { while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop(); lines.push(line); line = []; lineW = 0; };
    runs.forEach(run => {
      run.text.split(/(\s+)/).forEach(tok => {
        if (tok === '') return;
        const isSpace = /^\s+$/.test(tok);
        let piece = { text: tok, font: run.font, style: run.style, size: run.size, color: run.color, code: run.code };
        let w = measure(ctx, piece);
        if (!isSpace && lineW + w > maxW && line.length) flush();
        if (isSpace && line.length === 0) return;
        if (!isSpace) {
          while (w > maxW && piece.text.length > 1) {
            const room = line.length ? maxW - lineW : maxW;
            let lo = 0, hi = piece.text.length;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(ctx, { ...piece, text: piece.text.slice(0, mid) }) <= room) lo = mid; else hi = mid - 1; }
            if (lo === 0) { if (line.length) { flush(); continue; } lo = 1; }
            const head = { ...piece, text: piece.text.slice(0, lo) };
            line.push(head); flush();
            piece = { ...piece, text: piece.text.slice(lo) }; w = measure(ctx, piece);
          }
        }
        line.push(piece); lineW += w;
      });
    });
    flush();
    return lines.length ? lines : [[]];
  }

  // Render a paragraph of runs with wrapping, accent bar, optional list marker.
  function para(ctx, text, opt) {
    opt = opt || {};
    const size = opt.size || PDF.bodySize, lh = (opt.lh || PDF.bodyLH) * size;
    const left = opt.left != null ? opt.left : (ctx.M + PDF.indent);
    const right = ctx.W - ctx.M;
    const markerGap = (opt.bulletCircle || opt.bulletText) ? 14 : 0;
    const runs = opt.runs || inlineRuns(text, ctx.fam, size, opt.color || PDF.ink);
    const lines = wrapRuns(ctx, runs, right - left - markerGap);
    lines.forEach((ln, idx) => {
      if (ctx.y + lh > ctx.H - ctx.M) { ctx.doc.addPage(); ctx.y = ctx.M; }
      if (ctx.accent) { ctx.doc.setFillColor(ctx.accent); ctx.doc.rect(ctx.M, ctx.y, 3, lh, 'F'); }
      const baseY = ctx.y + lh * 0.72;
      if (idx === 0 && opt.bulletCircle) { ctx.doc.setFillColor(opt.markerColor || PDF.muted); ctx.doc.circle(left + 4, ctx.y + lh * 0.52, 1.5, 'F'); }
      if (idx === 0 && opt.bulletText) { ctx.doc.setFont(ctx.fam.sans, 'normal', size); ctx.doc.setFontSize(size); ctx.doc.setTextColor(opt.markerColor || PDF.muted); ctx.doc.text(opt.bulletText, left, baseY); }
      let x = left + markerGap;
      ln.forEach(r => {
        const w = measure(ctx, r);
        if (r.code) { ctx.doc.setFillColor(PDF.inlineBg); ctx.doc.roundedRect(x - 1, ctx.y + lh * 0.14, w + 2, lh * 0.74, 2, 2, 'F'); }
        ctx.doc.setFont(r.font, r.style); ctx.doc.setFontSize(r.size); ctx.doc.setTextColor(r.color);
        ctx.doc.text(r.text, x, baseY); x += w;
      });
      ctx.y += lh;
    });
    ctx.y += (opt.gapAfter != null ? opt.gapAfter : size * 0.5);
  }

  // Shaded monospace code box; splits cleanly across pages.
  function codeBox(ctx, code) {
    const size = PDF.codeSize, lh = PDF.codeLH * size, padX = 9, padY = 7;
    const boxL = ctx.M + PDF.indent, boxR = ctx.W - ctx.M, innerW = boxR - boxL - padX * 2;
    ctx.doc.setFont(ctx.fam.mono, 'normal'); ctx.doc.setFontSize(size);
    const wrapped = [];
    String(code).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').forEach(line => {
      if (line === '') { wrapped.push(''); return; }
      ctx.doc.splitTextToSize(line, innerW).forEach(s => {
        while (s.length > 1 && ctx.doc.getTextWidth(s) > innerW) {
          let lo = 1, hi = s.length;
          while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.doc.getTextWidth(s.slice(0, mid)) <= innerW) lo = mid; else hi = mid - 1; }
          wrapped.push(s.slice(0, lo)); s = s.slice(lo);
        }
        wrapped.push(s);
      });
    });
    let i = 0;
    while (i < wrapped.length) {
      if (ctx.y + lh + padY * 2 > ctx.H - ctx.M) { ctx.doc.addPage(); ctx.y = ctx.M; }
      const avail = (ctx.H - ctx.M) - ctx.y - padY * 2;
      const n = Math.min(wrapped.length - i, Math.max(1, Math.floor(avail / lh)));
      const seg = wrapped.slice(i, i + n), boxH = seg.length * lh + padY * 2;
      ctx.doc.setFillColor(PDF.codeBg); ctx.doc.setDrawColor(PDF.codeBorder); ctx.doc.setLineWidth(0.7);
      ctx.doc.roundedRect(boxL, ctx.y, boxR - boxL, boxH, 4, 4, 'FD');
      if (ctx.accent) { ctx.doc.setFillColor(ctx.accent); ctx.doc.rect(ctx.M, ctx.y, 3, boxH, 'F'); }
      ctx.doc.setFont(ctx.fam.mono, 'normal'); ctx.doc.setFontSize(size); ctx.doc.setTextColor(PDF.codeInk);
      let ty = ctx.y + padY + lh * 0.72;
      seg.forEach(s => { ctx.doc.text(s, boxL + padX, ty); ty += lh; });
      ctx.y += boxH; i += n;
      if (i < wrapped.length) { ctx.doc.addPage(); ctx.y = ctx.M; }
    }
    ctx.y += 5;
  }

  // Block-level markdown: fenced code, headings, lists, quotes, rules, paragraphs.
  function renderMarkdown(ctx, text) {
    if (!text) return;
    String(text).replace(/\r\n?/g, '\n').split('```').forEach((part, pi) => {
      if (pi % 2 === 1) {
        let code = part; const nl = part.indexOf('\n');
        const first = (nl === -1 ? part : part.slice(0, nl)).trim();
        if (/^[a-zA-Z0-9_+\-.]{0,16}$/.test(first)) code = nl === -1 ? '' : part.slice(nl + 1);
        codeBox(ctx, code.replace(/\n+$/, ''));
        return;
      }
      const lines = part.split('\n'); let buf = [];
      const flush = () => { if (buf.length) { para(ctx, buf.join(' ')); buf = []; } };
      lines.forEach(raw => {
        const t = raw.trim(); let mm;
        if (t === '') { flush(); return; }
        if ((mm = /^(#{1,6})\s+(.*)$/.exec(t))) {
          flush(); const lv = mm[1].length, sz = lv <= 1 ? 14.5 : lv === 2 ? 12.8 : lv === 3 ? 11.6 : 11;
          ctx.y += 3;
          para(ctx, null, { runs: inlineRuns(mm[2], ctx.fam, sz, PDF.ink).map(r => r.code ? r : { ...r, style: 'bold' }), size: sz, lh: 1.3, gapAfter: sz * 0.35 });
          return;
        }
        if (/^(---|\*\*\*|___)\s*$/.test(t)) { flush(); ctx.y += 2; ctx.doc.setDrawColor(PDF.rule); ctx.doc.setLineWidth(0.8); ctx.doc.line(ctx.M + PDF.indent, ctx.y, ctx.W - ctx.M, ctx.y); ctx.y += 8; return; }
        if ((mm = /^[-*+]\s+(.*)$/.exec(t))) { flush(); para(ctx, mm[1], { left: ctx.M + PDF.indent + 6, bulletCircle: true, markerColor: ctx.accent || PDF.muted, gapAfter: 2 }); return; }
        if ((mm = /^(\d+)[.)]\s+(.*)$/.exec(t))) { flush(); para(ctx, mm[2], { left: ctx.M + PDF.indent + 6, bulletText: mm[1] + '.', markerColor: ctx.accent || PDF.muted, gapAfter: 2 }); return; }
        if ((mm = /^>\s?(.*)$/.exec(t))) { flush(); para(ctx, null, { runs: inlineRuns(mm[1], ctx.fam, PDF.bodySize, PDF.muted).map(r => r.code ? r : { ...r, style: 'italic' }), left: ctx.M + PDF.indent + 8, gapAfter: 2 }); return; }
        buf.push(t);
      });
      flush();
    });
  }

  function labelLine(ctx, text, color, style) {
    para(ctx, null, { runs: [{ text, font: ctx.fam.sans, style: style || 'bold', size: 9.3, color, code: false }], size: 9.3, gapAfter: 3 });
  }

  function renderMessage(ctx, c, m) {
    const sp = m.sender === 'human' ? PDF.human : PDF.asst;
    ctx.y += 12;
    if (ctx.y + 44 > ctx.H - ctx.M) { ctx.doc.addPage(); ctx.y = ctx.M; }
    // header: coloured sender (left) + muted timestamp (right)
    ctx.doc.setFont(ctx.fam.sans, 'bold'); ctx.doc.setFontSize(11); ctx.doc.setTextColor(sp.label);
    ctx.doc.text(sp.name, ctx.M, ctx.y + 9);
    ctx.doc.setFont(ctx.fam.sans, 'normal'); ctx.doc.setFontSize(8.6); ctx.doc.setTextColor(PDF.muted);
    ctx.doc.text(fmtDate(m.created), ctx.W - ctx.M, ctx.y + 9, { align: 'right' });
    ctx.y += 15;
    ctx.doc.setDrawColor(sp.accent); ctx.doc.setLineWidth(0.9); ctx.doc.line(ctx.M, ctx.y, ctx.W - ctx.M, ctx.y);
    ctx.y += 9;
    ctx.accent = sp.accent;
    renderMarkdown(ctx, m.text);
    (m.attachments || []).forEach(a => { ctx.y += 3; labelLine(ctx, 'Attachment: ' + a.name, PDF.muted, 'italic'); if (a.content) codeBox(ctx, a.content); });
    (m.files || []).forEach(f => { if (f.content) { ctx.y += 3; labelLine(ctx, 'File: ' + f.name, PDF.muted, 'italic'); codeBox(ctx, f.content); } });
    (m.artifactIds || []).forEach(id => { const art = c.artifacts.find(x => x.id === id); if (!art) return; ctx.y += 3; labelLine(ctx, 'Artifact: ' + art.title + '  (' + art.filename + ')', sp.label, 'bold'); if (art.content) codeBox(ctx, art.content); });
    ctx.accent = null;
    ctx.y += 4;
  }

  function renderConversationDoc(ctx, c) {
    para(ctx, null, { runs: [{ text: c.title, font: ctx.fam.sans, style: 'bold', size: 16.5, color: PDF.ink, code: false }], size: 16.5, lh: 1.25, left: ctx.M, gapAfter: 3 });
    para(ctx, null, { runs: [{ text: 'Created ' + fmtDate(c.created) + '    ·    Updated ' + fmtDate(c.updated) + '    ·    ' + c.messages.length + ' messages', font: ctx.fam.sans, style: 'normal', size: 9, color: PDF.muted, code: false }], size: 9, left: ctx.M, gapAfter: 7 });
    ctx.doc.setDrawColor(PDF.rule); ctx.doc.setLineWidth(1); ctx.doc.line(ctx.M, ctx.y, ctx.W - ctx.M, ctx.y);
    ctx.y += 2;
    c.messages.forEach(m => renderMessage(ctx, c, m));
  }

  function conversationToPdf(c) { const ctx = newCtx(); renderConversationDoc(ctx, c); return ctx.doc; }

  function conversationsToPdf(convs) {
    const ctx = newCtx();
    convs.forEach((c, i) => { if (i) { ctx.doc.addPage(); ctx.y = ctx.M; } renderConversationDoc(ctx, c); });
    return ctx.doc;
  }

  // ---------- png via html2canvas ----------
  async function nodeToPng(node, filename) {
    const theme = document.documentElement.getAttribute('data-theme');
    const bg = theme === 'light' ? '#f4f7f6' : '#16242a';
    const canvas = await global.html2canvas(node, { backgroundColor: bg, scale: 2, useCORS: true, logging: false });
    canvas.toBlob(b => download(filename, b, 'image/png'));
  }

  // ---------- artifacts ----------
  function artifactMime(ext) {
    return ({ md: 'text/markdown', html: 'text/html', svg: 'image/svg+xml', json: 'application/json',
      js: 'text/javascript', jsx: 'text/jsx', py: 'text/x-python', css: 'text/css', txt: 'text/plain' }[ext]) || 'text/plain';
  }
  function downloadArtifact(art, asExt) {
    const ext = asExt || art.ext;
    const base = P.safeName(art.title || 'artifact');
    download(base + '.' + ext, art.content, artifactMime(ext));
  }

  // ---------- whole library ----------
  function libraryToJson(convs) { return JSON.stringify(convs, null, 2); }

  async function libraryToZip(convs, opts) {
    opts = opts || { md: true, artifacts: true };
    const zip = new global.JSZip();
    convs.forEach((c, i) => {
      const folder = zip.folder(P.safeName(c.title) + '_' + (i + 1));
      if (opts.md) folder.file('conversation.md', conversationToMarkdown(c));
      folder.file('conversation.json', conversationToJson(c));
      if (opts.artifacts && c.artifacts.length) {
        const af = folder.folder('artifacts');
        const used = {};
        c.artifacts.forEach(a => {
          let fn = a.filename; if (used[fn]) { fn = fn.replace(/(\.\w+)$/, '_' + (++used[a.filename]) + '$1'); } else used[a.filename] = 1;
          af.file(fn, a.content);
        });
      }
    });
    return zip.generateAsync({ type: 'blob' });
  }

  global.ClaudeExport = {
    download, fmtDate,
    messageToText, messageToMarkdown,
    conversationToText, conversationToMarkdown, conversationToJson, conversationToHtml,
    conversationToPdf, conversationsToPdf, nodeToPng,
    downloadArtifact, libraryToJson, libraryToZip
  };
})(window);
