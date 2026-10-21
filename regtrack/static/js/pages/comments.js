App.ready(async () => {
  const { esc, dash, clip, get, statusTag, emptyRow, t } = App;
  const M = App.meta;
  const state = { page: 1, size: 10 };
  const body = document.getElementById("rows");
  const groupView = GroupedList.create(
    body,
    document.getElementById("groups-expand"),
    document.getElementById("groups-collapse"),
  );

  function fillSelect(id, values, label) {
    const el = document.getElementById(id);
    el.innerHTML = `<option value="">${label}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join("");
    el.onchange = () => { state.page = 1; groupView.reset(); load(); };
  }
  const sources = document.getElementById("f-source");
  sources.innerHTML = `<option value="">${t("全部来源", "All sources")}</option>` + Object.entries(M.comment_sources).map(([key, label]) => `<option value="${key}">${esc(CommentView.sourceLabel(key))}</option>`).join("");
  sources.onchange = () => {state.page = 1; groupView.reset(); load();};
  fillSelect("f-type", M.annotation_types, t("全部意见类型", "All types"));
  fillSelect("f-status", M.comment_statuses, t("全部状态", "All statuses"));
  fillSelect("f-by", (App.lookups.person || []).map((p) => p.value), t("全部提交人", "All submitters"));

  document.getElementById("f-status").value = "Submitted";
  let timer;
  ["f-standard-q", "f-content-q"].forEach(id => document.getElementById(id).oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.page = 1; groupView.reset(); load(); }, 260);
  });
  document.getElementById("f-reset").onclick = () => {
    ["f-standard-q", "f-content-q", "f-status", "f-by", "f-source", "f-type"].forEach((id) => { document.getElementById(id).value = ""; });
    document.getElementById("f-status").value = "Submitted";
    state.page = 1;
    groupView.reset();
    load();
  };

  async function load() {
    const data = await get("/api/comments", {
      standard_q: document.getElementById("f-standard-q").value,
      content_q: document.getElementById("f-content-q").value,
      source_kind: sources.value,
      comment_type: document.getElementById("f-type").value,
      status: document.getElementById("f-status").value,
      submitted_by: document.getElementById("f-by").value,
      page: state.page, page_size: state.size,
    });
    if (data.groups.length) {
      groupView.render(data.groups, 8, (c, groupAttrs) => `
        <tr class="row-click" data-id="${c.id}" ${groupAttrs}>
          <td class="num">${esc(c.comment_no)}</td>
          <td class="cell-sub">${CommentView.reference(c)}</td>
          <td class="cell-sub">${esc(CommentView.sourceLabel(c.source_kind))}</td>
          <td>${esc(c.comment_type)}</td>
          <td class="cell-sub">${clip(c.comment_text, 70)}</td>
          <td>${statusTag(c.status)}</td>
          <td>${esc(c.submitted_by)}</td>
          <td class="num">${dash(c.submission_date)}</td>
        </tr>`);
    } else {
      body.innerHTML = emptyRow(8, ["没有匹配的意见", "No matching opinions"],
        ["保存批注或导入意见后自动生成，可调整状态筛选。", "Opinions are created from annotations or imports. Try another status filter."]);
    }
    body.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.onclick = () => openDetail(Number(tr.dataset.id));
    });

    const pages = Math.max(1, Math.ceil(data.group_total / state.size));
    const pager = document.getElementById("pager");
    pager.innerHTML = `<span>${window.App.uiText(`共 ${data.total} 条记录 · ${data.group_total} 个标准组 · 第 ${state.page}/${pages} 页`,
                                 `${data.total} records · ${data.group_total} standard groups · Page ${state.page}/${pages}`)}</span>
      <button class="btn btn-outline-secondary btn-sm" ${state.page <= 1 ? "disabled" : ""} data-prev>${window.App.uiText("上一页", "Previous")}</button>
      <button class="btn btn-outline-secondary btn-sm" ${state.page >= pages ? "disabled" : ""} data-next>${window.App.uiText("下一页", "Next")}</button>`;
    const prev = pager.querySelector("[data-prev]");
    const next = pager.querySelector("[data-next]");
    if (prev) prev.onclick = () => { state.page--; load(); };
    if (next) next.onclick = () => { state.page++; load(); };
  }

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: load };
  const openDetail = (id) => Records.open("comment", id, ctx);



  await load();
  const deep = new URLSearchParams(location.search).get("id");
  if (deep) openDetail(Number(deep));
});
