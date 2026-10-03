App.ready(async () => {
  const { get, post, put, esc, dash, tag, fail, ok, confirmAsync } = App;
  // Standards use a single ~ for numeric ranges; only paired ~~ marks deletion.
  marked.use({ tokenizer: { del(src) {
    const match = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src);
    if (match) return { type: "del", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
  } } });
  const id = Number(document.getElementById("draft-page").dataset.id);
  const whole = document.getElementById("whole-content"), note = document.getElementById("chapter-content");
  let data, activeId = null;
  let language = localStorage.getItem("regtrack.reader.language") === "en" ? "en" : "cn";
  let collapsed = new Set();
  let chaptersById = new Map();
  let chaptersByNo = new Map();
  let childrenByNo = new Map();
  async function showView(view) {
    const previous = document.querySelector(".draft-view-tabs button.active")?.dataset.view;
    if (previous !== view) {
      const pending = previous === "reader" ? note : whole;
      if (pending.value.trim() && !await confirmAsync("批注尚未保存，切换后将丢弃这段输入。继续切换？")) return;
      if (!await resolvePendingEditor()) return;
      pending.value = "";
    }
    document.querySelectorAll("[data-view]").forEach(b => { const active = b.dataset.view === view; b.classList.toggle("active", active); b.setAttribute("aria-selected", String(active)); });
    ["overview", "reader"].forEach(v => { document.getElementById(`view-${v}`).hidden = v !== view; });
    history.replaceState(null, "", `#${view}`);
  }
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => showView(b.dataset.view));
  window.addEventListener("beforeunload", e => { if (whole.value.trim() || note.value.trim() || dirtyEditor()) { e.preventDefault(); e.returnValue = ""; } });
  const annotation = a => `<article class="annotation-card" data-annotation-id="${a.id}">
    <div data-annotation-readonly><small>创建时间：${esc(a.created_at)} · ${esc(a.created_by)}<br>修改时间：${esc(a.updated_at)} · ${esc(a.updated_by)}</small><p>${esc(a.content)}</p>
      <div class="annotation-actions"><button type="button" class="btn btn-outline-secondary btn-sm" data-annotation-edit>编辑批注</button></div>
    </div>
    <form data-annotation-editor hidden><textarea class="form-control" required>${esc(a.content)}</textarea><div class="annotation-edit-actions"><button type="button" class="btn btn-outline-secondary btn-sm" data-annotation-cancel>取消</button><button class="btn btn-primary btn-sm">保存修改</button></div></form>
  </article>`;
  function dirtyEditor() {
    return [...document.querySelectorAll("[data-annotation-editor]:not([hidden])")].find(editor => {
      const saved = data?.annotations.find(a => String(a.id) === editor.closest("[data-annotation-id]").dataset.annotationId);
      return saved && editor.querySelector("textarea").value.trim() !== saved.content;
    });
  }
  function refreshAnnotationCard(card, item) {
    const next = document.createElement("div"); next.innerHTML = annotation(item);
    const parent = card.parentElement; card.replaceWith(next.firstElementChild);
    bindAnnotationEditors(parent);
  }
  async function resolvePendingEditor() {
    const editor = dirtyEditor();
    if (!editor) return true;
    const card = editor.closest("[data-annotation-id]");
    const proceed = await new Promise(resolve => {
      let chosen = false;
      const modal = App.openModal({
        title: "批注尚未保存", size: "sm",
        body: "这条批注已有未保存的修改。请先决定如何处理。",
        footer: '<button class="btn btn-outline-secondary btn-sm" data-stay>继续编辑</button><button class="btn btn-outline-danger btn-sm" data-discard>放弃修改</button><button class="btn btn-primary btn-sm" data-save>保存并继续</button>',
        onHidden: () => { if (!chosen) resolve(false); },
      });
      modal.footer.querySelector("[data-stay]").onclick = async () => { chosen = true; await modal.close(); resolve(false); };
      modal.footer.querySelector("[data-discard]").onclick = async () => {
        chosen = true;
        editor.querySelector("textarea").value = data.annotations.find(a => String(a.id) === card.dataset.annotationId).content;
        editor.hidden = true; card.querySelector("[data-annotation-readonly]").hidden = false;
        await modal.close(); resolve(true);
      };
      modal.footer.querySelector("[data-save]").onclick = async e => {
        e.currentTarget.disabled = true;
        try {
          const saved = await put(`/api/drafts/${id}/annotations/${card.dataset.annotationId}`, { content: editor.querySelector("textarea").value });
          const item = data.annotations.find(a => a.id === saved.id);
          Object.assign(item, saved); refreshAnnotationCard(card, item);
          chosen = true; await modal.close(); resolve(true);
        } catch (err) { fail(err.message); e.currentTarget.disabled = false; }
      };
    });
    return proceed ? resolvePendingEditor() : false;
  }
  function bindAnnotationEditors(root) {
    root.querySelectorAll("[data-annotation-id]").forEach(card => {
      const readonly = card.querySelector("[data-annotation-readonly]"), editor = card.querySelector("[data-annotation-editor]");
      card.querySelector("[data-annotation-edit]").onclick = () => { readonly.hidden = true; editor.hidden = false; editor.querySelector("textarea").focus(); };
      card.querySelector("[data-annotation-cancel]").onclick = () => { editor.hidden = true; readonly.hidden = false; };
      editor.onsubmit = async e => {
        e.preventDefault(); const button = editor.querySelector("button[type=submit],button:not([type])"); button.disabled = true;
        try {
          const saved = await put(`/api/drafts/${id}/annotations/${card.dataset.annotationId}`, { content: editor.querySelector("textarea").value });
          const item = data.annotations.find(a => a.id === saved.id);
          Object.assign(item, saved);
          refreshAnnotationCard(card, item); ok("批注已更新");
        }
        catch (e) { fail(e.message); } finally { button.disabled = false; }
      };
    });
  }
  const titleOf = c => (language === "cn" ? c.title_cn || c.title_en : c.title_en || c.title_cn) || "";
  const contentOf = c => (language === "cn" ? c.content_cn || c.content_en : c.content_en || c.content_cn) || "";
  const displayNo = c => c.level === 1 && (
    /^(前言|引言)$/.test((c.title_cn || "").trim()) ||
    /^(foreword|preface|introduction)$/i.test((c.title_en || "").trim()) ||
    /^(foreword|preface|introduction)$/i.test((c.clause_type || "").trim())
  ) ? "0" : c.clause_no;
  const treeLabel = c => `${displayNo(c)} ${titleOf(c)}`;
  function isVisible(c) {
    let parentNo = c.parent_clause_no;
    while (parentNo) {
      const parent = chaptersByNo.get(parentNo);
      if (!parent) break;
      if (collapsed.has(parent.id)) return false;
      parentNo = parent.parent_clause_no;
    }
    return true;
  }
  function renderTree() {
    const query = document.getElementById("chapter-search").value.trim().toLowerCase();
    const matches = new Set();
    if (query) {
      for (const chapter of data.chapters) {
        if (!`${displayNo(chapter)} ${chapter.title_cn} ${chapter.title_en}`.toLowerCase().includes(query)) continue;
        matches.add(chapter.id);
        let parentNo = chapter.parent_clause_no;
        while (parentNo) {
          const parent = chaptersByNo.get(parentNo);
          if (!parent) break;
          matches.add(parent.id);
          parentNo = parent.parent_clause_no;
        }
      }
    }
    const chapters = data.chapters.filter(c => query ? matches.has(c.id) : isVisible(c));
    document.getElementById("chapter-tree").innerHTML = chapters.map(c => {
      const hasChildren = childrenByNo.has(c.clause_no);
      const expanded = !collapsed.has(c.id);
      const toggle = hasChildren
        ? `<button type="button" class="tree-toggle" data-tree-toggle="${c.id}" aria-label="${expanded ? "收起" : "展开"}${esc(displayNo(c))}下级条款" aria-expanded="${expanded}" ${query ? "disabled" : ""}><span class="tree-chevron" aria-hidden="true"></span></button>`
        : '<span class="tree-spacer"></span>';
      return `<div class="tree-row" style="padding-left:${Math.min(c.level - 1, 8) * 15}px">${toggle}<button type="button" data-chapter="${c.id}" class="tree-entry ${c.id === activeId ? "active" : ""}" aria-current="${c.id === activeId}">${esc(treeLabel(c))}</button></div>`;
    }).join("") || '<p class="text-muted p-2">没有匹配章节</p>';
    document.querySelectorAll("[data-tree-toggle]").forEach(button => button.onclick = () => {
      const chapterId = Number(button.dataset.treeToggle);
      if (collapsed.has(chapterId)) collapsed.delete(chapterId); else collapsed.add(chapterId);
      renderTree();
    });
    document.querySelectorAll("[data-chapter]").forEach(button => button.onclick = async () => {
      if (Number(button.dataset.chapter) === activeId) return;
      if (note.value.trim() && !await confirmAsync("当前章节批注尚未保存，切换后将丢弃这段输入。继续切换？")) return;
      if (!await resolvePendingEditor()) return;
      note.value = "";
      activeId = Number(button.dataset.chapter);
      renderTree(); renderChapter();
    });
  }
  function updateTreeLanguage() {
    const tree = document.getElementById("chapter-tree");
    const active = tree.querySelector(`[data-chapter="${activeId}"]`);
    const viewport = tree.getBoundingClientRect();
    const activeBounds = active?.getBoundingClientRect();
    const activeIsVisible = activeBounds && activeBounds.bottom > viewport.top && activeBounds.top < viewport.bottom;
    const previousTop = activeBounds?.top;
    tree.querySelectorAll("[data-chapter]").forEach(button => {
      const chapter = chaptersById.get(Number(button.dataset.chapter));
      button.textContent = treeLabel(chapter);
    });
    if (activeIsVisible) tree.scrollTop += active.getBoundingClientRect().top - previousTop;
  }
  function richText(value) {
    const formulas = [];
    const withMathSlots = value.replace(/\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g, (_match, block, inline) => {
      const display = block !== undefined;
      const index = formulas.push({ tex: display ? block : inline, display }) - 1;
      return `<span class="math-slot" data-index="${index}"></span>`;
    });
    return { html: DOMPurify.sanitize(marked.parse(withMathSlots, { gfm: true, breaks: true }),
      { FORBID_TAGS: ["img", "iframe", "script", "style", "svg"] }), formulas };
  }
  function renderMath(root, formulas) {
    root.querySelectorAll(".math-slot").forEach(slot => {
      const formula = formulas[Number(slot.dataset.index)];
      katex.render(formula.tex, slot, { displayMode: formula.display, throwOnError: false, trust: false });
    });
  }
  function renderChapter({ preserveScroll = false, preserveNotes = false } = {}) {
    const c = data.chapters.find(chapter => chapter.id === activeId);
    if (!c) return;
    const content = contentOf(c);
    const rendered = content ? richText(content) : null;
    const illustrations = data.illustrations.filter(image => image.chapter_id === c.id);
    const imageHtml = illustrations.map((image, index) => {
      const url = `/api/drafts/${id}/chapters/${c.id}/illustrations/${image.id}`;
      return `<button type="button" class="illustration-thumb" data-image="${image.id}" aria-label="放大查看附图 ${index + 1}"><img src="${url}" alt="${esc(c.illustration || `${displayNo(c)} 附图 ${index + 1}`)}" loading="lazy"><span>点击放大</span></button>`;
    }).join("");
    const illustrationHtml = c.illustration || imageHtml
      ? `<section class="chapter-illustrations"><h3>${language === "cn" ? "附图" : "Illustrations"}</h3>${c.illustration ? `<p>${esc(c.illustration)}</p>` : ""}<div class="illustration-grid">${imageHtml}</div></section>` : "";
    const paper = document.getElementById("chapter-paper");
    const previousScroll = paper.scrollTop;
    paper.innerHTML = `<div class="small text-muted">${esc(data.std_no)} · ${language === "cn" ? "来源第" : "Source page"} ${dash(c.source_page)} ${language === "cn" ? "页" : ""}</div><h2>${esc(displayNo(c))} ${esc(titleOf(c))}</h2><div>${tag(c.clause_type, "info")}</div><div class="chapter-text rich-content">${rendered ? rendered.html : `<span class="text-muted">${language === "cn" ? "原文件未提供正文。" : "No text in the source file."}</span>`}</div>${illustrationHtml}`;
    if (rendered) renderMath(paper, rendered.formulas);
    paper.querySelectorAll("[data-image]").forEach(button => button.onclick = () => {
      const imageId = Number(button.dataset.image);
      const image = illustrations.find(item => item.id === imageId);
      const viewer = document.getElementById("illustration-viewer");
      const large = document.getElementById("illustration-large");
      large.src = `/api/drafts/${id}/chapters/${c.id}/illustrations/${image.id}`;
      large.alt = c.illustration || `${displayNo(c)} 附图`;
      document.getElementById("illustration-caption").textContent = c.illustration || displayNo(c);
      viewer.showModal();
    });
    paper.scrollTop = preserveScroll ? previousScroll : 0;
    document.getElementById("annotation-clause").textContent = displayNo(c);
    if (preserveNotes) return;
    const notes = data.annotations.filter(a => a.chapter_id === c.id);
    document.getElementById("chapter-annotations").innerHTML = notes.map(annotation).join("") || '<p class="text-muted small">此章节还没有批注。</p>';
    document.getElementById("chapter-form").hidden = notes.length > 0;
    bindAnnotationEditors(document.getElementById("chapter-annotations"));
    document.getElementById("chapter-annotations").scrollTop = 0;
  }
  async function load() {
    data = await get(`/api/drafts/${id}`);
    chaptersById = new Map(data.chapters.map(chapter => [chapter.id, chapter]));
    chaptersByNo = new Map(data.chapters.map(chapter => [chapter.clause_no, chapter]));
    childrenByNo = new Map();
    for (const chapter of data.chapters) {
      if (!chapter.parent_clause_no) continue;
      if (!childrenByNo.has(chapter.parent_clause_no)) childrenByNo.set(chapter.parent_clause_no, []);
      childrenByNo.get(chapter.parent_clause_no).push(chapter);
    }
    if (!collapsed.size) {
      for (const chapter of data.chapters) {
        if (childrenByNo.has(chapter.clause_no) && !chapter.title_cn?.trim() && !chapter.title_en?.trim()) {
          collapsed.add(chapter.id);
        }
      }
    }
    document.getElementById("draft-heading").textContent = `${data.version_name} · ${data.sub_version_no}`;
    document.title = `${data.version_name} · ${data.std_no} · 法规跟踪系统`;
    document.getElementById("draft-context").textContent = `${data.std_no} · ${data.name_cn}`;
    document.getElementById("chapter-count").textContent = data.chapters.length;
    const latest = data.imports[0];
    const fields = [["所属标准", `${data.std_no} · ${data.name_cn}`], ["草案版本", `${data.version_name} · ${data.sub_version_no}`], ["草案日期", data.draft_date], ["发布方", data.issued_by], ["总体影响", data.overall_impact], ["主要内容", data.main_summary], ["原文位置", data.file_link], ["备注", data.notes], ["来源文件", latest?.filename], ["文件中的标准", latest ? `${latest.source_standard_no} · ${latest.source_standard_name}` : ""], ["来源版本文字", latest?.source_version], ["最近导入", latest ? `${latest.created_at} · ${latest.created_by}` : "尚未导入"]];
    document.getElementById("draft-metadata").innerHTML = fields.map(([key, value]) => `<dt>${key}</dt><dd style="white-space:pre-wrap;overflow-wrap:anywhere">${dash(value)}</dd>`).join("");
    document.getElementById("whole-annotations").innerHTML = data.annotations.filter(a => !a.chapter_id).map(annotation).join("") || '<p class="text-muted">还没有整份草案批注。</p>';
    bindAnnotationEditors(document.getElementById("whole-annotations"));
    document.getElementById("reader-empty").hidden = !!data.chapters.length;
    document.getElementById("reader-workspace").hidden = !data.chapters.length;
    if (!data.chapters.some(c => c.id === activeId)) activeId = data.chapters[0]?.id;
    renderTree(); renderChapter();
  }
  document.getElementById("chapter-search").oninput = renderTree;
  document.querySelectorAll("[data-language]").forEach(button => {
    button.onclick = () => {
      if (language === button.dataset.language) return;
      language = button.dataset.language;
      localStorage.setItem("regtrack.reader.language", language);
      document.querySelectorAll("[data-language]").forEach(option => {
        const active = option.dataset.language === language;
        option.classList.toggle("active", active);
        option.setAttribute("aria-pressed", String(active));
      });
      updateTreeLanguage();
      renderChapter({ preserveScroll: true, preserveNotes: true });
    };
    const active = button.dataset.language === language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.getElementById("close-illustration").onclick = () => document.getElementById("illustration-viewer").close();
  for (const [formId, input, chapter] of [["whole-form", whole, false], ["chapter-form", note, true]]) {
    document.getElementById(formId).onsubmit = async e => {
      e.preventDefault(); const button = e.currentTarget.querySelector("button"); button.disabled = true;
      try { await post(`/api/drafts/${id}/annotations`, { content: input.value, chapter_id: chapter ? activeId : null }); input.value = ""; await load(); ok("批注已保存"); }
      catch (e) { fail(e.message); } finally { button.disabled = false; }
    };
  }
  document.getElementById("edit-draft").onclick = () => Records.draftForm(data, { onChanged: load });
  try { await load(); showView(location.hash.slice(1) === "reader" ? "reader" : "overview"); }
  catch (e) { document.getElementById("draft-error").textContent = e.message; document.getElementById("edit-draft").disabled = true; }
});
