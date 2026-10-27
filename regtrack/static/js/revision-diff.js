/* Revision marks between mapped clauses, computed with jsdiff (vendor/diff.min.js).
   The before side marks removed text with <del class="rev-del">, the after side marks inserted text with
   <mark class="rev-ins">. Each side keeps its own complete Markdown, so tables, lists and formulas still render:
   formulas, code spans and links are atomic tokens; Markdown syntax (line markers, table pipes and separator
   rows, emphasis markers, raw HTML) is never wrapped. */
(function () {
  const SEPARATOR_ROW = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const LINE_MARKER = /^[ \t]*(?:#{1,6}[ \t]|>[ \t]?|[-+*][ \t]|\d+[.)][ \t])/;
  // Order matters: atomic tokens first, then syntax, whitespace, words; anything else is one character (CJK, punctuation).
  const INLINE = new RegExp([
    String.raw`(\$\$[\s\S]+?\$\$|\$[^\n$]+?\$|\x60[^\x60\n]+\x60|\[[^\]\n]*\]\([^)\n]*\))`,  // 1 atomic, markable
    String.raw`(<[^>\n]+>|\\.|\||[*_~]+)`,                                                      // 2 syntax
    String.raw`([ \t]+)`,                                                                        // 3 whitespace
    String.raw`([A-Za-z0-9\u00C0-\u024F]+(?:\.[0-9]+)*)`,                                         // 4 word / number
    String.raw`([\s\S])`,                                                                        // 5 single character
  ].join("|"), "gu");
  const SYNTAX = "syntax", SPACE = "space", TEXT = "text";

  function tokenizeLines(segment, tokens, atLineStart) {
    segment.split("\n").forEach((line, index) => {
      if (index) tokens.push({ text: "\n", kind: SYNTAX });
      if (index || atLineStart) {
        if (SEPARATOR_ROW.test(line) && line.includes("-")) { tokens.push({ text: line, kind: SYNTAX }); return; }
        const marker = LINE_MARKER.exec(line);
        if (marker) { tokens.push({ text: marker[0], kind: SYNTAX }); line = line.slice(marker[0].length); }
      }
      for (const m of line.matchAll(INLINE)) tokens.push({ text: m[0], kind: m[2] ? SYNTAX : m[3] ? SPACE : TEXT });
    });
  }

  // Display formulas may span lines, so they are cut out before the line-based pass.
  function tokenize(value) {
    const tokens = [];
    let last = 0;
    for (const m of value.matchAll(/\$\$[\s\S]+?\$\$/g)) {
      tokenizeLines(value.slice(last, m.index), tokens, last === 0 || value[last - 1] === "\n");
      tokens.push({ text: m[0], kind: TEXT });
      last = m.index + m[0].length;
    }
    if (last < value.length) tokenizeLines(value.slice(last), tokens, last === 0);
    return tokens;
  }

  // One token stream per side; a boundary token separates clauses so a split/merge diffs as one text.
  function stream(values) {
    const tokens = [], owner = [];
    values.forEach((value, clause) => {
      if (clause) { tokens.push({ text: "\u0000", kind: SYNTAX }); owner.push(-1); }
      for (const token of tokenize(value || "")) { tokens.push(token); owner.push(clause); }
    });
    return { tokens, owner };
  }

  const same = (a, b) => a === b || (/^[ \t]+$/.test(a) && /^[ \t]+$/.test(b));

  function wrap(tokens, changed, tag, escape) {
    let html = "", open = false, space = "";
    const close = () => { if (open) { html += `</${tag}>`; open = false; } html += space; space = ""; };
    tokens.forEach((token, i) => {
      const text = escape(token.text);
      if (token.kind === SYNTAX || !changed[i]) { close(); html += text; return; }
      if (token.kind === SPACE) { if (open) space += text; else html += text; return; }
      if (!open) { html += `<${tag} class="${tag === "del" ? "rev-del" : "rev-ins"}">`; open = true; }
      html += space + text; space = "";
    });
    close();
    return html;
  }

  /**
   * beforeValues / afterValues: one string per mapped clause on each side.
   * Returns { before: [...], after: [...] } with marks inserted, one string per clause.
   * markdown=true keeps the text as Markdown (for RichText.render); false HTML-escapes it (plain titles).
   */
  function mark(beforeValues, afterValues, { markdown, escape }) {
    const old = stream(beforeValues), neu = stream(afterValues);
    const changed = { before: old.tokens.map(() => false), after: neu.tokens.map(() => false) };
    let i = 0, j = 0;
    for (const part of Diff.diffArrays(old.tokens.map(t => t.text), neu.tokens.map(t => t.text), { comparator: same })) {
      if (part.removed) { for (let k = 0; k < part.count; k++) changed.before[i++] = true; }
      else if (part.added) { for (let k = 0; k < part.count; k++) changed.after[j++] = true; }
      else { i += part.count; j += part.count; }
    }
    const toText = markdown ? (s => s) : escape;
    const split = (side, data, tag, count) => Array.from({ length: count }, (_, clause) => {
      const idx = data.owner.map((o, k) => o === clause ? k : -1).filter(k => k >= 0);
      return wrap(idx.map(k => data.tokens[k]), idx.map(k => changed[side][k]), tag, toText);
    });
    return { before: split("before", old, "del", beforeValues.length), after: split("after", neu, "mark", afterValues.length) };
  }

  window.RevisionDiff = { mark };
})();
