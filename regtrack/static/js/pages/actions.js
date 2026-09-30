App.ready(async () => {
  const { esc, dash, get, post, put, del, tag, statusTag, overdue, emptyRow,
          ok, fail, confirmDialog } = App;
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
  fillSelect("f-type", M.action_types, "全部类型");
  fillSelect("f-status", M.action_statuses, "全部状态");
  fillSelect("f-priority", M.priorities, "全部优先级");
  document.getElementById("f-open").onchange = () => {
    state.page = 1; groupView.reset(); load();
  };

  let timer;
  document.getElementById("f-q").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.page = 1; groupView.reset(); load(); }, 260);
  };
  document.getElementById("f-reset").onclick = () => {
    ["f-q", "f-type", "f-status", "f-priority", "f-open"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    state.page = 1;
    groupView.reset();
    load();
  };

  async function load() {
    const data = await get("/api/actions", {
      q: document.getElementById("f-q").value,
      type: document.getElementById("f-type").value,
      status: document.getElementById("f-status").value,
      priority: document.getElementById("f-priority").value,
      open_only: document.getElementById("f-open").value,
      page: state.page, page_size: state.size,
    });
    if (data.groups.length) {
      groupView.render(data.groups, 8, (a, groupAttrs) => `
        <tr class="row-click" data-id="${a.id}" ${groupAttrs}>
          <td class="num">${esc(a.item_no)}</td>
          <td>${esc(a.item_type)}</td>
          <td class="cell-main">${esc(a.title)}</td>
          <td class="cell-sub">${a.meeting_no ? esc(a.meeting_no) : "—"}</td>
          <td>${statusTag(a.current_status)}</td>
          <td>${tag(a.priority)}</td>
          <td class="num">${a.due_date
            ? (overdue(a.due_date) && !["Completed", "Closed", "Cancelled"].includes(a.current_status)
                ? `<span class="tag high">${esc(a.due_date)}</span>` : esc(a.due_date))
            : "—"}</td>
          <td class="num">${a.item_type === "Collect Comments"
            ? `${a.responded_count}/${a.recipient_count}` : "—"}</td>
        </tr>`);
    } else {
      body.innerHTML = emptyRow(8, "没有匹配的事项", "点右上角新建，或在会议里用标准行的按钮派生");
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

  document.getElementById("new-type-menu").innerHTML = M.action_types.map((type) =>
    `<li><button class="dropdown-item" data-new-type="${esc(type)}">${esc(type)} · ${esc(ActionForm.TYPE_LABEL[type])}</button></li>`).join("");
  document.querySelectorAll("[data-new-type]").forEach((b) => {
    b.onclick = () => ActionForm.open({
      isNew: true, typeLocked: true,
      values: { item_type: b.dataset.newType, current_status: "Open" },
      onSaved: async (saved) => { await load(); openDetail(saved.id); },
    });
  });

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: load };
  const openDetail = (id) => Records.open("action", id, ctx);

  const params = new URLSearchParams(location.search);
  if (params.get("open") === "1") document.getElementById("f-open").value = "1";
  await load();
  if (params.get("id")) openDetail(Number(params.get("id")));
});
