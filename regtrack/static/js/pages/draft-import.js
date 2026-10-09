App.ready(async () => {
  const { api, get, esc, confirmAsync } = App;
  const file = document.getElementById("chapter-file");
  const prompt = document.getElementById("import-prompt");
  const promptMessage = document.getElementById("prompt-message");
  const manualImport = document.getElementById("manual-import");
  const manualButton = document.getElementById("manual-import-button");
  const sourceButton = document.getElementById("source-upload");
  sourceButton.onclick = () => {
    manualImport.hidden = true;
    manualButton.classList.remove("active");
    manualButton.setAttribute("aria-expanded", "false");
    document.getElementById("assignment").hidden = true;
    sourceButton.classList.add("active");
    document.getElementById("source-upload-message").textContent = "接口暂未接通，请使用手动导入。";
  };
  manualButton.onclick = () => {
    manualImport.hidden = false;
    manualButton.classList.add("active");
    manualButton.setAttribute("aria-expanded", "true");
    sourceButton.classList.remove("active");
    if (loadedFile) document.getElementById("assignment").hidden = false;
    document.getElementById("source-upload-message").textContent = "";
  };
  fetch("/static/single-draft-chapters-prompt.txt?v=20261001-preface-zero").then(response => {
    if (!response.ok) throw new Error("提示词读取失败");
    return response.text();
  }).then(text => { prompt.value = text.trim(); }).catch(e => { prompt.value = ""; promptMessage.textContent = e.message; });
  document.getElementById("copy-import-prompt").onclick = async () => {
    if (!prompt.value) { promptMessage.textContent = "提示词尚未加载，请稍后再试。"; return; }
    try { await navigator.clipboard.writeText(prompt.value); promptMessage.textContent = "提示词已复制，可以粘贴到 Web 端大模型。"; }
    catch (e) { prompt.select(); promptMessage.textContent = "浏览器未允许自动复制，已选中提示词，请按 Ctrl+C。"; }
  };
  const standard = document.getElementById("import-standard");
  let standardPicker = null;
  const draft = document.getElementById("import-draft");
  const newVersion = document.getElementById("new-version");
  const submit = document.getElementById("assign-submit");
  const message = document.getElementById("upload-message");
  const error = document.getElementById("assignment-error");
  const decisions = document.getElementById("annotation-decisions");
  const conflictStep = document.getElementById("conflict-step");
  const residualStep = document.getElementById("residual-step");
  let loadedFile = null;
  let chapterNos = new Set();
  let incomingComments = {};
  let currentDraft = null;
  let conflictIds = [];
  let residualIds = [];
  let removedWithChapter = 0;
  let deletedComments = [];
  document.getElementById("version-name").innerHTML = '<option value="">请选择</option>' + App.meta.version_names.map(v => `<option>${esc(v)}</option>`).join("");
  function versionChanged() { newVersion.hidden = draft.value !== "new"; newVersion.disabled = newVersion.hidden; }
  async function loadVersions() {
    const options = await get("/api/drafts/options", { standard_id: standard.value });
    draft.innerHTML = '<option value="">请选择归属版本</option>' + options.map(v => `<option value="${v.id}">${esc(v.version_name)} · ${esc(v.sub_version_no)} · ${esc(v.draft_date)}</option>`).join("") + '<option value="new">＋ 新增草案版本</option>';
    const selected = new URLSearchParams(location.search).get("draft_id");
    if (options.some(v => String(v.id) === selected)) draft.value = selected;
    versionChanged();
    await loadDecisions();
  }
  async function loadDecisions() {
    decisions.hidden = true;
    conflictStep.hidden = true;
    residualStep.hidden = true;
    currentDraft = null;
    conflictIds = [];
    residualIds = [];
    removedWithChapter = 0;
    deletedComments = [];
    submit.hidden = true;
    document.getElementById("conflict-list").innerHTML = "";
    document.getElementById("annotation-retention-list").innerHTML = "";
    if (!draft.value || draft.value === "new") { submit.hidden = false; return; }
    const selectedId = draft.value;
    const selectedDraft = await get(`/api/drafts/${Number(selectedId)}`);
    if (draft.value !== selectedId) return;
    currentDraft = selectedDraft;
    if (!currentDraft.imports.length) { submit.hidden = false; return; }
    const annotations = currentDraft.annotations.filter(a => a.chapter_id != null);
    const conflicts = annotations.filter(a => chapterNos.has(a.clause_no) && incomingComments[a.clause_no] && incomingComments[a.clause_no] !== a.content.trim());
    const residuals = annotations.filter(a => chapterNos.has(a.clause_no) && !incomingComments[a.clause_no]);
    const unmatched = annotations.filter(a => !chapterNos.has(a.clause_no));
    conflictIds = conflicts.map(a => a.id);
    residualIds = residuals.map(a => a.id);
    removedWithChapter = unmatched.length;
    deletedComments = currentDraft.linked_comments.filter(c => c.clause_no && !chapterNos.has(c.clause_no.trim()));
    document.getElementById("conflict-list").innerHTML = conflicts.map(a => `<label class="decision-item">
      <span class="decision-title"><input type="checkbox" value="${a.id}"> <strong>${esc(a.clause_no)} ${esc(a.title_cn || "")}</strong> · 使用新导入批注</span>
      <span class="decision-pair"><span><small>现有批注 · ${esc(a.annotation_type)}</small><p>${esc(a.content)}</p></span><span><small>新导入批注 · Comment</small><p>${esc(incomingComments[a.clause_no])}</p></span></span>
    </label>`).join("");
    document.getElementById("annotation-retention-list").innerHTML = residuals.map(a => `<label class="decision-item"><span class="decision-title"><input type="checkbox" value="${a.id}" checked> <strong>${esc(a.clause_no)} ${esc(a.title_cn || "")}</strong> · 保留现有批注 · ${esc(a.annotation_type)}</span><p>${esc(a.content)}</p></label>`).join("") + unmatched.map(a => `<div class="decision-item unmatched"><strong>${esc(a.clause_no)} ${esc(a.title_cn || "")}</strong><small>${esc(a.annotation_type)} · 新文件没有此条款，批注将移除</small><p>${esc(a.content)}</p></div>`).join("") + (!residuals.length && !unmatched.length ? '<p class="form-text">没有需要选择的残留批注。</p>' : "");
    document.getElementById("back-conflicts").hidden = !conflicts.length;
    decisions.hidden = !conflicts.length && !residuals.length && !unmatched.length;
    conflictStep.hidden = !conflicts.length;
    residualStep.hidden = !!conflicts.length;
    submit.hidden = !!conflicts.length;
  }
  async function read() {
    loadedFile = null;
    document.getElementById("assignment").hidden = true;
    if (!file.files.length) return;
    file.disabled = true;
    message.textContent = "正在读取文件…";
    error.textContent = "";
    try {
      const selected = file.files[0];
      const form = new FormData(); form.append("file", selected);
      const data = await api("/api/drafts/imports/read", { method: "POST", body: form });
      chapterNos = new Set(data.chapter_nos);
      incomingComments = data.incoming_comments;
      document.getElementById("file-identity").innerHTML = `<span class="tag info">文件中的信息</span><h2>${esc(data.standard_no)} · ${esc(data.standard_name)}</h2><p>来源版本：${esc(data.source_version)}</p><small>${esc(selected.name)}</small>`;
      if (standardPicker) standardPicker.destroy();
      standard.innerHTML = "";
      standardPicker = Fields.standard(standard, {
        preload: data.standards,
        quickCreatePrefill: { std_no: data.standard_no, name_cn: data.standard_name },
        onChange: () => loadVersions().catch(e => { error.textContent = e.message; }),
      });
      submit.disabled = false;
      await loadVersions();
      loadedFile = selected;
      document.getElementById("assignment").hidden = false;
      message.textContent = "文件已读取，请确认草案归属。";
    } catch (e) { message.textContent = e.message; }
    finally { file.disabled = false; }
  }
  file.onchange = read;
  draft.onchange = () => { versionChanged(); loadDecisions().catch(e => { error.textContent = e.message; }); };
  document.getElementById("confirm-conflicts").onclick = () => {
    conflictStep.hidden = true; residualStep.hidden = false; submit.hidden = false;
    residualStep.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  document.getElementById("back-conflicts").onclick = () => {
    residualStep.hidden = true; conflictStep.hidden = false; submit.hidden = true;
    conflictStep.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  document.getElementById("keep-all").onclick = () => document.querySelectorAll("#annotation-retention-list input[type=checkbox]:not(:disabled)").forEach(box => { box.checked = true; });
  document.getElementById("keep-none").onclick = () => document.querySelectorAll("#annotation-retention-list input[type=checkbox]").forEach(box => { box.checked = false; });
  document.getElementById("assignment-form").onsubmit = async e => {
    e.preventDefault();
    submit.disabled = true; file.disabled = true; error.textContent = "";
    try {
      const target = { standard_id: Number(standard.value) };
      if (draft.value === "new") {
        Object.assign(target, { version_name: document.getElementById("version-name").value,
          sub_version_no: document.getElementById("sub-version").value, draft_date: document.getElementById("draft-date").value });
      } else {
        target.draft_id = Number(draft.value);
        const current = currentDraft;
        if (current.imports.length) {
          target.keep_annotation_ids = [...document.querySelectorAll("#annotation-retention-list input[type=checkbox]:checked")].map(box => Number(box.value));
          target.replace_annotation_ids = [...document.querySelectorAll("#conflict-list input[type=checkbox]:checked")].map(box => Number(box.value));
          target.annotation_snapshot = Object.fromEntries(current.annotations.filter(a => a.chapter_id != null)
            .map(a => [a.id, { content: a.content, annotation_type: a.annotation_type, updated_at: a.updated_at }]));
          target.comment_snapshot = current.linked_comments;
          const removed = residualIds.length - target.keep_annotation_ids.length + removedWithChapter + target.replace_annotation_ids.length;
          const commentNumbers = deletedComments.slice(0, 5).map(c => c.comment_no).join("、");
          const commentWarning = deletedComments.length ? `另有 ${deletedComments.length} 条正式意见（${commentNumbers}${deletedComments.length > 5 ? "等" : ""}）因条款编号不再存在，将连同状态记录删除。` : "";
          if (!await confirmAsync(`确认整体替换当前章节？${conflictIds.length} 条冲突批注中，${target.replace_annotation_ids.length} 条改用新导入内容，${conflictIds.length - target.replace_annotation_ids.length} 条沿用现有内容；${target.keep_annotation_ids.length} 条残留批注继续保留，${removed} 条旧批注移除。${commentWarning}`)) return;
          target.replace_import_id = current.imports[0].id;
        }
      }
      const form = new FormData(); form.append("file", loadedFile); form.append("target", JSON.stringify(target));
      const result = await api("/api/drafts/imports", { method: "POST", body: form });
      location.href = `/drafts/${result.draft_id}#reader`;
    } catch (e) {
      if (e.status === 409 && draft.value !== "new") {
        try {
          await loadDecisions();
          error.textContent = `${e.message} 选择已刷新，请重新核对。`;
        } catch (refreshError) {
          error.textContent = `${e.message} 刷新选择失败：${refreshError.message}`;
        }
      } else error.textContent = e.message;
    }
    finally { submit.disabled = false; file.disabled = false; }
  };
});
