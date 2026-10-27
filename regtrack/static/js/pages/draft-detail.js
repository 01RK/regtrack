App.ready(async () => {
  const { get, post, put, del, esc, dash, tag, fail, ok, confirmAsync, t, label } = App;
  const id = Number(document.getElementById("draft-page").dataset.id);
  const whole = document.getElementById("whole-content"), note = document.getElementById("chapter-content");
  const typeOptions = selected => App.meta.annotation_types.map(type =>
    `<option value="${type}" ${type === selected ? "selected" : ""}>${type}</option>`).join("");
  for (const scope of ["whole", "chapter"]) {
    document.getElementById(`${scope}-type`).innerHTML = typeOptions("Proposed Change");
  }
  let data, activeId = null;
  let language = localStorage.getItem("regtrack.reader.language") === "en" ? "en" : "cn";
  const collapsedKey = `regtrack.draft-tree-collapsed:${id}`;
  const savedCollapsed = sessionStorage.getItem(collapsedKey);
  let collapsed = new Set(JSON.parse(savedCollapsed || "[]").map(Number));
  const saveCollapsed = () => sessionStorage.setItem(collapsedKey, JSON.stringify([...collapsed]));
  let chaptersById = new Map();
  let chaptersByNo = new Map();
  let childrenByNo = new Map();
  async function showView(view) {
    const previous = document.querySelector(".draft-view-tabs button.active")?.dataset.view;
    if (previous !== view) {
      const pending = previous === "reader" ? note : whole;
      if (pending.value.trim() && !await confirmAsync(t("批注尚未保存，切换后将丢弃这段输入。继续切换？", "The annotation has not been saved. Switching will discard it. Continue?"))) return;
      if (!await resolvePendingEditor()) return;
      pending.value = "";
    }
    document.querySelectorAll("[data-view]").forEach(b => { const active = b.dataset.view === view; b.classList.toggle("active", active); b.setAttribute("aria-selected", String(active)); });
    ["overview", "reader"].forEach(v => { document.getElementById(`view-${v}`).hidden = v !== view; });
    history.replaceState(null, "", `#${view}`);
  }
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => showView(b.dataset.view));
  window.addEventListener("beforeunload", e => { if (whole.value.trim() || note.value.trim() || dirtyEditor()) { e.preventDefault(); e.returnValue = ""; } });
  const followUpToggle = (inputAttrs, checked) => `<span class="follow-up-field"><label class="follow-up-toggle">
      <input class="form-check-input" type="checkbox" ${inputAttrs} ${checked ? "checked" : ""}><span>${label("Follow-up required", "需要后续跟进")}</span></label>${App.followUpInfo()}</span>`;
  const annotation = a => `<article class="annotation-card" data-annotation-id="${a.id}">
    <div data-annotation-readonly>
      <div class="annotation-head"><span class="annotation-author">${esc(a.created_by)}</span><time datetime="${esc(a.created_at.replace(" ", "T"))}">${esc(a.created_at.slice(0, 16))}</time></div>
      <div class="annotation-meta"><span class="annotation-type" data-type="${esc(a.annotation_type)}">${esc(a.annotation_type)}</span>${a.needs_follow_up ? `<span class="annotation-flag">${window.App.uiText("需跟进", "Follow-up")}</span>` : ""}</div>
      <p class="annotation-text">${esc(a.content)}</p>
      <div class="annotation-footer">
        <details class="annotation-history"><summary>${t("记录信息", "Record info")}</summary><div>${t("创建：", "Created: ")}${esc(a.created_at)} · ${esc(a.created_by)}<br>${t("修改：", "Updated: ")}${esc(a.updated_at)} · ${esc(a.updated_by)}</div></details>
        <div class="annotation-actions">
          <button type="button" class="annotation-action" data-annotation-formal>${window.App.uiText("查看意见", "View opinion")}</button>
          <button type="button" class="annotation-action" data-annotation-edit>${window.App.uiText("编辑", "Edit")}</button>
          ${a.created_by === (App.user || "未署名") ? `<button type="button" class="annotation-action danger" data-annotation-delete>${window.App.uiText("删除", "Delete")}</button>` : ""}
        </div>
      </div>
    </div>
    <form class="annotation-editor" data-annotation-editor hidden>
      <div class="annotation-editor-head"><span>${window.App.uiText("编辑批注", "Edit annotation")}</span><span class="annotation-editor-context">${esc(a.created_by)}</span></div>
      <div class="annotation-type-field"><label for="annotation-type-${a.id}">${label("Type", "类型")}</label><select id="annotation-type-${a.id}" class="form-select form-select-sm" required>${typeOptions(a.annotation_type)}</select></div>
      <textarea class="form-control annotation-input" aria-label="${t("批注内容", "Annotation text")}" required>${esc(a.content)}</textarea>
      <div class="annotation-compose-footer">${followUpToggle("data-follow-up", a.needs_follow_up)}<div class="annotation-edit-actions"><button type="button" class="annotation-cancel" data-annotation-cancel>${window.App.uiText("取消", "Cancel")}</button><button type="submit" class="btn btn-primary btn-sm" disabled>${window.App.uiText("保存修改", "Save changes")}</button></div></div>
    </form>
  </article>`;
  function dirtyEditor() {
    return [...document.querySelectorAll("[data-annotation-editor]:not([hidden])")].find(editor => {
      const saved = data?.annotations.find(a => String(a.id) === editor.closest("[data-annotation-id]").dataset.annotationId);
      return saved && (editor.querySelector("textarea").value.trim() !== saved.content
        || editor.querySelector("select").value !== saved.annotation_type
        || Number(editor.querySelector("[data-follow-up]").checked) !== saved.needs_follow_up);
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
        title: t("批注尚未保存", "Unsaved annotation"), size: "sm",
        body: t("这条批注已有未保存的修改。请先决定如何处理。", "This annotation has unsaved changes. Choose what to do first."),
        footer: `<button class="btn btn-outline-secondary btn-sm" data-stay>${window.App.uiText("继续编辑", "Keep editing")}</button><button class="btn btn-outline-danger btn-sm" data-discard>${window.App.uiText("放弃修改", "Discard")}</button><button class="btn btn-primary btn-sm" data-save>${window.App.uiText("保存并继续", "Save and continue")}</button>`,
        onHidden: () => { if (!chosen) resolve(false); },
      });
      modal.footer.querySelector("[data-stay]").onclick = async () => { chosen = true; await modal.close(); resolve(false); };
      modal.footer.querySelector("[data-discard]").onclick = async () => {
        chosen = true;
        const saved = data.annotations.find(a => String(a.id) === card.dataset.annotationId);
        editor.querySelector("textarea").value = saved.content;
        editor.querySelector("select").value = saved.annotation_type;
        editor.querySelector("[data-follow-up]").checked = !!saved.needs_follow_up;
        editor.hidden = true; card.classList.remove("is-editing"); card.querySelector("[data-annotation-readonly]").hidden = false;
        await modal.close(); resolve(true);
      };
      modal.footer.querySelector("[data-save]").onclick = async e => {
        e.currentTarget.disabled = true;
        try {
          const saved = await put(`/api/drafts/${id}/annotations/${card.dataset.annotationId}`, { content: editor.querySelector("textarea").value, annotation_type: editor.querySelector("select").value, needs_follow_up: editor.querySelector("[data-follow-up]").checked });
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
      card.querySelector("[data-annotation-formal]").onclick = async () => {
        try {
          if (!await resolvePendingEditor()) return;
          Records.open("comment", data.annotations.find(a => String(a.id) === card.dataset.annotationId).formal_comment_id);
        } catch (error) {fail(error.message);}
      };
      const readonly = card.querySelector("[data-annotation-readonly]"), editor = card.querySelector("[data-annotation-editor]");
      const input = editor.querySelector("textarea"), select = editor.querySelector("select");
      const save = editor.querySelector("button[type=submit]");
      function updateEditor() {
        const saved = data.annotations.find(a => String(a.id) === card.dataset.annotationId);
        save.disabled = !input.value.trim() || (input.value.trim() === saved.content && select.value === saved.annotation_type && Number(editor.querySelector("[data-follow-up]").checked) === saved.needs_follow_up);
        input.style.height = "auto";
        input.style.height = `${Math.min(280, Math.max(120, input.scrollHeight))}px`;
      }
      input.oninput = updateEditor; select.onchange = updateEditor; editor.querySelector("[data-follow-up]").onchange = updateEditor;
      card.querySelector("[data-annotation-edit]").onclick = async () => {
        if (!await resolvePendingEditor()) return;
        document.querySelectorAll("[data-annotation-editor]:not([hidden])").forEach(open => {
          open.querySelector("[data-annotation-cancel]").click();
        });
        readonly.hidden = true; editor.hidden = false; card.classList.add("is-editing");
        updateEditor(); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
      };
      card.querySelector("[data-annotation-cancel]").onclick = () => {
        const saved = data.annotations.find(a => String(a.id) === card.dataset.annotationId);
        editor.querySelector("textarea").value = saved.content;
        editor.querySelector("select").value = saved.annotation_type;
        editor.querySelector("[data-follow-up]").checked = !!saved.needs_follow_up;
        editor.hidden = true; readonly.hidden = false; card.classList.remove("is-editing");
        card.querySelector("[data-annotation-edit]").focus();
      };
      const remove = card.querySelector("[data-annotation-delete]");
      if (remove) remove.onclick = async () => {
        if (!await confirmAsync(t("确定删除这条批注？删除后无法恢复。", "Delete this annotation? This cannot be undone."))) return;
        remove.disabled = true;
        try {
          await del(`/api/drafts/${id}/annotations/${card.dataset.annotationId}`);
          data.annotations = data.annotations.filter(a => String(a.id) !== card.dataset.annotationId);
          card.remove();
          renderCounts();
          ok(t("批注已删除", "Annotation deleted"));
        } catch (err) { fail(err.message); remove.disabled = false; }
      };
      editor.onsubmit = async e => {
        e.preventDefault(); const button = editor.querySelector("button[type=submit],button:not([type])"); button.disabled = true;
        try {
          const saved = await put(`/api/drafts/${id}/annotations/${card.dataset.annotationId}`, { content: editor.querySelector("textarea").value, annotation_type: editor.querySelector("select").value, needs_follow_up: editor.querySelector("[data-follow-up]").checked });
          const item = data.annotations.find(a => a.id === saved.id);
          Object.assign(item, saved);
          refreshAnnotationCard(card, item); ok(t("批注已更新", "Annotation updated"));
        }
        catch (e) { fail(e.message); } finally { updateEditor(); }
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
        ? `<button type="button" class="tree-toggle" data-tree-toggle="${c.id}" aria-label="${expanded ? t("收起", "Collapse") : t("展开", "Expand")} ${esc(displayNo(c))}" aria-expanded="${expanded}" ${query ? "disabled" : ""}><span class="tree-chevron" aria-hidden="true"></span></button>`
        : '<span class="tree-spacer"></span>';
      return `<div class="tree-row" style="padding-left:${Math.min(c.level - 1, 8) * 15}px">${toggle}<button type="button" data-chapter="${c.id}" class="tree-entry ${c.id === activeId ? "active" : ""}" aria-current="${c.id === activeId}">${esc(treeLabel(c))}</button></div>`;
    }).join("") || `<p class="text-muted p-2">${t("没有匹配章节", "No matching chapters")}</p>`;
    document.querySelectorAll("[data-tree-toggle]").forEach(button => button.onclick = () => {
      const chapterId = Number(button.dataset.treeToggle);
      if (collapsed.has(chapterId)) collapsed.delete(chapterId); else collapsed.add(chapterId);
      saveCollapsed();
      renderTree();
    });
    document.querySelectorAll("[data-chapter]").forEach(button => button.onclick = async () => {
      if (Number(button.dataset.chapter) === activeId) return;
      if (note.value.trim() && !await confirmAsync(t("当前章节批注尚未保存，切换后将丢弃这段输入。继续切换？", "The chapter annotation has not been saved. Switching will discard it. Continue?"))) return;
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
  function renderChapter({ preserveScroll = false, preserveNotes = false } = {}) {
    const c = data.chapters.find(chapter => chapter.id === activeId);
    if (!c) return;
    const content = contentOf(c);
    const rendered = content ? RichText.render(content) : null;
    const illustrations = data.illustrations.filter(image => image.chapter_id === c.id);
    const imageHtml = illustrations.map((image, index) => {
      return `<button type="button" class="illustration-thumb" data-image="${image.id}" aria-label="${t("放大查看附图", "Enlarge illustration")} ${index + 1}"><img src="${esc(image.url)}" alt="${esc(c.illustration || `${displayNo(c)} ${t("附图", "Illustration")} ${index + 1}`)}" loading="lazy"><span>${window.App.uiText("点击放大", "Click to enlarge")}</span></button>`;
    }).join("");
    const illustrationHtml = c.illustration || imageHtml
      ? `<section class="chapter-illustrations"><h3>${language === "cn" ? "附图" : "Illustrations"}</h3>${c.illustration ? `<p>${esc(c.illustration)}</p>` : ""}<div class="illustration-grid">${imageHtml}</div></section>` : "";
    const paper = document.getElementById("chapter-paper");
    const previousScroll = paper.scrollTop;
    paper.innerHTML = `<div class="small text-muted">${esc(data.std_no)} · ${language === "cn" ? "来源第" : "Source page"} ${dash(c.source_page)} ${language === "cn" ? "页" : ""}</div><h2>${esc(displayNo(c))} ${esc(titleOf(c))}</h2><div>${tag(c.clause_type, "info")}</div><div class="chapter-text rich-content">${rendered ? rendered.html : `<span class="text-muted">${language === "cn" ? "原文件未提供正文。" : "No text in the source file."}</span>`}</div>${illustrationHtml}`;
    if (rendered) RichText.mount(paper, rendered.formulas);
    paper.querySelectorAll("[data-image]").forEach(button => button.onclick = () => {
      const imageId = Number(button.dataset.image);
      const image = illustrations.find(item => item.id === imageId);
      const viewer = document.getElementById("illustration-viewer");
      const large = document.getElementById("illustration-large");
      large.src = image.url;
      large.alt = c.illustration || `${displayNo(c)} ${t("附图", "Illustration")}`;
      document.getElementById("illustration-caption").textContent = c.illustration || displayNo(c);
      viewer.showModal();
    });
    paper.scrollTop = preserveScroll ? previousScroll : 0;
    if (preserveNotes) return;
    const notes = data.annotations.filter(a => a.chapter_id === c.id);
    document.getElementById("chapter-annotations").innerHTML = notes.map(annotation).join("");
    bindAnnotationEditors(document.getElementById("chapter-annotations"));
    renderCounts();
    document.getElementById("chapter-notes-scroll").scrollTop = 0;
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
    if (savedCollapsed === null) {
      for (const chapter of data.chapters) {
        if (childrenByNo.has(chapter.clause_no) && !chapter.title_cn?.trim() && !chapter.title_en?.trim()) {
          collapsed.add(chapter.id);
        }
      }
      saveCollapsed();
    }
    document.getElementById("draft-heading").textContent = `${data.version_name} · ${data.sub_version_no}`;
    document.title = `${data.version_name} · ${data.std_no} · ${t("法规跟踪系统", "Regulation Tracking")}`;
    document.getElementById("draft-context").textContent = `${data.std_no} · ${data.name_cn}`;
    document.getElementById("chapter-count").textContent = data.chapters.length;
    const latest = data.imports[0];
    metadataEditor = InlineEdit.mount({
      host: document.getElementById("draft-metadata"),
      title: t("草案元数据", "Draft metadata"),
      spec: Records.draftSpec().map(f => f.name === "standard_id" ? Object.assign({}, f, { view: d => `${d.std_no || ""} · ${d.name_cn}` }) : f),
      values: data,
      extra: [["Source File", "来源文件", latest?.filename],
              ["Standard in File", "文件中的标准", latest ? `${latest.source_standard_no} · ${latest.source_standard_name}` : ""],
              ["Source Version Text", "来源版本文字", latest?.source_version],
              ["Last Import", "最近导入", latest ? `${latest.created_at} · ${latest.created_by}` : t("尚未导入", "Not imported yet")]],
      async save(payload) {
        await put(`/api/drafts/${id}`, payload);
        await App.refreshLookups();
        await load();
      },
    });
    document.getElementById("whole-annotations").innerHTML = data.annotations.filter(a => !a.chapter_id).map(annotation).join("");
    bindAnnotationEditors(document.getElementById("whole-annotations"));
    renderCounts();
    document.getElementById("reader-empty").hidden = !!data.chapters.length;
    document.getElementById("reader-workspace").hidden = !data.chapters.length;
    if (!data.chapters.some(c => c.id === activeId)) activeId = data.chapters[0]?.id;
    renderTree(); renderChapter();
  }
  /** 计数与空状态：列表为空时显示提示，标题旁显示条数。 */
  function renderCounts() {
    for (const [list, count] of [["whole-annotations", "whole-count"], ["chapter-annotations", "chapter-count-notes"]]) {
      const host = document.getElementById(list);
      const cards = host.querySelectorAll("[data-annotation-id]").length;
      host.querySelector(".annotation-empty")?.remove();
      if (!cards) host.insertAdjacentHTML("beforeend", `<p class="annotation-empty">${list === "whole-annotations"
        ? t("还没有整份草案批注。", "No whole-draft annotations yet.") : t("此章节还没有批注。", "No annotations on this chapter yet.")}</p>`);
      document.getElementById(count).textContent = cards ? t(`${cards} 条`, String(cards)) : "";
    }
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
      e.preventDefault(); const button = e.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
      try {
        if (!await resolvePendingEditor()) return;
        await post(`/api/drafts/${id}/annotations`, { content: input.value, chapter_id: chapter ? activeId : null,
          annotation_type: document.getElementById(chapter ? "chapter-type" : "whole-type").value,
          needs_follow_up: document.getElementById(chapter ? "chapter-follow-up" : "whole-follow-up").checked });
        input.value = ""; document.getElementById(chapter ? "chapter-follow-up" : "whole-follow-up").checked = true; await load(); ok(t("批注已保存", "Annotation saved"));
      }
      catch (e) { fail(e.message); } finally { button.disabled = false; }
    };
  }
  document.getElementById("edit-draft").onclick = () => metadataEditor.edit();
  /** 删除草案：先列出将一并删除的章节、附图、批注和意见，确认后删除并返回来源页。 */
  document.getElementById("delete-draft").onclick = async () => {
    try {
      const scope = await get(`/api/drafts/${id}/deletion`);
      if (scope.comparisons) {
        fail(t(`这份草案已用于 ${scope.comparisons} 组标准比对，请先在比对结果页删除比对，再删除草案。`,
               `This draft is used by ${scope.comparisons} comparison(s). Delete those comparisons first.`));
        return;
      }
      const name = `${data.std_no || data.name_cn} ${data.version_name} v${data.sub_version_no}`;
      const yes = await confirmAsync(t(
        `永久删除草案「${name}」？将一并删除：${scope.chapters} 个原文章节、${scope.images} 张附图文件、${scope.annotations} 条批注、${scope.comments} 条相关意见（含状态历史）。${scope.actions ? `${scope.actions} 个关联事项会保留，但不再关联这份草案。` : ""}此操作无法撤销。`,
        `Delete draft "${name}" permanently? This also deletes ${scope.chapters} source chapter(s), ${scope.images} figure file(s), ${scope.annotations} annotation(s) and ${scope.comments} related opinion(s) with their status history.${scope.actions ? ` ${scope.actions} linked action(s) are kept but no longer linked to this draft.` : ""} This cannot be undone.`));
      if (!yes) return;
      await del(`/api/drafts/${id}`);
      ok(t("草案已删除", "Draft deleted"));
      App.goBack("/drafts");
    } catch (e) { fail(e.message); }
  };
  let metadataEditor;
  try {
    await load();
    showView(location.hash.slice(1) === "reader" ? "reader" : "overview");
    await Records.restore({ onChanged: load });
  } catch (e) {
    document.getElementById("draft-error").textContent = e.message;
    document.getElementById("edit-draft").disabled = true;
    document.getElementById("delete-draft").disabled = true;
  }
});
