App.ready(() => {
  const { api, get, esc, t, confirmAsync } = App;
  const file = document.getElementById("opinion-file");
  const button = document.getElementById("import-file");
  const summary = document.getElementById("exchange-summary");
  const errorBox = document.getElementById("import-error");
  const resultBox = document.getElementById("import-result");
  let draft = null;

  document.getElementById("status-values").innerHTML = App.meta.comment_statuses
    .map((status) => `<code>${esc(status)}</code>`).join(" / ");

  const ready = () => { button.disabled = !(draft && file.files.length); };
  const reset = () => { errorBox.hidden = true; resultBox.hidden = true; };

  Fields.standardDraft(document.getElementById("exchange-standard"),
                       document.getElementById("exchange-draft"), async (draftId) => {
    draft = null;
    summary.textContent = "";
    reset();
    ready();
    if (!draftId) return;
    const detail = await get(`/api/drafts/${draftId}`);
    draft = detail;
    summary.textContent = detail.clause_count
      ? t(`当前草案原文共 ${detail.clause_count} 个章节，章条编号将与这些章节匹配。`,
          `The current draft text has ${detail.clause_count} chapter(s); clause numbers are matched against them.`)
      : t("该版本尚未导入草案原文，只能导入整份草案意见（章条编号留空）。",
          "No draft text has been imported for this version, so only whole-draft opinions (blank clause number) can be imported.");
    ready();
  });
  file.onchange = () => { reset(); ready(); };

  button.onclick = async () => {
    const target = `${draft.std_no} · ${draft.version_name} v${draft.sub_version_no}`;
    if (!await confirmAsync(t(`将「${file.files[0].name}」中的意见导入到 ${target}？`,
                              `Import the opinions in "${file.files[0].name}" into ${target}?`))) return;
    reset();
    button.disabled = true;
    try {
      const form = new FormData();
      form.append("draft_id", draft.id);
      form.append("file", file.files[0]);
      const result = await api("/api/comments/exchange/import", { method: "POST", body: form });
      resultBox.innerHTML = `
        <h3>${t(`已导入 ${result.created.length} 条意见`, `${result.created.length} opinion(s) imported`)}</h3>
        ${result.created.length ? `<p>${result.created.map(esc).join("、")}</p>` : ""}
        ${result.skipped_rows.length ? `<p class="text-muted">${t(
          `第 ${result.skipped_rows.join("、")} 行与已有意见相同，已跳过。`,
          `Row(s) ${result.skipped_rows.join(", ")} match existing opinions and were skipped.`)}</p>` : ""}
        <div class="btn-row">
          <a class="btn btn-outline-secondary btn-sm" href="/drafts/${draft.id}#reader">${window.App.uiText("打开草案阅读", "Open draft reader")}</a>
          <a class="btn btn-primary btn-sm" href="/comments">${window.App.uiText("返回意见矩阵", "Back to Comment Matrix")}</a>
        </div>`;
      resultBox.hidden = false;
      file.value = "";
    } catch (e) {
      errorBox.innerHTML = `<b>${esc(e.reason || e.message)}</b>
        ${e.detail ? `<ul>${e.detail.split("\n").map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}`;
      errorBox.hidden = false;
    } finally {
      ready();
    }
  };
});
