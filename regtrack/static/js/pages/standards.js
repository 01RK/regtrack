App.ready(async () => {
  const { esc, dash, clip, get, tag, stageMini, stageLabel, emptyRow } = App;
  const M = App.meta;

  const state = { page: 1, size: 25, total: 0, archived: false };

  /* --------------------------------------------------------- 过滤条 */
  function fillSelect(id, values, label) {
    const el = document.getElementById(id);
    el.innerHTML = `<option value="">${label}</option>` +
      values.map((v) => `<option>${esc(v)}</option>`).join("");
    el.onchange = () => { state.page = 1; load(); };
  }
  // 阶段下拉用编码取值、名称展示：库里存编码，界面只负责显示
  const stageSelect = document.getElementById("f-stage");
  stageSelect.innerHTML = '<option value="">全部阶段</option>' +
    M.stages.map((s) => `<option value="${esc(s.code)}">${esc(s.label)}</option>`).join("");
  stageSelect.onchange = () => { state.page = 1; load(); };
  fillSelect("f-risk", M.risk_levels, "全部风险");
  fillSelect("f-type", M.standard_types, "全部类别");
  fillSelect("f-owner", (App.lookups.person || []).map((p) => p.value), "全部负责人");

  let timer;
  document.getElementById("f-q").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.page = 1; load(); }, 260);
  };
  document.getElementById("f-reset").onclick = () => {
    ["f-q", "f-stage", "f-risk", "f-type", "f-owner"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    state.page = 1;
    load();
  };

  function filters() {
    return {
      q: document.getElementById("f-q").value,
      stage: document.getElementById("f-stage").value,
      risk: document.getElementById("f-risk").value,
      type: document.getElementById("f-type").value,
      owner: document.getElementById("f-owner").value,
      archived: state.archived ? 1 : "",
      page: state.page,
      page_size: state.size,
    };
  }

  /* ----------------------------------------------------------- 列表 */
  async function load() {
    const data = await get("/api/standards", filters());
    state.total = data.total;
    const body = document.getElementById("rows");
    body.innerHTML = data.items.length
      ? data.items.map((s) => `
        <tr class="row-click" data-id="${s.id}">
          <td><div class="cell-main">${esc(s.std_no)}</div>
              <div class="cell-sub">${esc(s.name_cn)}</div></td>
          <td>${stageMini(s.stage_code)} <span class="tag info">${esc(stageLabel(s.stage_code))}</span></td>
          <td>${dash(s.std_type)}</td>
          <td>${dash(s.tc_wg)}</td>
          <td>${tag(s.risk_level)}</td>
          <td>${dash(s.mb_owner)}</td>
          <td class="cell-sub">${clip(s.impact_areas, 34)}</td>
          <td class="num">${s.draft_count}</td>
          <td class="num">${s.comment_count}</td>
          <td class="num">${s.open_action_count ? `<span class="tag medium">${s.open_action_count}</span>` : 0}</td>
          <td class="num">${dash(s.effective_date)}</td>
        </tr>`).join("")
      : emptyRow(11, state.archived ? "归档里没有匹配的标准" : "没有匹配的标准",
                 state.archived ? "取消勾选即可回到正常列表" : "换个搜索词，或点右上角「新建标准」建档");

    body.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.onclick = () => openDetail(Number(tr.dataset.id));
    });

    const pages = Math.max(1, Math.ceil(state.total / state.size));
    document.getElementById("pager").innerHTML = `
      <span>共 ${state.total} 条 · 第 ${state.page}/${pages} 页</span>
      <button class="btn btn-outline-secondary btn-sm" ${state.page <= 1 ? "disabled" : ""} data-prev>上一页</button>
      <button class="btn btn-outline-secondary btn-sm" ${state.page >= pages ? "disabled" : ""} data-next>下一页</button>`;
    const pager = document.getElementById("pager");
    const prev = pager.querySelector("[data-prev]");
    const next = pager.querySelector("[data-next]");
    if (prev) prev.onclick = () => { state.page--; load(); };
    if (next) next.onclick = () => { state.page++; load(); };
  }

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: load };
  const openDetail = (id) => Records.open("standard", id, ctx);

  document.getElementById("btn-new").onclick = () => Records.standardForm(null, ctx);
  document.getElementById("f-archived").onchange = (ev) => {
    state.archived = ev.target.checked;
    state.page = 1;
    load();
  };

  await load();
  const deep = new URLSearchParams(location.search).get("id");
  if (deep) openDetail(Number(deep));
});
