App.ready(async () => {
  const { esc, dash, clip, get, post, put, del, statusTag, emptyRow, ok, fail, confirmDialog } = App;
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
  fillSelect("f-status", M.comment_statuses, "全部状态");
  fillSelect("f-by", (App.lookups.person || []).map((p) => p.value), "全部提交人");

  let timer;
  document.getElementById("f-q").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.page = 1; groupView.reset(); load(); }, 260);
  };
  document.getElementById("f-reset").onclick = () => {
    ["f-q", "f-status", "f-by"].forEach((id) => { document.getElementById(id).value = ""; });
    state.page = 1;
    groupView.reset();
    load();
  };

  async function load() {
    const data = await get("/api/comments", {
      q: document.getElementById("f-q").value,
      status: document.getElementById("f-status").value,
      submitted_by: document.getElementById("f-by").value,
      page: state.page, page_size: state.size,
    });
    if (data.groups.length) {
      groupView.render(data.groups, 8, (c, groupAttrs) => `
        <tr class="row-click" data-id="${c.id}" ${groupAttrs}>
          <td class="num">${esc(c.comment_no)}</td>
          <td class="cell-sub">${c.version_name ? esc(c.version_name) + " v" + esc(c.sub_version_no) : "—"}</td>
          <td class="num">${dash(c.clause_no)}</td>
          <td>${dash(c.topic)}</td>
          <td class="cell-sub">${clip(c.comment_text, 70)}</td>
          <td>${statusTag(c.status)}</td>
          <td>${esc(c.submitted_by)}</td>
          <td class="num">${dash(c.submission_date)}</td>
        </tr>`);
    } else {
      body.innerHTML = emptyRow(8, "没有匹配的正式意见", "点右上角登记，或在事项的反馈对象里一键生成");
    }
    body.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.onclick = () => openDetail(Number(tr.dataset.id));
    });

    const pages = Math.max(1, Math.ceil(data.group_total / state.size));
    const pager = document.getElementById("pager");
    pager.innerHTML = `<span>共 ${data.total} 条记录 · ${data.group_total} 个标准组 · 第 ${state.page}/${pages} 页</span>
      <button class="btn btn-outline-secondary btn-sm" ${state.page <= 1 ? "disabled" : ""} data-prev>上一页</button>
      <button class="btn btn-outline-secondary btn-sm" ${state.page >= pages ? "disabled" : ""} data-next>下一页</button>`;
    const prev = pager.querySelector("[data-prev]");
    const next = pager.querySelector("[data-next]");
    if (prev) prev.onclick = () => { state.page--; load(); };
    if (next) next.onclick = () => { state.page++; load(); };
  }

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: load };
  const openDetail = (id) => Records.open("comment", id, ctx);

  document.getElementById("btn-new").onclick = () => Records.commentForm(null, ctx);

  await load();
  const deep = new URLSearchParams(location.search).get("id");
  if (deep) openDetail(Number(deep));
});
