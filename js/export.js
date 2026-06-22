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

  // ---------- pdf (jsPDF text layout) ----------
  // Wrap text to maxW. Splits on real newlines, then on spaces (via jsPDF),
  // then HARD-breaks any remaining over-long run by character so nothing
  // overflows the right margin. Assumes the caller already set the font/size.
  function wrapText(doc, text, maxW) {
    const out = [];
    String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n').forEach(line => {
      if (line === '') { out.push(''); return; }
      doc.splitTextToSize(line, maxW).forEach(seg => {
        // jsPDF only breaks on spaces; force-break long unbreakable tokens.
        while (seg.length > 1 && doc.getTextWidth(seg) > maxW) {
          let lo = 1, hi = seg.length;
          while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (doc.getTextWidth(seg.slice(0, mid)) <= maxW) lo = mid; else hi = mid - 1; }
          out.push(seg.slice(0, lo)); seg = seg.slice(lo);
        }
        out.push(seg);
      });
    });
    return out;
  }

  function makeCtx(doc) {
    const M = 48, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    return { doc, M, W, H, maxW: W - M * 2, y: M };
  }

  // Draw a text block. One VISUAL line per draw, y advanced by a real line
  // height each time — this is what keeps lines from overlapping.
  function block(ctx, text, opt) {
    opt = opt || {};
    const size = opt.size || 10.5, mono = !!opt.mono, indent = opt.indent || 0;
    ctx.doc.setFont(mono ? 'courier' : 'helvetica', opt.style || 'normal');
    ctx.doc.setFontSize(size);
    ctx.doc.setTextColor(opt.color || '#1c2b2e');
    const lh = size * 1.42;
    wrapText(ctx.doc, text, ctx.maxW - indent).forEach(ln => {
      if (ctx.y + lh > ctx.H - ctx.M) { ctx.doc.addPage(); ctx.y = ctx.M; }
      ctx.doc.text(ln, ctx.M + indent, ctx.y);
      ctx.y += lh;
    });
    if (opt.gapAfter) ctx.y += opt.gapAfter;
  }

  // Render a message body with fenced-code awareness: ```code``` -> monospace.
  function renderBody(ctx, text) {
    if (!text) return;
    String(text).split('```').forEach((part, i) => {
      if (part === '') return;
      if (i % 2 === 1) {
        const body = part.replace(/^[ \t]*[\w.+-]*\n/, '').replace(/\n+$/, ''); // strip lang label + trailing nl
        block(ctx, body, { size: 8.5, mono: true, color: '#243', gapAfter: 5 });
      } else {
        block(ctx, part.replace(/^\n+|\n+$/g, ''), { size: 10.5, color: '#1c2b2e', gapAfter: 3 });
      }
    });
  }

  function renderConversation(ctx, c) {
    block(ctx, c.title, { size: 18, style: 'bold', color: '#143028', gapAfter: 2 });
    block(ctx, 'Created: ' + fmtDate(c.created) + '   Updated: ' + fmtDate(c.updated), { size: 9, style: 'italic', color: '#5a7075', gapAfter: 8 });
    c.messages.forEach(m => {
      if (ctx.y + 28 > ctx.H - ctx.M) { ctx.doc.addPage(); ctx.y = ctx.M; }
      ctx.y += 6;
      ctx.doc.setDrawColor('#cdd8d8'); ctx.doc.line(ctx.M, ctx.y, ctx.W - ctx.M, ctx.y); ctx.y += 14;
      block(ctx, who(m.sender) + '  ·  ' + fmtDate(m.created), { size: 10, style: 'bold', color: m.sender === 'human' ? '#2a6f95' : '#2f8f63', gapAfter: 3 });
      renderBody(ctx, m.text);
      m.attachments.forEach(a => {
        block(ctx, 'Attachment: ' + a.name, { size: 9, style: 'italic', color: '#5a7075', gapAfter: 2 });
        if (a.content) block(ctx, a.content, { size: 8, mono: true, color: '#3a5055', gapAfter: 5 });
      });
      m.artifactIds.forEach(id => {
        const art = c.artifacts.find(x => x.id === id); if (!art) return;
        block(ctx, 'Artifact: ' + art.title + ' (' + art.filename + ')', { size: 9.5, style: 'bold', color: '#2f8f63', gapAfter: 2 });
        block(ctx, art.content, { size: 8, mono: true, color: '#243', gapAfter: 5 });
      });
    });
  }

  function conversationToPdf(c) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    renderConversation(makeCtx(doc), c);
    return doc;
  }

  // Multiple conversations into one PDF (page break between each).
  function conversationsToPdf(convs) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const ctx = makeCtx(doc);
    convs.forEach((c, i) => { if (i) { doc.addPage(); ctx.y = ctx.M; } renderConversation(ctx, c); });
    return doc;
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
