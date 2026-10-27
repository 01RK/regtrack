/* Shared, escaped references for comment cards, tables and detail dialogs. */
(function () {
  const {esc, t} = App;
  function version(name, number) { return `${esc(name)} v${esc(number)}`; }
  function scope(clause) { return clause ? `${t("条款", "Clause")} ${esc(clause)}` : t("整体批注", "Whole-draft annotation"); }
  function pairScope(clause, other) { return clause ? `${t("条款", "Clause")} ${esc(clause)}` : other ? t("无对应条款", "No matching clause") : t("整体比对", "Whole-draft comparison"); }
  function reference(c) {
    if (c.source_kind === "comparison") return `<div class="comment-reference"><div><span>${window.App.uiText("前版", "Before")}</span> ${version(c.before_version_name, c.before_sub_version_no)} · ${pairScope(c.before_clause_no, c.after_clause_no)}</div><div><span>${window.App.uiText("后版", "After")}</span> ${version(c.after_version_name, c.after_sub_version_no)} · ${pairScope(c.after_clause_no, c.before_clause_no)}</div>${c.comparison_id ? `<a href="/drafts/comparisons/${c.comparison_id}?change=${c.comparison_change_id}">${t("查看比对条目", "View comparison")}</a>` : ''}</div>`;
    return `<div class="comment-reference">${version(c.version_name, c.sub_version_no)}<div>${scope(c.clause_no)}</div></div>`;
  }
  function sourceLabel(kind) {
    return kind === "single" ? t("单版本意见批注", "Single-draft annotation") : t("多版本比对意见批注", "Draft comparison annotation");
  }
  window.CommentView = {reference, sourceLabel};
})();
