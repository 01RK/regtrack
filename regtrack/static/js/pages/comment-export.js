App.ready(() => {
  const { get, t } = App;
  const link = document.getElementById("export-file");
  const summary = document.getElementById("exchange-summary");
  let current = null;

  Fields.standardDraft(document.getElementById("exchange-standard"),
                       document.getElementById("exchange-draft"), async (draftId) => {
    current = draftId;
    link.classList.toggle("disabled", !draftId);
    link.setAttribute("aria-disabled", String(!draftId));
    link.href = draftId ? `/api/comments/exchange/export?draft_id=${draftId}` : "#";
    summary.textContent = "";
    if (!draftId) return;
    const data = await get("/api/comments", { draft_id: draftId, source_kind: "single", page_size: 1 });
    if (current !== draftId) return;
    summary.textContent = t(`该草案版本共有 ${data.total} 条单版本意见。`,
                            `This draft version has ${data.total} single-draft opinion(s).`);
  });
});
