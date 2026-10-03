App.ready(async () => {
  const { esc, dash, clip, get, post, put, del, tag, emptyRow, ok, fail, confirmDialog } = App;
  const M = App.meta;

  /* =============================================== 一、草案版本列表 */
  const state = { page: 1, size: 10 };
  const draftBody = document.getElementById("rows");
  const draftGroups = GroupedList.create(
    draftBody,
    document.getElementById("draft-groups-expand"),
    document.getElementById("draft-groups-collapse"),
  );

  function fillSelect(id, values, label, onChange) {
    const el = document.getElementById(id);
    el.innerHTML = `<option value="">${label}</option>` +
      values.map((v) => `<option>${esc(v)}</option>`).join("");
    el.onchange = onChange;
  }
  fillSelect("f-impact", M.overall_impacts, "全部影响", () => {
    state.page = 1; draftGroups.reset(); loadDrafts();
  });

  let t1;
  document.getElementById("f-q").oninput = () => {
    clearTimeout(t1);
    t1 = setTimeout(() => { state.page = 1; draftGroups.reset(); loadDrafts(); }, 260);
  };
  document.getElementById("f-reset").onclick = () => {
    document.getElementById("f-q").value = "";
    document.getElementById("f-impact").value = "";
    state.page = 1;
    draftGroups.reset();
    loadDrafts();
  };

  async function loadDrafts() {
    const data = await get("/api/drafts", {
      q: document.getElementById("f-q").value,
      impact: document.getElementById("f-impact").value,
      page: state.page, page_size: state.size,
    });
    if (data.groups.length) {
      draftGroups.render(data.groups, 7, (d, groupAttrs) => `
        <tr class="row-click" data-id="${d.id}" ${groupAttrs}>
          <td>${esc(d.version_name)}</td>
          <td class="num">${esc(d.sub_version_no)}</td>
          <td class="num">${esc(d.draft_date)}</td>
          <td>${tag(d.overall_impact)}</td>
          <td class="num">${d.clause_count ? `<span class="tag info">${d.clause_count}</span>` : 0}</td>
          <td>${dash(d.issued_by)}</td>
          <td class="cell-sub">${clip(d.main_summary, 60)}</td>
        </tr>`);
    } else {
      draftBody.innerHTML = emptyRow(7, "没有匹配的草案", "点右上角「登记草案」把新收到的一版挂到标准上");
    }
    draftBody.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.onclick = () => openDetail(Number(tr.dataset.id));
    });
    pager("pager", data.total, data.group_total, state, loadDrafts);
  }

  function pager(id, total, groupTotal, st, reload) {
    const pages = Math.max(1, Math.ceil(groupTotal / st.size));
    const host = document.getElementById(id);
    host.innerHTML = `<span>共 ${total} 条记录 · ${groupTotal} 个标准组 · 第 ${st.page}/${pages} 页</span>
      <button class="btn btn-outline-secondary btn-sm" ${st.page <= 1 ? "disabled" : ""} data-prev>上一页</button>
      <button class="btn btn-outline-secondary btn-sm" ${st.page >= pages ? "disabled" : ""} data-next>下一页</button>`;
    const prev = host.querySelector("[data-prev]");
    const next = host.querySelector("[data-next]");
    if (prev) prev.onclick = () => { st.page--; reload(); };
    if (next) next.onclick = () => { st.page++; reload(); };
  }

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: async () => { await loadDrafts(); } };
  const openDetail = (id) => (window.location.href = `/drafts/${id}`);

  document.getElementById("btn-new").onclick = () => Records.draftForm(null, ctx);

  await loadDrafts();
});
