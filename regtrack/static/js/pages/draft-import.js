App.ready(async () => {
  const { api, get, esc, confirmAsync, t } = App;
  const file = document.getElementById("chapter-file");
  const prompt = document.getElementById("import-prompt");
  const promptMessage = document.getElementById("prompt-message");
  const manualImport = document.getElementById("manual-import");
  const manualButton = document.getElementById("manual-import-button");
  const sourceButton = document.getElementById("source-upload");
  const importModeKey = `regtrack.draft-import-mode:${location.pathname}`;
  sourceButton.onclick = () => {
    sessionStorage.setItem(importModeKey, "source");
    manualImport.hidden = true;
    manualButton.classList.remove("active");
    manualButton.setAttribute("aria-expanded", "false");
    document.getElementById("assignment").hidden = true;
    sourceButton.classList.add("active");
    document.getElementById("source-upload-message").textContent = t("接口暂未接通，请使用手动导入。", "Not connected yet. Please use manual import.");
  };
  manualButton.onclick = () => {
    sessionStorage.setItem(importModeKey, "manual");
    manualImport.hidden = false;
    manualButton.classList.add("active");
    manualButton.setAttribute("aria-expanded", "true");
    sourceButton.classList.remove("active");
    if (loadedFile) document.getElementById("assignment").hidden = false;
    document.getElementById("source-upload-message").textContent = "";
  };
  fetch(`/static/single-draft-chapters-prompt.txt?v=${App.version}`).then(response => {
    if (!response.ok) throw new Error(t("提示词读取失败", "Failed to load the prompt"));
    return response.text();
  }).then(text => { prompt.value = text.trim(); }).catch(e => { prompt.value = ""; promptMessage.textContent = e.message; });
  document.getElementById("copy-import-prompt").onclick = async () => {
    if (!prompt.value) { promptMessage.textContent = t("提示词尚未加载，请稍后再试。", "The prompt is not loaded yet. Try again shortly."); return; }
    try { await navigator.clipboard.writeText(prompt.value); promptMessage.textContent = t("提示词已复制，可以粘贴到 Web 端大模型。", "Prompt copied. Paste it into the web LLM."); }
    catch (e) { prompt.select(); promptMessage.textContent = t("浏览器未允许自动复制，已选中提示词，请按 Ctrl+C。", "The browser blocked copying. The prompt is selected; press Ctrl+C."); }
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
  if (sessionStorage.getItem(importModeKey) === "manual") manualButton.click();
  let chapterNos = new Set();
  let incomingComments = {};
  let currentDraft = null;
  let conflictIds = [];
  let residualIds = [];
  let removedWithChapter = 0;
  let deletedComments = [];
  document.getElementById("version-name").innerHTML = `<option value="">${t("请选择", "Select")}</option>` + App.meta.version_names.map(v => `<option>${esc(v)}</option>`).join("");
  function versionChanged() { newVersion.hidden = draft.value !== "new"; newVersion.disabled = newVersion.hidden; }
  async function loadVersions() {
    const options = await get("/api/drafts/options", { standard_id: standard.value });
    draft.innerHTML = `<option value="">${t("请选择归属版本", "Select a draft version")}</option>` + options.map(v => `<option value="${v.id}">${esc(v.version_name)} · ${esc(v.sub_version_no)} · ${esc(v.draft_date)}</option>`).join("") + `<option value="new">${t("＋ 新增草案版本", "＋ New draft version")}</option>`;
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
      <span class="decision-title"><input type="checkbox" value="${a.id}"> <strong>${esc(a.clause_no)} ${esc(a.title_cn || "")}</strong> · ${t("使用新导入批注", "Use the new annotation")}</span>
      <span class="decision-pair"><span><small>${t("现有批注", "Existing")} · ${esc(a.annotation_type)}</small><p>${esc(a.content)}</p></span><span><small>${t("新导入批注", "New")} · Comment</small><p>${esc(incomingComments[a.clause_no])}</p></span></span>
    </label>`).join("");
    document.getElementById("annotation-retention-list").innerHTML = residuals.map(a => `<label class="decision-item"><span class="decision-title"><input type="checkbox" value="${a.id}" checked> <strong>${esc(a.clause_no)} ${esc(a.title_cn || "")}</strong> · ${t("保留现有批注", "Keep existing annotation")} · ${esc(a.annotation_type)}</span><p>${esc(a.content)}</p></label>`).join("") + unmatched.map(a => `<div class="decision-item unmatched"><strong>${esc(a.clause_no)} ${esc(a.title_cn || "")}</strong><small>${esc(a.annotation_type)} · ${t("新文件没有此条款，批注将移除", "Clause not in the new file; the annotation will be removed")}</small><p>${esc(a.content)}</p></div>`).join("") + (!residuals.length && !unmatched.length ? `<p class="form-text">${t("没有需要选择的残留批注。", "No remaining annotations to decide.")}</p>` : "");
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
    message.textContent = t("正在读取文件…", "Reading the file…");
    error.textContent = "";
    try {
      const selected = file.files[0];
      const form = new FormData(); form.append("file", selected);
      const data = await api("/api/drafts/imports/read", { method: "POST", body: form });
      chapterNos = new Set(data.chapter_nos);
      incomingComments = data.incoming_comments;
      document.getElementById("file-identity").innerHTML = `<span class="tag info">${window.App.uiText("文件中的信息", "From the file")}</span><h2>${esc(data.standard_no)} · ${esc(data.standard_name)}</h2><p>${t("来源版本：", "Source version: ")}${esc(data.source_version)}</p><small>${esc(selected.name)}</small>`;
      if (standardPicker) standardPicker.destroy();
      standard.innerHTML = "";
      standardPicker = Fields.standard(standard, {
        recommended: data.standards,
        quickCreatePrefill: { std_no: data.standard_no, name_cn: data.standard_name },
        onChange: () => loadVersions().catch(e => { error.textContent = e.message; }),
      });
      submit.disabled = false;
      await loadVersions();
      loadedFile = selected;
      document.getElementById("assignment").hidden = false;
      message.textContent = t("文件已读取，请确认草案归属。", "File read. Confirm which draft it belongs to.");
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
          const commentWarning = deletedComments.length ? t(`另有 ${deletedComments.length} 条正式意见（${commentNumbers}${deletedComments.length > 5 ? "等" : ""}）因条款编号不再存在，将连同状态记录删除。`,
            ` ${deletedComments.length} opinion(s) (${commentNumbers}${deletedComments.length > 5 ? ", …" : ""}) reference clauses that no longer exist and will be deleted with their status history.`) : "";
          if (!await confirmAsync(t(`确认整体替换当前章节？${conflictIds.length} 条冲突批注中，${target.replace_annotation_ids.length} 条改用新导入内容，${conflictIds.length - target.replace_annotation_ids.length} 条沿用现有内容；${target.keep_annotation_ids.length} 条残留批注继续保留，${removed} 条旧批注移除。`,
            `Replace all current chapters? Of ${conflictIds.length} differing annotation(s), ${target.replace_annotation_ids.length} use the new text and ${conflictIds.length - target.replace_annotation_ids.length} keep the existing text; ${target.keep_annotation_ids.length} remaining annotation(s) are kept and ${removed} old annotation(s) removed.`) + commentWarning)) return;
          target.replace_import_id = current.imports[0].id;
        }
      }
      const form = new FormData(); form.append("file", loadedFile); form.append("target", JSON.stringify(target));
      const result = await api("/api/drafts/imports", { method: "POST", body: form });
      // 替换当前历史项：之后在草案页点「返回」回到导入前的页面，而不是已完成的导入页。
      location.replace(`/drafts/${result.draft_id}#reader`);
    } catch (e) {
      if (e.status === 409 && draft.value !== "new") {
        try {
          await loadDecisions();
          error.textContent = `${e.message} ${t("选择已刷新，请重新核对。", "The choices were refreshed; please check again.")}`;
        } catch (refreshError) {
          error.textContent = `${e.message} ${t("刷新选择失败：", "Refresh failed: ")}${refreshError.message}`;
        }
      } else error.textContent = e.message;
    }
    finally { submit.disabled = false; file.disabled = false; }
  };
});
