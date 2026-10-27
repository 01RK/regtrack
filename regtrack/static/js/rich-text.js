/* Shared rendering of imported draft text: Markdown (GFM tables), KaTeX formulas, sanitised HTML. */
(function () {
  // Standards use a single ~ for numeric ranges; only paired ~~ marks deletion.
  marked.use({ tokenizer: { del(src) {
    const match = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src);
    if (match) return { type: "del", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
  } } });
  const MATH = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g;

  /** Markdown → sanitised HTML; formulas become empty slots filled by mount(). */
  function render(value, options = {}) {
    const formulas = [];
    const withMathSlots = value.replace(MATH, (_match, block, inline) => {
      const display = block !== undefined;
      const index = formulas.push({ tex: display ? block : inline, display }) - 1;
      return `<span class="math-slot" data-index="${index}"></span>`;
    });
    return { html: DOMPurify.sanitize(marked.parse(withMathSlots, { gfm: true, breaks: options.breaks !== false }),
      { FORBID_TAGS: ["img", "iframe", "script", "style", "svg"] }), formulas };
  }

  function mount(root, formulas) {
    root.querySelectorAll(".math-slot").forEach(slot => {
      const formula = formulas[Number(slot.dataset.index)];
      katex.render(formula.tex, slot, { displayMode: formula.display, throwOnError: false, trust: false });
    });
  }

  window.RichText = { MATH, render, mount };
})();
