/* =========================================================================
   parser.js — parse Claude data exports (.zip / .json) into a normalized model
   Runs entirely in the browser. No data leaves the machine.
   ========================================================================= */
(function (global) {
  'use strict';

  // ---- artifact mime/language -> file extension ----------------------------
  const LANG_EXT = {
    python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
    jsx: 'jsx', tsx: 'tsx', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs',
    cs: 'cs', go: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb', php: 'php',
    swift: 'swift', kotlin: 'kt', scala: 'scala', r: 'r', sql: 'sql', bash: 'sh',
    sh: 'sh', shell: 'sh', zsh: 'sh', yaml: 'yaml', yml: 'yml', json: 'json',
    html: 'html', css: 'css', xml: 'xml', markdown: 'md', md: 'md', text: 'txt',
    plaintext: 'txt', toml: 'toml', dockerfile: 'dockerfile', perl: 'pl', lua: 'lua',
    matlab: 'm', dart: 'dart', haskell: 'hs', objective_c: 'm'
  };

  function artifactExtension(art) {
    const t = (art.type || '').toLowerCase();
    if (t.includes('react')) return 'jsx';
    if (t.includes('svg')) return 'svg';
    if (t.includes('mermaid')) return 'mermaid';
    if (t === 'text/html' || t.includes('html')) return 'html';
    if (t === 'text/markdown' || t.includes('markdown')) return 'md';
    if (t.includes('code') || t === 'application/vnd.ant.code') {
      return LANG_EXT[(art.language || '').toLowerCase()] || 'txt';
    }
    if (art.language && LANG_EXT[art.language.toLowerCase()]) return LANG_EXT[art.language.toLowerCase()];
    return 'txt';
  }

  function artifactKind(art) {
    const ext = artifactExtension(art);
    if (ext === 'svg') return 'svg';
    if (ext === 'md') return 'markdown';
    if (ext === 'html') return 'html';
    if (ext === 'mermaid') return 'mermaid';
    return 'code';
  }

  // ---- safe string apply for artifact 'update' commands --------------------
  function applyUpdate(content, oldStr, newStr) {
    if (oldStr == null) return content;
    const idx = content.indexOf(oldStr);
    if (idx === -1) return content; // can't locate; leave unchanged
    return content.slice(0, idx) + (newStr || '') + content.slice(idx + oldStr.length);
  }

  // ---- pull text + artifacts + tool info out of a message ------------------
  function processMessage(raw, artstate, order) {
    const sender = raw.sender === 'human' || raw.sender === 'user' ? 'human' : 'assistant';
    const blocks = [];
    let textParts = [];
    const msgArtifacts = [];

    const content = Array.isArray(raw.content) && raw.content.length ? raw.content : null;

    if (content) {
      for (const block of content) {
        const type = block.type;
        if (type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
          blocks.push({ type: 'text', text: block.text });
        } else if (type === 'tool_use') {
          const inp = block.input || {};
          const cmd = inp.command;
          // Only a genuine artifacts tool call is an artifact. Other tools
          // (bash/code-execution, repl, etc.) also carry an input.command, so
          // we must NOT treat every command-bearing tool_use as an artifact —
          // that produced blank "Untitled" cards. Require the artifacts tool
          // name, or an artifact-shaped create/update/rewrite command.
          const isArtifact = block.name === 'artifacts'
            || (/^(create|update|rewrite)$/.test(cmd || '')
                && (inp.id != null || inp.identifier != null || inp.title != null
                    || inp.content != null || inp.type != null || inp.old_str != null));
          if (isArtifact) {
            const command = cmd || 'create';
            const id = inp.id || inp.identifier || ('art_' + order.n);
            let st = artstate.get(id);
            if (!st) {
              st = { id, title: inp.title || 'Untitled', type: inp.type || '', language: inp.language || '', content: '', _order: order.n++ };
              artstate.set(id, st);
            }
            if (inp.title) st.title = inp.title;
            if (inp.type) st.type = inp.type;
            if (inp.language) st.language = inp.language;
            if (command === 'create' || command === 'rewrite') {
              st.content = inp.content != null ? inp.content : st.content;
            } else if (command === 'update') {
              st.content = applyUpdate(st.content, inp.old_str, inp.new_str);
            }
            blocks.push({ type: 'artifact-ref', id });
            if (!msgArtifacts.includes(id)) msgArtifacts.push(id);
          } else {
            blocks.push({ type: 'tool_use', name: block.name || 'tool', input: block.input });
          }
        } else if (type === 'tool_result') {
          blocks.push({ type: 'tool_result', name: block.name });
        }
      }
    }

    // fallback to flat .text field when no usable content array
    if (!textParts.length && typeof raw.text === 'string' && raw.text.trim()) {
      textParts.push(raw.text);
      if (!blocks.length) blocks.push({ type: 'text', text: raw.text });
    }

    // attachments (user files with extracted text) and bare file refs
    const attachments = (raw.attachments || []).map(a => ({
      name: a.file_name || a.name || 'attachment',
      size: a.file_size || a.size || null,
      type: a.file_type || a.type || '',
      content: a.extracted_content || a.content || ''
    }));
    const files = [];
    (raw.files_v2 || raw.files || []).forEach(f => {
      files.push({
        name: f.file_name || f.name || (f.file_kind ? f.file_kind + ' file' : 'file'),
        kind: f.file_kind || '',
        type: f.file_type || f.file_kind || '',
        size: f.file_size || f.size || null,
        content: f.extracted_content || f.content || (f.document && f.document.extracted_content) || ''
      });
    });

    return {
      id: raw.uuid || ('m' + order.n++),
      sender,
      created: raw.created_at || raw.created || null,
      updated: raw.updated_at || null,
      text: textParts.join('\n\n'),
      blocks,
      attachments,
      files,
      artifactIds: msgArtifacts
    };
  }

  // ---- normalize one conversation -----------------------------------------
  function normalizeConversation(raw, sourceName) {
    const artstate = new Map();
    const order = { n: 0 };
    const rawMsgs = raw.chat_messages || raw.messages || [];
    const messages = rawMsgs.map(m => processMessage(m, artstate, order));

    // resolve final artifact snapshots
    const artifacts = [];
    artstate.forEach(st => {
      const ext = artifactExtension(st);
      artifacts.push({
        id: st.id, title: st.title || 'Untitled', type: st.type, language: st.language,
        content: st.content || '', ext, kind: artifactKind(st),
        filename: safeName(st.title || 'artifact') + '.' + ext
      });
    });

    return {
      id: raw.uuid || raw.id || ('c_' + Math.random().toString(36).slice(2)),
      title: (raw.name && raw.name.trim()) || 'Untitled Conversation',
      created: raw.created_at || raw.created || null,
      updated: raw.updated_at || raw.updated || raw.created_at || null,
      source: sourceName,
      messages,
      artifacts,
      summary: raw.summary || ''
    };
  }

  function safeName(s) {
    return String(s).replace(/[^\w\d\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'file';
  }

  // ---- detect a conversations array inside arbitrary JSON ------------------
  function extractConversations(json) {
    if (Array.isArray(json)) {
      // array of conversations? (objects with chat_messages/messages or name+uuid)
      if (json.length && (json[0].chat_messages || json[0].messages || json[0].name || json[0].uuid)) return json;
      return [];
    }
    if (json && typeof json === 'object') {
      if (Array.isArray(json.conversations)) return json.conversations;
      if (json.chat_messages || json.messages) return [json]; // single conversation
    }
    return [];
  }

  // ---- public: parse a File ------------------------------------------------
  async function parseFile(file) {
    const name = file.name || 'export';
    if (/\.zip$/i.test(name)) return parseZip(file);
    if (/\.json$/i.test(name)) {
      const text = await file.text();
      return parseJsonText(text, name);
    }
    // try as text/json anyway
    const text = await file.text();
    return parseJsonText(text, name);
  }

  function parseJsonText(text, sourceName) {
    let json;
    try { json = JSON.parse(text); }
    catch (e) { throw new Error('Not valid JSON: ' + sourceName); }
    const convs = extractConversations(json);
    return convs.map(c => normalizeConversation(c, sourceName));
  }

  async function parseZip(file) {
    if (!global.JSZip) throw new Error('JSZip not loaded');
    const zip = await global.JSZip.loadAsync(file);
    const out = [];
    const jsonFiles = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      if (/conversations?\.json$/i.test(path)) jsonFiles.unshift(path); // prioritize
      else if (/\.json$/i.test(path) && !/users?\.json$|projects?\.json$/i.test(path)) jsonFiles.push(path);
    });
    if (!jsonFiles.length) throw new Error('No conversations.json found in ' + (file.name || 'zip'));
    for (const path of jsonFiles) {
      try {
        const text = await zip.file(path).async('string');
        const convs = parseJsonText(text, file.name || path);
        convs.forEach(c => out.push(c));
        if (/conversations?\.json$/i.test(path) && out.length) break; // main file handled
      } catch (e) { /* skip unreadable json */ }
    }
    if (!out.length) throw new Error('No readable conversations in ' + (file.name || 'zip'));
    return out;
  }

  global.ClaudeParser = { parseFile, artifactExtension, artifactKind, safeName };
})(window);
