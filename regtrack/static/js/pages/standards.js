App.ready(async () => {
  const { esc, dash, get, tag, stageMini, stageLabel, emptyRow, t } = App;
  const M = App.meta;

  const state = { page: 1, size: 25, total: 0, archived: false };
  const RISK = { High: "high", Medium: "medium", Low: "low" };

  /* --------------------------------------------------------- 过滤条 */
  function fillSelect(id, values, label) {
    const el = document.getElementById(id);
    el.innerHTML = `<option value="">${label}</option>` +
      values.map((v) => `<option>${esc(v)}</option>`).join("");
    el.onchange = () => { state.page = 1; load(); };
  }
  // 阶段下拉用编码取值、名称展示：库里存编码，界面只负责显示
  const stageSelect = document.getElementById("f-stage");
  stageSelect.innerHTML = `<option value="">${t("全部阶段", "All stages")}</option>` +
    M.stages.map((s) => `<option value="${esc(s.code)}">${esc(stageLabel(s.code))}</option>`).join("");
  stageSelect.onchange = () => { state.page = 1; load(); };
  fillSelect("f-risk", M.risk_levels, t("全部风险", "All risks"));
  fillSelect("f-type", M.standard_types, t("全部类别", "All types"));
  fillSelect("f-owner", (App.lookups.person || []).map((p) => p.value), t("全部负责人", "All owners"));

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
          <td data-label="${t("标准", "Standard")}"><div class="standard-identity"><span class="cell-main">${esc(s.std_no || s.plan_no || "—")}</span>${s.std_type ? `<span class="tag standard-type">${esc(s.std_type)}</span>` : ""}${s.risk_level ? `<span class="tag ${RISK[s.risk_level]}" title="${t("风险等级", "Risk level")}">${esc(s.risk_level)}</span>` : ""}</div>
              <div class="cell-sub">${esc(s.name_cn)}</div></td>
          <td data-label="${t("当前阶段", "Current Stage")}"><div class="standard-stage">${stageMini(s.stage_code)}<span class="tag info">${esc(stageLabel(s.stage_code))}</span></div></td>
          <td data-label="${t("负责人", "MB Owner")}">${dash(s.mb_owner)}</td>
          <td data-label="${t("影响领域", "Impact Area")}" class="cell-sub">${dash(s.impact_areas)}</td>
          <td data-label="${t("草案", "Drafts")}" class="num">${s.draft_count}</td>
          <td data-label="${t("意见", "Opinions")}" class="num">${s.comment_count}</td>
          <td data-label="${t("待办", "Todo")}" class="num"><span class="${s.todo_count ? "count-alert" : ""}">${s.todo_count}</span></td>
          <td data-label="${t("实施日期", "Effective Date")}" class="num">${dash(s.effective_date)}</td>
        </tr>`).join("")
      : emptyRow(8, state.archived ? ["归档里没有匹配的标准", "No matching archived standards"] : ["没有匹配的标准", "No matching standards"],
                 state.archived ? ["取消勾选即可回到正常列表", "Untick the box to return to the normal list"] : ["换个搜索词，或点右上角「新建标准」建档", "Try another search, or create one with New Standard"]);

    body.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.onclick = () => openDetail(Number(tr.dataset.id));
    });

    const pages = Math.max(1, Math.ceil(state.total / state.size));
    document.getElementById("pager").innerHTML = `
      <span>${window.App.uiText(`共 ${state.total} 条 · 第 ${state.page}/${pages} 页`, `${state.total} records · Page ${state.page}/${pages}`)}</span>
      <button class="btn btn-outline-secondary btn-sm" ${state.page <= 1 ? "disabled" : ""} data-prev>${window.App.uiText("上一页", "Previous")}</button>
      <button class="btn btn-outline-secondary btn-sm" ${state.page >= pages ? "disabled" : ""} data-next>${window.App.uiText("下一页", "Next")}</button>`;
    const pager = document.getElementById("pager");
    const prev = pager.querySelector("[data-prev]");
    const next = pager.querySelector("[data-next]");
    if (prev) prev.onclick = () => { state.page--; load(); };
    if (next) next.onclick = () => { state.page++; load(); };
  }

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: load };
  const openDetail = (id) => Records.open("standard", id, ctx);

  document.getElementById("btn-new").onclick = () => Records.standardForm(ctx);
  document.getElementById("f-archived").onchange = (ev) => {
    state.archived = ev.target.checked;
    state.page = 1;
    load();
  };

  await load();
  const linked = new URLSearchParams(location.search).get("id");
  if (linked) await openDetail(Number(linked));
  else await Records.restore(ctx);
});
