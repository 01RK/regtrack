App.ready(async () => {
  const { esc, dash, get, post, put, del, tag, statusTag, emptyRow, ok, fail, confirmDialog } = App;
  const M = App.meta;
  const state = { page: 1, size: 10 };

  const DERIVE = ["Survey Feedback", "Collect Comments", "Lobby with Drafter",
                  "Compliance Check", "Others"];

  const typeSel = document.getElementById("f-type");
  typeSel.innerHTML = '<option value="">全部类型</option>' +
    M.meeting_types.map((v) => `<option>${esc(v)}</option>`).join("");
  typeSel.onchange = () => { state.page = 1; load(); };

  let timer;
  document.getElementById("f-q").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.page = 1; load(); }, 260);
  };
  document.getElementById("f-reset").onclick = () => {
    document.getElementById("f-q").value = "";
    typeSel.value = "";
    state.page = 1;
    load();
  };

  /* ----------------------------------------------------------- 列表 */
  async function load() {
    const data = await get("/api/meetings", {
      q: document.getElementById("f-q").value,
      type: typeSel.value,
      page: state.page, page_size: state.size,
    });
    const host = document.getElementById("list");
    host.innerHTML = data.items.length
      ? data.items.map(card).join("")
      : '<div class="panel"><div class="empty"><b>没有匹配的会议</b>点右上角「登记会议」记下开过的会</div></div>';

    host.querySelectorAll("[data-open]").forEach((b) => {
      b.onclick = () => openDetail(Number(b.dataset.open));
    });
    host.querySelectorAll("[data-derive]").forEach((b) => {
      b.onclick = () => Records.derive(JSON.parse(b.dataset.derive), ctx);
    });

    const pages = Math.max(1, Math.ceil(data.total / state.size));
    const pager = document.getElementById("pager");
    pager.innerHTML = `<span>共 ${data.total} 场 · 第 ${state.page}/${pages} 页</span>
      <button class="btn btn-outline-secondary btn-sm" ${state.page <= 1 ? "disabled" : ""} data-prev>上一页</button>
      <button class="btn btn-outline-secondary btn-sm" ${state.page >= pages ? "disabled" : ""} data-next>下一页</button>`;
    const prev = pager.querySelector("[data-prev]");
    const next = pager.querySelector("[data-next]");
    if (prev) prev.onclick = () => { state.page--; load(); };
    if (next) next.onclick = () => { state.page++; load(); };
  }

  function card(m) {
    return `
      <div class="panel">
        <div class="panel-head">
          <h2>${esc(m.meeting_no)} · ${esc(m.title)}</h2>
          <span class="hint">${esc(m.meeting_date)}${m.meeting_type ? " · " + esc(m.meeting_type) : ""}${m.organizer ? " · " + esc(m.organizer) : ""}</span>
          <div class="ms-auto btn-row">
            <span class="tag info">${m.standard_count} 个标准</span>
            <span class="tag">${m.action_count} 个事项</span>
            <a class="btn btn-outline-primary btn-sm" href="/meetings/import?meeting_id=${m.id}">导入纪要</a>
            <button class="btn btn-outline-secondary btn-sm" data-open="${m.id}">打开</button>
          </div>
        </div>
        <div class="panel-body tight table-wrap">
          ${m.key_discussions ? `<div style="padding:16px;white-space:pre-wrap"><strong>Key Discussions</strong><div>${esc(m.key_discussions)}</div></div>` : ''}
          <table class="table meetings-table">
            <thead><tr><th>涉及标准</th><th>阶段</th><th>风险</th><th>负责人</th><th>本会派生事项</th><th style="width:44%">派生后续工作</th></tr></thead>
            <tbody>${m.standards.length ? m.standards.map((s) => standardRow(m, s)).join("")
              : emptyRow(6, "这场会还没挂标准", "打开会议后用搜索下拉把讨论到的标准挂进来")}</tbody>
          </table>
        </div>
      </div>`;
  }

  function standardRow(m, s) {
    const info = { meeting_id: m.id, meeting_no: m.meeting_no, meeting_title: m.title,
                   standard_id: s.id, std_no: s.std_no, name_cn: s.name_cn };
    return `
      <tr>
        <td><div class="cell-main">${esc(s.std_no)}</div><div class="cell-sub">${esc(s.name_cn)}</div>
            ${s.note ? `<div class="link-note">${esc(s.note)}</div>` : ""}</td>
        <td><span class="tag info">${esc(App.stageLabel(s.stage_code))}</span></td>
        <td>${tag(s.risk_level)}</td>
        <td>${dash(s.mb_owner)}</td>
        <td class="num">${s.action_count || 0}</td>
        <td><div class="derive-bar">${DERIVE.map((type) =>
          `<button class="btn btn-sm" data-derive='${esc(JSON.stringify(Object.assign({ type }, info)))}'>+ ${esc(type)}</button>`).join("")}</div></td>
      </tr>`;
  }

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: load };
  const openDetail = (id) => Records.open("meeting", id, ctx);

  document.getElementById("btn-new").onclick = () => Records.meetingForm(null, ctx);

  await load();
  const deep = new URLSearchParams(location.search).get("id");
  if (deep) openDetail(Number(deep));
});
