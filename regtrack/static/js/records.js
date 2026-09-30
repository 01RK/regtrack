/* 记录层：五类记录的明细与表单，全站共用。
 *
 * 为什么集中在这里：一条记录常常要从别处点进去看——会议里点事项、事项里点意见、
 * 标准里点草案。过去这些入口是页面跳转，跳走之后就回不到原来的位置了。
 * 把明细做成任何页面都能调用的弹窗，跨记录查看就变成在当前弹窗上叠一层，
 * 关掉这一层（或点标题栏的「返回」）就回到上一级，原来的标签页、滚动位置都还在。
 *
 * 约定：
 *   Records.open(kind, id, ctx)   打开明细，kind ∈ standard|draft|meeting|comment|action
 *   ctx.trail      祖先记录的名字，用作面包屑与返回按钮的落点
 *   ctx.onChanged  本层数据变了就调用，让上一级弹窗和列表页跟着刷新
 *   模板里用 data-open="kind:id" 标记跨记录入口，交给 bindLinks 统一接线
 */
(function () {
  "use strict";

  const { esc, dash, clip, get, post, put, del, tag, statusTag, overdue,
          emptyRow, ok, fail, confirmDialog, confirmAsync, openModal } = window.App;
  const M = () => window.App.meta;

  /* ------------------------------------------------------------ 外壳 */

  const trailOf = (ctx) => ctx.trail || [];

  /** 明细弹窗统一外壳：叠一层、带面包屑、带返回上一级。 */
  function shell(ctx, cfg) {
    const trail = trailOf(ctx);
    return openModal(Object.assign({}, cfg, {
      size: cfg.size || "xl",
      subtitle: (trail.length ? trail.join(" › ") + " › " : "") + cfg.subtitle,
      back: trail.length ? trail[trail.length - 1] : null,
    }));
  }

  /** 把 data-open="kind:id" 的入口接成「在本层之上再叠一层」。 */
  function bindLinks(host, ctx, selfLabel, refresh) {
    host.querySelectorAll("[data-open]").forEach((btn) => {
      const [kind, rid] = btn.dataset.open.split(":");
      btn.onclick = (ev) => {
        ev.stopPropagation();
        open(kind, Number(rid), {
          trail: trailOf(ctx).concat(selfLabel),
          onChanged: refresh,
        });
      };
    });
  }

  /** 数据变了：本层重画，同时通知上一级弹窗 / 列表页。 */
  const bubble = (ctx, fn) => async () => {
    if (fn) await fn();
    if (ctx.onChanged) await ctx.onChanged();
  };

  const kv = (rows) =>
    `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : ""}</dd>`).join("")}</dl>`;

  const table = (head, rows, cols, emptyTitle, emptyHint) => `
    <div class="table-wrap"><table class="table">
      <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows || emptyRow(cols, emptyTitle, emptyHint)}</tbody>
    </table></div>`;

  const openBtn = (kind, id, text) =>
    `<button class="btn-link-quiet" data-open="${kind}:${id}">${esc(text)} →</button>`;

  /* ================================================== 1. 标准主档 */

  function standardSpec(isNew, values) {
    const spec = [
      { section: "身份" },
      { name: "std_no", label: "Standard No.", cn: "标准编号", type: "text", required: true, col: 6, placeholder: "如 GB 38031—2025" },
      { name: "name_cn", label: "Standard Name CN", cn: "中文名称", type: "text", required: true, col: 6 },
      { name: "name_en", label: "Standard Name EN", cn: "英文名称", type: "text", col: 12 },
    ];
    if (isNew) {
      spec.push(
        { name: "stage_code", label: "Current Stage", cn: "起始阶段", type: "choices",
          options: M().stages.map((s) => ({ value: s.code, text: s.label, sub: s.note })),
          required: true, col: 6,
          help: "先登记现在所处的阶段；更早的阶段可以随后用「推进 / 补录阶段」补齐。" },
        { name: "stage_effective_date", label: "进入该阶段的日期", cn: "写入阶段历史第一条", type: "date", col: 6 });
    } else {
      spec.push({ name: "stage_display", label: "Current Stage", cn: "当前阶段", type: "auto", col: 12,
                  display: values.stage,
                  help: "阶段信息请通过推进/补录阶段功能调整。" });
    }
    return spec.concat([
      { section: "归口与责任" },
      { name: "std_type", label: "Standard Type", cn: "标准类别", type: "fixed", options: M().standard_types, col: 4 },
      { name: "tc_wg", label: "TC / WG", cn: "归口技委会", type: "lookup", category: "tc_wg", col: 4 },
      { name: "responsible_authority", label: "Responsible Authority", cn: "主管 / 发布机构", type: "lookup", category: "organization", col: 4 },
      { name: "leading_org", label: "Leading Organization", cn: "牵头起草单位", type: "lookup", category: "organization", col: 4 },
      { name: "mb_owner", label: "MB Owner", cn: "内部负责人", type: "lookup", category: "person", col: 4 },
      { name: "risk_level", label: "Current Risk Level", cn: "整体风险", type: "fixed", options: M().risk_levels, col: 4 },
      { name: "impact_area_list", label: "Main Impact Area", cn: "影响领域（可多选）", type: "lookup", category: "impact_area", multiple: true, col: 12 },
      { section: "时间与范围" },
      { name: "planned_release_date", label: "Planned Release Date", cn: "预计发布", type: "date", col: 4 },
      { name: "actual_release_date", label: "Actual Release Date", cn: "实际发布", type: "date", col: 4 },
      { name: "effective_date", label: "Effective Date", cn: "实施日期", type: "date", col: 4 },
      { name: "scope", label: "Scope", cn: "适用范围", type: "textarea", rows: 3, col: 12 },
    ]);
  }

  function standardForm(values, ctx = {}) {
    const isNew = !values;
    Forms.formModal({
      title: isNew ? "新建标准主档" : `编辑 ${values.std_no}`,
      subtitle: "Standard Profile",
      fields: standardSpec(isNew, values || {}),
      values: values || { stage_code: M().stages[0].code, stage_effective_date: Forms.today() },
      submitText: isNew ? "建档" : "保存修改",
      async onSubmit(payload, m) {
        const saved = isNew
          ? await post("/api/standards", payload)
          : await put(`/api/standards/${values.id}`, payload);
        ok(isNew ? `已建档 ${saved.std_no}` : "已保存");
        await window.App.refreshLookups();
        await m.close();
        if (ctx.onChanged) await ctx.onChanged();
        if (isNew) open("standard", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
      },
    });
  }

  async function standardDetail(id, ctx) {
    let s = await get(`/api/standards/${id}`);
    const body = document.createElement("div");
    const dlg = shell(ctx, {
      title: `${s.std_no} ${s.name_cn}`,
      subtitle: "Standard Profile · 标准主档",
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-archive></button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-stage>推进 / 补录阶段</button>
                 <button class="btn btn-outline-secondary btn-sm" data-edit>编辑</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">关闭</button>
               </div>`,
    });

    const refresh = bubble(ctx, async () => {
      s = await get(`/api/standards/${id}`);
      render(activeTab());
    });

    const activeTab = () => {
      const on = body.querySelector(".nav-link.active");
      return on ? on.dataset.bsTarget : "#p-ov";
    };

    // 阶段推进 / 补录与阶段详情共用同一套上下文
    const stageCtx = () => ({
      standardId: s.id,
      title: `${s.std_no} ${s.name_cn}`,
      stage: s.stage,
      timeline: s.stage_timeline,
      onDone: refresh,
    });

    function render(keepTab) {
      dlg.footer.querySelector("[data-archive]").textContent = s.archived ? "恢复" : "归档";
      body.innerHTML = `
        ${s.archived ? '<div class="stage-banner">本标准已归档：数据完整保留，但不在正常列表中展示。</div>' : ""}
        ${Stages.timelineHtml(s.stage_timeline)}
        <div class="form-text" style="margin-top:6px">点击时间轴上的阶段可查看详情；当前阶段之前尚未填写的阶段可就地补录。</div>
        <ul class="nav nav-tabs" style="margin-top:14px" role="tablist">
          ${tabBtn("ov", "概览", "")}
          ${tabBtn("st", "阶段历史", s.stage_history.length)}
          ${tabBtn("dr", "草案", s.drafts.length)}
          ${tabBtn("mt", "会议", s.meetings.length)}
          ${tabBtn("cm", "意见", s.comments.length)}
          ${tabBtn("ac", "事项", s.actions.length)}
        </ul>
        <div class="tab-content" style="padding-top:14px">
          <div class="tab-pane fade" id="p-ov">${overview(s)}</div>
          <div class="tab-pane fade" id="p-st">${Stages.historyHtml(s.stage_history)}</div>
          <div class="tab-pane fade" id="p-dr">${draftTable(s.drafts)}</div>
          <div class="tab-pane fade" id="p-mt">${meetingTable(s.meetings)}</div>
          <div class="tab-pane fade" id="p-cm">${commentTable(s.comments)}</div>
          <div class="tab-pane fade" id="p-ac">${actionTable(s.actions)}</div>
        </div>`;
      // 重画后回到原来那个标签页，避免从子弹窗返回时被弹回概览
      const target = body.querySelector(`[data-bs-target="${keepTab || "#p-ov"}"]`)
        || body.querySelector(".nav-link");
      target.classList.add("active");
      const pane = body.querySelector(target.dataset.bsTarget);
      pane.classList.add("show", "active");
      body.querySelectorAll(".stage-step[data-stage]").forEach((btn) => {
        btn.onclick = () => Stages.openDetail(Object.assign(stageCtx(), {
          stage: s.stage_timeline.find((x) => x.code === btn.dataset.stage),
        }));
      });
      bindLinks(body, ctx, s.std_no, refresh);
    }

    const tabBtn = (key, label, count) =>
      `<li class="nav-item" role="presentation">
         <button class="nav-link" data-bs-toggle="tab" data-bs-target="#p-${key}" type="button">${esc(label)}
           ${count !== "" ? `<span class="cnt">${count}</span>` : ""}
         </button></li>`;

    const overview = (r) => kv([
      ["Standard No.", r.std_no], ["Standard Name CN", r.name_cn],
      ["Standard Name EN", r.name_en], ["Current Stage", `${r.stage}（${r.stage_code}）`],
      ["Standard Type", r.std_type], ["TC / WG", r.tc_wg],
      ["Responsible Authority", r.responsible_authority],
      ["Leading Organization", r.leading_org],
      ["Current Risk Level", r.risk_level], ["MB Owner", r.mb_owner],
      ["Main Impact Area", (r.impact_area_list || []).join("、")],
      ["Planned Release Date", r.planned_release_date],
      ["Actual Release Date", r.actual_release_date],
      ["Effective Date", r.effective_date], ["Scope", r.scope],
      ["建档", `${r.created_by || "—"} · ${r.created_at}`],
      ["最近更新", `${r.updated_by || "—"} · ${r.updated_at}`],
    ]);

    const draftTable = (rows) => table(
      ["版本", "子版本", "草案日期", "总体影响", "条款变化", "发布方", ""],
      rows.map((d) => `<tr>
        <td class="cell-main">${esc(d.version_name)}</td>
        <td class="num">${esc(d.sub_version_no)}</td>
        <td class="num">${esc(d.draft_date)}</td>
        <td>${tag(d.overall_impact)}</td>
        <td class="num">${d.clause_count}</td>
        <td>${dash(d.issued_by)}</td>
        <td>${openBtn("draft", d.id, "打开草案")}</td>
      </tr>`).join(""), 7, "还没有登记草案", "在「草案登记」里把草案挂到这个标准上");

    const meetingTable = (rows) => table(
      ["会议号", "会议标题", "日期", "类型", ""],
      rows.map((r) => `<tr>
        <td class="num">${esc(r.meeting_no)}</td>
        <td class="cell-main">${esc(r.title)}</td>
        <td class="num">${esc(r.meeting_date)}</td>
        <td>${dash(r.meeting_type)}</td>
        <td>${openBtn("meeting", r.id, "打开会议")}</td>
      </tr>`).join(""), 5, "还没有会议挂到这个标准", "在「工作组会议」里把标准挂进会议");

    const commentTable = (rows) => table(
      ["意见号", "条款", "主题", "状态", "提交人", "提交日期", ""],
      rows.map((r) => `<tr>
        <td class="num">${esc(r.comment_no)}</td>
        <td class="num">${dash(r.clause_no)}</td>
        <td>${dash(r.topic)}</td>
        <td>${statusTag(r.status)}</td>
        <td>${esc(r.submitted_by)}</td>
        <td class="num">${dash(r.submission_date)}</td>
        <td>${openBtn("comment", r.id, "打开意见")}</td>
      </tr>`).join(""), 7, "还没有正式意见", "在「意见矩阵」登记，或由事项的反馈生成");

    const actionTable = (rows) => table(
      ["事项号", "类型", "标题", "状态", "优先级", "截止", ""],
      rows.map((r) => `<tr>
        <td class="num">${esc(r.item_no)}</td>
        <td>${esc(r.item_type)}</td>
        <td class="cell-main">${esc(r.title)}</td>
        <td>${statusTag(r.current_status)}</td>
        <td>${tag(r.priority)}</td>
        <td class="num">${overdue(r.due_date) ? `<span class="tag high">${esc(r.due_date)}</span>` : dash(r.due_date)}</td>
        <td>${openBtn("action", r.id, "打开事项")}</td>
      </tr>`).join(""), 7, "还没有关联事项", "在「事项」里新建，或从会议行内按钮派生");

    render("#p-ov");

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      standardForm(s, { trail: trailOf(ctx), onChanged: refresh });
    };
    dlg.footer.querySelector("[data-stage]").onclick = () => {
      Stages.openForm(stageCtx());
    };
    const archiveBtn = dlg.footer.querySelector("[data-archive]");
    archiveBtn.onclick = () => {
      if (s.archived) {
        confirmDialog(`把 ${s.std_no} 从归档中恢复？恢复后重新出现在标准列表里。`, async () => {
          try {
            await post(`/api/standards/${s.id}/restore`);
            ok("已恢复");
            await refresh();
          } catch (e) { fail(e.message); }
        });
        return;
      }
      confirmDialog(
        `确认归档 ${s.std_no}？归档后它不再出现在正常列表中，但主档、阶段历史与全部关联记录都会保留，随时可以恢复。`,
        async () => {
          try {
            await del(`/api/standards/${s.id}`);
            ok("已归档");
            await refresh();
          } catch (e) { fail(e.message); }
        });
    };
    return dlg;
  }

  /* ================================================== 2. 草案登记 */

  const draftSpec = () => [
    { section: "所属标准" },
    { name: "standard_id", label: "Standard", cn: "所属标准（搜不到可就地新建）", type: "standard", required: true, col: 12,
      help: "先搜编号或名称；搜不到说明这个标准还没建档，用下拉底部的按钮建档后会自动选中。" },
    { section: "版本信息" },
    { name: "version_name", label: "Version Name", cn: "版本名称", type: "fixed", options: M().version_names, required: true, col: 4 },
    { name: "sub_version_no", label: "Draft Sub-Version No.", cn: "子版本号", type: "text", required: true, col: 4, placeholder: "1.0" },
    { name: "draft_date", label: "Draft Date", cn: "草案日期", type: "date", required: true, col: 4 },
    { name: "issued_by", label: "Issued By", cn: "发布 / 提供方", type: "lookup", category: "organization", col: 6 },
    { name: "overall_impact", label: "Overall Impact", cn: "对公司总体影响", type: "fixed", options: M().overall_impacts, col: 6 },
    { name: "file_link", label: "Draft File / Link", cn: "原文位置", type: "text", col: 12, placeholder: "https:// 或 \\\\共享盘\\路径" },
    { name: "main_summary", label: "Main Summary", cn: "这一版主要内容", type: "textarea", rows: 3, col: 12 },
    { name: "notes", label: "Notes", cn: "补充说明", type: "textarea", rows: 2, col: 12 },
  ];

  function draftForm(values, ctx = {}) {
    const isNew = !values;
    Forms.formModal({
      title: isNew ? "登记草案" : `编辑 ${values.version_name} v${values.sub_version_no}`,
      subtitle: "Draft Registry",
      fields: draftSpec(),
      values: values || Object.assign({ draft_date: Forms.today() }, ctx.prefill || {}),
      submitText: isNew ? "登记" : "保存修改",
      async onSubmit(payload, m) {
        const saved = isNew
          ? await post("/api/drafts", payload)
          : await put(`/api/drafts/${values.id}`, payload);
        ok(isNew ? "草案已登记" : "已保存");
        await m.close();
        if (ctx.onChanged) await ctx.onChanged();
        if (isNew) open("draft", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
      },
    });
  }

  async function draftDetail(id, ctx) {
    let d = await get(`/api/drafts/${id}`);
    const body = document.createElement("div");
    const dlg = shell(ctx, {
      title: `${d.std_no} · ${d.version_name} v${d.sub_version_no}`,
      subtitle: "Draft Registry · 草案登记",
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-del>删除</button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-edit>编辑草案</button>
                 <button class="btn btn-primary btn-sm" data-addclause>+ 登记条款变化</button>
                 <button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">关闭</button>
               </div>`,
    });

    const label = `${d.version_name} v${d.sub_version_no}`;
    const refresh = bubble(ctx, async () => { d = await get(`/api/drafts/${id}`); render(); });

    function render() {
      body.innerHTML = `
        <dl class="kv">
          <dt>Standard</dt>
          <dd>${esc(d.std_no)} ${esc(d.name_cn)}（当前阶段 ${esc(window.App.stageLabel(d.stage_code))}）</dd>
          <dt>Version</dt><dd>${esc(d.version_name)} · 子版本 ${esc(d.sub_version_no)} · ${esc(d.draft_date)}</dd>
          <dt>Issued By</dt><dd>${d.issued_by ? esc(d.issued_by) : ""}</dd>
          <dt>Overall Impact</dt><dd>${d.overall_impact ? esc(d.overall_impact) : ""}</dd>
          <dt>Draft File / Link</dt><dd>${d.file_link ? esc(d.file_link) : ""}</dd>
          <dt>Main Summary</dt><dd>${d.main_summary ? esc(d.main_summary) : ""}</dd>
          <dt>Notes</dt><dd>${d.notes ? esc(d.notes) : ""}</dd>
        </dl>
        <div class="panel" style="margin-top:16px">
          <div class="panel-head">
            <h2>受影响条款 · Clause Evolution</h2>
            <span class="hint">全系统唯一的条款变化登记入口 · 共 ${d.clauses.length} 条</span>
          </div>
          <div class="panel-body tight table-wrap">
            <table class="table">
              <thead><tr>
                <th>条款号</th><th>主题</th><th>变化类型</th><th>对比版本</th>
                <th>上一版条款号</th><th>测试</th><th>准入</th><th>合规风险</th><th>负责人</th><th></th>
              </tr></thead>
              <tbody>${d.clauses.length ? d.clauses.map(clauseRow).join("")
                : emptyRow(10, "这一版还没有登记条款变化", "点右下角「+ 登记条款变化」逐条录入")}</tbody>
            </table>
          </div>
        </div>
        ${d.comments && d.comments.length ? commentPanel() : ""}`;

      body.querySelectorAll("[data-clause]").forEach((btn) => {
        btn.onclick = () => clauseDetail(d.clauses.find((c) => c.id === Number(btn.dataset.clause)));
      });
      bindLinks(body, ctx, label, refresh);
    }

    const commentPanel = () => `
      <div class="panel">
        <div class="panel-head"><h2>针对这一版的正式意见</h2>
          <span class="hint">共 ${d.comments.length} 条</span></div>
        <div class="panel-body tight">
          ${table(["意见号", "条款", "主题", "状态", "提交人", ""],
            d.comments.map((c) => `<tr>
              <td class="num">${esc(c.comment_no)}</td>
              <td class="num">${dash(c.clause_no)}</td>
              <td>${dash(c.topic)}</td>
              <td>${statusTag(c.status)}</td>
              <td>${esc(c.submitted_by)}</td>
              <td>${openBtn("comment", c.id, "打开意见")}</td>
            </tr>`).join(""), 6, "还没有意见", "")}
        </div>
      </div>`;

    const clauseRow = (c) => `
      <tr>
        <td class="num cell-main">${esc(c.current_clause_no)}</td>
        <td>${esc(c.topic)}</td>
        <td><span class="tag info">${esc(c.change_type)}</span></td>
        <td class="cell-sub">${c.last_version_name ? esc(c.last_version_name) + " v" + esc(c.last_sub_version_no) : "首版"}</td>
        <td class="num">${dash(c.last_clause_no)}</td>
        <td>${tag(c.test_impact, c.test_impact === "Yes" ? "medium" : c.test_impact === "No" ? "ok" : "muted")}</td>
        <td>${tag(c.homologation_impact)}</td>
        <td>${tag(c.compliance_risk)}</td>
        <td>${dash(c.responsible_person)}</td>
        <td><button class="btn-link-quiet" data-clause="${c.id}">查看 / 编辑</button></td>
      </tr>`;

    function clauseDetail(c) {
      const detailBody = document.createElement("div");
      const cm = shell({ trail: trailOf(ctx).concat(label) }, {
        title: `条款 ${c.current_clause_no} · ${c.topic}`,
        subtitle: "Subform · Clause Evolution 条款变化",
        size: "lg",
        body: detailBody,
        footer: `<button class="btn btn-outline-secondary btn-sm" data-cdel>删除这条</button>
                 <div class="ms-auto btn-row">
                   <button class="btn btn-outline-secondary btn-sm" data-cedit>编辑</button>
                   <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">关闭</button>
                 </div>`,
      });

      function renderClause() {
        detailBody.innerHTML = kv([
          ["Draft Ver New", `${d.version_name} v${d.sub_version_no}（系统自动）`],
          ["Current Clause No.", c.current_clause_no],
          ["Draft Ver Last", c.last_version_name ? `${c.last_version_name} v${c.last_sub_version_no}` : "首版 · 无可对比版本"],
          ["Last Ver Clause No.", c.last_clause_no],
          ["Topic", c.topic],
          ["Last Ver Clause Text", c.last_clause_text],
          ["Current Clause Text", c.current_clause_text],
          ["Change Type", c.change_type],
          ["Description of Change", c.change_desc],
          ["Interpretation", c.interpretation],
          ["Test Impact", c.test_impact],
          ["Homologation Impact", c.homologation_impact],
          ["Compliance Risk", c.compliance_risk],
          ["Responsible Person", c.responsible_person],
        ]);
        // 条款号或主题被编辑后，同步更新当前详情标题。
        const titleEl = cm.el.querySelector(".modal-title");
        const sub = titleEl.querySelector(".sub");
        Array.from(titleEl.childNodes).forEach((node) => { if (node !== sub) node.remove(); });
        titleEl.appendChild(document.createTextNode(`条款 ${c.current_clause_no} · ${c.topic}`));
      }
      renderClause();

      cm.footer.querySelector("[data-cedit]").onclick = () => {
        clauseForm(d, c, async () => {
          await refresh();
          c = d.clauses.find((row) => row.id === c.id);
          if (c) renderClause();
          else await cm.close();
        });
      };
      cm.footer.querySelector("[data-cdel]").onclick = () => {
        confirmDialog("确认删除这条条款变化记录？", async () => {
          try {
            await del(`/api/drafts/clauses/${c.id}`);
            ok("已删除");
            await cm.close();
            await refresh();
          } catch (e) { fail(e.message); }
        });
      };
    }

    render();

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      draftForm(d, { trail: trailOf(ctx), onChanged: refresh });
    };
    dlg.footer.querySelector("[data-addclause]").onclick = () => clauseForm(d, null, refresh);
    dlg.footer.querySelector("[data-del]").onclick = () => {
      confirmDialog(`确认删除草案 ${d.version_name} v${d.sub_version_no}？其下的条款变化会一并删除。`, async () => {
        try {
          await del(`/api/drafts/${d.id}`);
          ok("已删除");
          await dlg.close();
          if (ctx.onChanged) await ctx.onChanged();
        } catch (e) { fail(e.message); }
      });
    };
    return dlg;
  }

  function clauseForm(draft, clause, onDone) {
    const NONE = "__none__";
    const versionOptions = [{ value: NONE, text: "首版 · 无可对比版本", sub: "该标准只有这一版时选此项" }]
      .concat(draft.sibling_versions.map((v) => ({
        value: String(v.id),
        text: `${v.version_name} v${v.sub_version_no}`,
        sub: v.draft_date,
      })));
    const initial = Object.assign({}, clause || {});
    initial.last_draft_id = clause && clause.last_draft_id ? String(clause.last_draft_id) : NONE;

    Forms.formModal({
      title: clause ? `编辑条款 ${clause.current_clause_no}` : "登记条款变化",
      subtitle: `Clause Evolution · ${draft.std_no} ${draft.version_name} v${draft.sub_version_no}`,
      size: "xl",
      fields: [
        { section: "先定位条款" },
        { name: "draft_ver_new", label: "Draft Ver New", cn: "出现版本", type: "auto", col: 4,
          display: `${draft.version_name} v${draft.sub_version_no}` },
        { name: "current_clause_no", label: "Current Clause No.", cn: "当前版章节号", type: "text", required: true, col: 4, placeholder: "如 7.5 / Annex A" },
        { name: "topic", label: "Topic", cn: "条款主题", type: "text", required: true, col: 4, placeholder: "如 热扩散测试" },
        { name: "last_draft_id", label: "Draft Ver Last", cn: "对比的上一版", type: "choices", options: versionOptions, required: true, col: 6 },
        { name: "last_clause_no", label: "Last Ver Clause No.", cn: "上一版章节号", type: "text", col: 6 },
        { section: "再对照内容" },
        { name: "last_clause_text", label: "Last Ver Clause Text", cn: "上一版原文", type: "textarea", rows: 5, col: 6 },
        { name: "current_clause_text", label: "Current Clause Text", cn: "当前版原文", type: "textarea", rows: 5, col: 6 },
        { section: "后判定变化与影响" },
        { name: "change_type", label: "Change Type", cn: "变化类型", type: "fixed", options: M().change_types, required: true, col: 4 },
        { name: "test_impact", label: "Test Impact", cn: "影响现有测试？", type: "fixed", options: M().yes_no_tbd, col: 4 },
        { name: "homologation_impact", label: "Homologation Impact", cn: "准入影响", type: "fixed", options: M().risk_levels, col: 4 },
        { name: "change_desc", label: "Description of Change", cn: "具体改了什么", type: "textarea", rows: 3, required: true, col: 12 },
        { name: "interpretation", label: "Interpretation", cn: "对公司意味着什么", type: "textarea", rows: 3, col: 12 },
        { name: "compliance_risk", label: "Compliance Risk", cn: "合规风险", type: "fixed", options: M().risk_levels, col: 6 },
        { name: "responsible_person", label: "Responsible Person", cn: "跟进人", type: "lookup", category: "person", col: 6 },
      ],
      values: initial,
      submitText: clause ? "保存修改" : "登记这条变化",
      async onSubmit(payload, m) {
        payload.last_draft_id = payload.last_draft_id === NONE ? null : payload.last_draft_id;
        if (clause) await put(`/api/drafts/clauses/${clause.id}`, payload);
        else await post(`/api/drafts/${draft.id}/clauses`, payload);
        ok(clause ? "已保存" : "条款变化已登记");
        await m.close();
        await onDone();
      },
    });
  }

  /* ================================================== 3. 工作组会议 */

  const DERIVE = ["Survey Feedback", "Collect Comments", "Lobby with Drafter",
                  "Compliance Check", "Others"];

  const meetingSpec = () => [
    { section: "会议基本信息" },
    { name: "title", label: "Meeting Title", cn: "会议标题", type: "text", required: true, col: 8 },
    { name: "meeting_date", label: "Meeting Date", cn: "开会日期", type: "date", required: true, col: 4 },
    { name: "meeting_type", label: "Meeting Type", cn: "会议形式", type: "fixed", options: M().meeting_types, col: 4 },
    { name: "organizer", label: "Organizer", cn: "组织方", type: "lookup", category: "organization", col: 4 },
    { name: "next_meeting_date", label: "Next Meeting Date", cn: "下次会议日期", type: "date", col: 4 },
    { name: "participants", label: "Participants", cn: "参加单位 / 人员", type: "textarea", rows: 2, col: 12 },
    { name: "key_discussions", label: "Key Discussions", cn: "整体讨论议题", type: "textarea", rows: 3, col: 12 },
    { name: "overall_conclusion", label: "Overall Conclusion", cn: "整体结论", type: "textarea", rows: 3, col: 12 },
    { name: "material_link", label: "Meeting Material / Minutes", cn: "纪要 / 材料位置", type: "text", col: 12 },
  ];

  function meetingForm(values, ctx = {}) {
    const isNew = !values;
    const formValues = values
      ? Object.assign({}, values, { standard_ids: values.standards.map((s) => s.id) })
      : { meeting_date: Forms.today(), standard_ids: [] };
    const spec = meetingSpec().concat(
      { section: "涉及标准" },
      { name: "standard_ids", label: "涉及标准", type: "standard", multiple: true, col: 12,
        cn: "一场会议可同时挂多项标准；搜不到可在下拉底部快速建档",
        help: "例会、联合协调会通常会讨论多项标准，逐个选上即可；也可以先不挂，稍后在会议明细里补。" });
    Forms.formModal({
      title: isNew ? "登记工作组会议" : `编辑 ${values.meeting_no}`,
      subtitle: "WG Meeting",
      fields: spec,
      values: formValues,
      submitText: isNew ? "登记会议" : "保存修改",
      async onSubmit(payload, m) {
        // 在多选里取消勾选，等于取消挂载：批注跟着关联走，先问一句再提交
        const losing = isNew ? [] : values.standards.filter(
          (s) => (s.note || "").trim() && !(payload.standard_ids || []).includes(s.id));
        if (losing.length) {
          const yes = await confirmAsync(
            "您正在取消挂载一份批注过 Note 的标准，如确认移除，Note 也将丢失。" +
            `\n涉及：${losing.map((s) => s.std_no).join("、")}`);
          if (!yes) return;
          payload.drop_notes = true;
        }
        const saved = isNew
          ? await post("/api/meetings", payload)
          : await put(`/api/meetings/${values.id}`, payload);
        ok(isNew ? `已登记 ${saved.meeting_no}` : "已保存");
        await m.close();
        if (ctx.onChanged) await ctx.onChanged();
        if (isNew) open("meeting", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
      },
    });
  }

  /** 会议行内派生事项：建完直接打开新事项的明细，省得再去事项页找。 */
  function derive(info, ctx = {}) {
    ActionForm.open({
      isNew: true,
      typeLocked: true,
      values: {
        item_type: info.type,
        current_status: "Open",
        standard_id: info.standard_id,
        meeting_id: info.meeting_id,
        title: `${info.meeting_no} · ${info.std_no} ${info.type}`,
      },
      locked: {
        standard: `${info.std_no} ${info.name_cn}`,
        standard_id: info.standard_id,
        meeting: `${info.meeting_no} ${info.meeting_title}`,
        meeting_id: info.meeting_id,
      },
      async onSaved(saved) {
        if (ctx.onChanged) await ctx.onChanged();
        if (saved && saved.id) {
          open("action", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
        }
      },
    });
  }

  async function meetingDetail(id, ctx) {
    let m = await get(`/api/meetings/${id}`);
    const body = document.createElement("div");
    const dlg = shell(ctx, {
      title: `${m.meeting_no} · ${m.title}`,
      subtitle: "WG Meeting · 工作组会议",
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-del>删除</button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-edit>编辑会议</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">关闭</button>
               </div>`,
    });

    const refresh = bubble(ctx, async () => { m = await get(`/api/meetings/${id}`); render(); });

    function render() {
      body.innerHTML = `
        <dl class="kv">
          <dt>Meeting No.</dt><dd>${esc(m.meeting_no)}（系统自动）</dd>
          <dt>Meeting Date</dt><dd>${esc(m.meeting_date)}</dd>
          <dt>Meeting Type</dt><dd>${m.meeting_type ? esc(m.meeting_type) : ""}</dd>
          <dt>Organizer</dt><dd>${m.organizer ? esc(m.organizer) : ""}</dd>
          <dt>Participants</dt><dd>${m.participants ? esc(m.participants) : ""}</dd>
          <dt>Key Discussions</dt><dd>${m.key_discussions ? esc(m.key_discussions) : ""}</dd>
          <dt>Overall Conclusion</dt><dd>${m.overall_conclusion ? esc(m.overall_conclusion) : ""}</dd>
          <dt>Material / Minutes</dt><dd>${m.material_link ? esc(m.material_link) : ""}</dd>
          <dt>Next Meeting Date</dt><dd>${m.next_meeting_date ? esc(m.next_meeting_date) : ""}</dd>
        </dl>

        <div class="panel" style="margin-top:16px">
          <div class="panel-head">
            <h2>涉及标准</h2>
            <span class="hint">共 ${m.standards.length} 项 · 每项标准可单独写本会批注</span>
          </div>
          <div class="panel-body">
            <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:12px">
              <div style="flex:1"><select id="attach-std"></select></div>
              <button class="btn btn-primary btn-sm" data-attach style="height:34px">挂上标准</button>
            </div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>标准 / 本会批注</th><th>阶段</th><th>风险</th><th>负责人</th><th>派生后续工作</th><th></th></tr></thead>
                <tbody>${m.standards.length ? m.standards.map(standardRow).join("")
                  : emptyRow(6, "还没挂标准", "用上面的下拉框搜索并挂上这次会讨论到的标准")}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>本会派生的事项</h2><span class="hint">共 ${m.actions.length} 条</span></div>
          <div class="panel-body tight table-wrap">
            <table class="table">
              <thead><tr><th>事项号</th><th>类型</th><th>标题</th><th>关联标准</th><th>状态</th><th></th></tr></thead>
              <tbody>${m.actions.length ? m.actions.map((a) => `
                <tr>
                  <td class="num">${esc(a.item_no)}</td>
                  <td>${esc(a.item_type)}</td>
                  <td class="cell-main">${esc(a.title)}</td>
                  <td class="cell-sub">${a.std_no ? esc(a.std_no) : "—"}</td>
                  <td>${statusTag(a.current_status)}</td>
                  <td>${openBtn("action", a.id, "打开事项")}</td>
                </tr>`).join("")
                : emptyRow(6, "还没有派生事项", "在上面标准行的按钮里一键派生")}</tbody>
            </table>
          </div>
        </div>`;

      const ts = Fields.standard(body.querySelector("#attach-std"), { placeholder: "搜索要挂上的标准…" });
      body.querySelector("[data-attach]").onclick = async () => {
        const sid = ts.getValue();
        if (!sid) { fail("请先选择标准"); return; }
        try {
          await post(`/api/meetings/${m.id}/standards`, { standard_id: Number(sid) });
          ok("已挂上标准");
          await refresh();
        } catch (e) { fail(e.message); }
      };
      body.querySelectorAll("[data-derive]").forEach((b) => {
        b.onclick = () => derive(JSON.parse(b.dataset.derive),
                                { trail: trailOf(ctx).concat(m.meeting_no), onChanged: refresh });
      });
      body.querySelectorAll("[data-note]").forEach((b) => {
        b.onclick = () => editNote(m.standards.find((s) => String(s.id) === b.dataset.note));
      });
      body.querySelectorAll("[data-detach]").forEach((b) => {
        b.onclick = async () => {
          const std = m.standards.find((s) => String(s.id) === b.dataset.detach);
          const noted = !!(std && (std.note || "").trim());
          // 批注只属于这条关联，取消挂载就没有了，所以先问清楚
          const yes = await confirmAsync(noted
            ? "您正在取消挂载一份批注过 Note 的标准，如确认移除，Note 也将丢失。"
            : "把这个标准从会议中移除？已派生的事项不受影响。");
          if (!yes) return;
          try {
            await del(`/api/meetings/${m.id}/standards/${b.dataset.detach}?drop_notes=1`);
            ok("已移除");
            await refresh();
          } catch (e) { fail(e.message); }
        };
      });
      bindLinks(body, ctx, m.meeting_no, refresh);
    }

    /** 编辑某一项标准在本次会议上的批注。
        一场会常常一次过好几项标准，各自的议论分开记，才不会糊成一段会议纪要。 */
    function editNote(s) {
      if (!s) return;
      Forms.formModal({
        title: `本会批注 · ${s.std_no}`,
        subtitle: `${m.meeting_no} · 涉及标准`,
        size: "md",
        fields: [
          { name: "std", label: "Standard", cn: "标准", type: "auto", col: 12,
            display: `${s.std_no} ${s.name_cn}` },
          { name: "note", label: "Note", cn: "本次会议对这项标准的批注", type: "textarea",
            rows: 4, col: 12,
            help: "只记这场会上关于这项标准的讨论；它属于这条挂载关系，取消挂载会一并删除。" },
        ],
        values: { note: s.note || "" },
        async onSubmit(payload, modal) {
          await put(`/api/meetings/${m.id}/standards/${s.id}`, { note: payload.note });
          await modal.close();
          ok(payload.note.trim() ? "批注已保存" : "批注已清空");
          await refresh();
        },
      });
    }

    function standardRow(s) {
      const info = { meeting_id: m.id, meeting_no: m.meeting_no, meeting_title: m.title,
                     standard_id: s.id, std_no: s.std_no, name_cn: s.name_cn };
      return `
        <tr>
          <td><div class="cell-main">${esc(s.std_no)}</div><div class="cell-sub">${esc(s.name_cn)}</div>
              ${s.note ? `<div class="link-note">${esc(s.note)}</div>` : ""}</td>
          <td><span class="tag info">${esc(window.App.stageLabel(s.stage_code))}</span></td>
          <td>${tag(s.risk_level)}</td>
          <td>${dash(s.mb_owner)}</td>
          <td><div class="derive-bar">${DERIVE.map((type) =>
            `<button class="btn btn-sm" data-derive='${esc(JSON.stringify(Object.assign({ type }, info)))}'>+ ${esc(type)}</button>`).join("")}</div></td>
          <td class="row-tools">
            <button class="btn-link-quiet" data-note="${s.id}">${s.note ? "编辑批注" : "添加批注"}</button>
            <button class="btn-link-quiet" data-detach="${s.id}">移除</button>
          </td>
        </tr>`;
    }

    render();

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      meetingForm(m, { trail: trailOf(ctx), onChanged: refresh });
    };
    dlg.footer.querySelector("[data-del]").onclick = () => {
      confirmDialog(`确认删除会议 ${m.meeting_no}？派生的事项会保留，但不再关联会议。`, async () => {
        try {
          await del(`/api/meetings/${m.id}`);
          ok("已删除");
          await dlg.close();
          if (ctx.onChanged) await ctx.onChanged();
        } catch (e) { fail(e.message); }
      });
    };
    return dlg;
  }

  /* ================================================== 4. 意见矩阵 */

  function commentSpec(isNew, values) {
    const s = [
      { section: "针对哪一条" },
      { name: "standard_id", label: "Standard", cn: "所属标准", type: "standard", required: true, col: 6 },
      { name: "draft_id", label: "Related Draft", cn: "针对哪一版草案", type: "draft", dependsOn: "standard_id", col: 6 },
      { name: "clause_no", label: "Clause No.", cn: "条款号", type: "text", col: 6 },
      { name: "topic", label: "Topic", cn: "主题", type: "text", col: 6 },
      { section: "意见本身" },
      { name: "comment_text", label: "Comment / Proposal", cn: "正式意见内容 / 修改建议", type: "textarea", rows: 4, required: true, col: 12 },
      { name: "rationale", label: "Rationale", cn: "理由与依据", type: "textarea", rows: 4, required: true, col: 12 },
      { section: "提交与跟踪" },
    ];
    s.push(isNew
      ? { name: "status", label: "Comment Status", cn: "意见状态", type: "fixed", options: M().comment_statuses, required: true, col: 4 }
      : { name: "status", label: "Comment Status", cn: "意见状态", type: "auto", col: 4, display: values.status,
          help: "状态通过「状态历史」推进。" });
    return s.concat([
      { name: "submitted_by", label: "Submitted By", cn: "提交人", type: "lookup", category: "person", required: true, col: 4 },
      { name: "submission_channel", label: "Submission Channel", cn: "提交渠道", type: "fixed", options: M().submission_channels, col: 4 },
      { name: "submission_date", label: "Submission Date", cn: "提交日期", type: "date", col: 4 },
      { name: "response", label: "Response", cn: "标委会 / 工作组回复", type: "textarea", rows: 3, col: 12 },
      { name: "follow_up", label: "Follow-up", cn: "后续跟进", type: "textarea", rows: 2, col: 12 },
    ]);
  }

  function commentForm(values, ctx = {}) {
    const isNew = !values;
    const v = values || Object.assign({ status: "Draft", submitted_by: window.App.user }, ctx.prefill || {});
    const ctl = Forms.formModal({
      title: isNew ? "登记正式意见" : `编辑 ${v.comment_no}`,
      subtitle: "Comment Matrix",
      fields: commentSpec(isNew, v),
      values: v,
      submitText: isNew ? "登记意见" : "保存修改",
      extraFooter: isNew
        ? '<button class="btn btn-outline-secondary btn-sm me-auto" data-newstd>搜不到标准？新建标准主档</button>'
        : "",
      async onSubmit(payload, m) {
        if (v.source_recipient_id) payload.source_recipient_id = v.source_recipient_id;
        const saved = isNew
          ? await post("/api/comments", payload)
          : await put(`/api/comments/${v.id}`, payload);
        ok(isNew ? `已登记 ${saved.comment_no}` : "已保存");
        await m.close();
        if (ctx.onChanged) await ctx.onChanged();
        if (isNew) open("comment", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
      },
    });
    const btn = ctl.modal.footer.querySelector("[data-newstd]");
    if (btn) {
      btn.onclick = () => Fields.quickCreateStandard("", (created) => {
        const c = ctl.getForm().controls.standard_id;
        c.ts.addOption(created);
        c.ts.addItem(String(created.id), false);
      });
    }
  }

  async function commentDetail(id, ctx) {
    let c = await get(`/api/comments/${id}`);
    const body = document.createElement("div");
    const dlg = shell(ctx, {
      title: `${c.comment_no} · ${c.std_no}`,
      subtitle: "Comment Matrix · 正式意见",
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-del>删除</button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-status>更新意见状态</button>
                 <button class="btn btn-outline-secondary btn-sm" data-edit>编辑</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">关闭</button>
               </div>`,
    });

    const refresh = bubble(ctx, async () => { c = await get(`/api/comments/${id}`); render(); });

    function render() {
      body.innerHTML = `
        <dl class="kv">
          <dt>Comment No.</dt><dd>${esc(c.comment_no)}（系统自动）</dd>
          <dt>Standard</dt><dd>${esc(c.std_no)} ${esc(c.name_cn)}</dd>
          <dt>Related Draft</dt><dd>${c.version_name
            ? `${esc(c.version_name)} v${esc(c.sub_version_no)}` : ""}</dd>
          <dt>Clause No.</dt><dd>${dash(c.clause_no) === "—" ? "" : esc(c.clause_no)}</dd>
          <dt>Topic</dt><dd>${c.topic ? esc(c.topic) : ""}</dd>
          <dt>Comment / Proposal</dt><dd>${esc(c.comment_text)}</dd>
          <dt>Rationale</dt><dd>${esc(c.rationale)}</dd>
          <dt>Comment Status</dt><dd>${esc(c.status)}</dd>
          <dt>Submitted By</dt><dd>${esc(c.submitted_by)}</dd>
          <dt>Submission Channel</dt><dd>${c.submission_channel ? esc(c.submission_channel) : ""}</dd>
          <dt>Submission Date</dt><dd>${c.submission_date ? esc(c.submission_date) : ""}</dd>
          <dt>Response</dt><dd>${c.response ? esc(c.response) : ""}</dd>
          <dt>Follow-up</dt><dd>${c.follow_up ? esc(c.follow_up) : ""}</dd>
        </dl>
        <div class="panel" style="margin-top:16px">
          <div class="panel-head"><h2>Comment Status History 意见状态历史</h2>
            <span class="hint">共 ${c.status_history.length} 条</span></div>
          <div class="panel-body">${Forms.historyList(c.status_history)}</div>
        </div>`;
      bindLinks(body, ctx, c.comment_no, refresh);
    }
    render();

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      commentForm(c, { trail: trailOf(ctx), onChanged: refresh });
    };
    dlg.footer.querySelector("[data-status]").onclick = () => {
      Forms.statusModal({
        title: `更新意见状态 · ${c.comment_no}`,
        subtitle: "Subform · Comment Status History",
        current: c.status,
        options: M().comment_statuses,
        valueLabel: "New Status",
        url: `/api/comments/${c.id}/status-history`,
        onDone: refresh,
      });
    };
    dlg.footer.querySelector("[data-del]").onclick = () => {
      confirmDialog(`确认删除意见 ${c.comment_no}？其状态历史会一并删除。`, async () => {
        try {
          await del(`/api/comments/${c.id}`);
          ok("已删除");
          await dlg.close();
          if (ctx.onChanged) await ctx.onChanged();
        } catch (e) { fail(e.message); }
      });
    };
    return dlg;
  }

  /* ================================================== 5. 事项 */

  const TYPE_KV = {
    "Survey Feedback": [["Requesting Body", "requesting_body"], ["Submission Due Date", "submission_due_date"],
                        ["Submission Channel", "submission_channel"]],
    "Lobby with Drafter": [["Drafter / Counterpart", "drafter_counterpart"], ["Target Position", "target_position"],
                           ["Actual Lobby Time", "actual_lobby_time"], ["Lobby Method", "lobby_method"], ["Outcome", "outcome"]],
    "Compliance Check": [["Responsible Person / Team", "check_owner"], ["Due Date", "check_due_date"],
                         ["Actual Check Time", "actual_check_time"], ["Check Result", "check_result"],
                         ["Gap Description", "gap_description"]],
    Others: [["Coordinator", "coordinator"], ["Target Date", "target_date"]],
    "Collect Comments": [],
  };

  async function actionDetail(id, ctx) {
    let a = await get(`/api/actions/${id}`);
    const body = document.createElement("div");
    const dlg = shell(ctx, {
      title: `${a.item_no} · ${a.title}`,
      subtitle: `Action Item · ${a.item_type} ${ActionForm.TYPE_LABEL[a.item_type]}`,
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-del>删除</button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-status>更新状态</button>
                 <button class="btn btn-outline-secondary btn-sm" data-edit>编辑</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">关闭</button>
               </div>`,
    });

    const refresh = bubble(ctx, async () => { a = await get(`/api/actions/${id}`); render(); });

    function render() {
      const rows = [
        ["Item No.", `${a.item_no}（系统自动）`],
        ["Item Type", `${a.item_type} · ${ActionForm.TYPE_LABEL[a.item_type]}`],
        ["Title", a.title], ["Description", a.description],
        ["Related Clause", a.related_clause], ["Priority", a.priority],
        ["Current Status", a.current_status],
      ].concat(TYPE_KV[a.item_type].map(([label, key]) => [label, a[key]]))
       .concat([["Final Summary", a.final_summary], ["Supporting Reference", a.supporting_ref]]);

      body.innerHTML = `
        <dl class="kv">
          <dt>Related Standard</dt><dd>${a.std_no
            ? `${esc(a.std_no)} ${esc(a.name_cn)}` : ""}</dd>
          <dt>Related Meeting</dt><dd>${a.meeting_no
            ? `${esc(a.meeting_no)} ${esc(a.meeting_title)}` : ""}</dd>
          <dt>Related Draft</dt><dd>${a.version_name
            ? `${esc(a.version_name)} v${esc(a.sub_version_no)}` : ""}</dd>
          ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : ""}</dd>`).join("")}
        </dl>
        ${a.item_type === "Collect Comments" ? recipientsPanel() : ""}
        <div class="panel" style="margin-top:16px">
          <div class="panel-head"><h2>状态历史</h2><span class="hint">共 ${a.status_history.length} 条</span></div>
          <div class="panel-body">${Forms.historyList(a.status_history)}</div>
        </div>`;

      const addBtn = body.querySelector("[data-addrec]");
      if (addBtn) addBtn.onclick = () => recipientForm(null);
      body.querySelectorAll("[data-editrec]").forEach((b) => {
        b.onclick = () => recipientForm(a.recipients.find((r) => r.id === Number(b.dataset.editrec)));
      });
      body.querySelectorAll("[data-delrec]").forEach((b) => {
        b.onclick = () => confirmDialog("删除这个反馈对象？", async () => {
          await del(`/api/actions/recipients/${b.dataset.delrec}`);
          ok("已删除");
          await refresh();
        });
      });
      body.querySelectorAll("[data-gencomment]").forEach((b) => {
        b.onclick = () => generateComment(Number(b.dataset.gencomment));
      });
      bindLinks(body, ctx, a.item_no, refresh);
    }

    const recipientsPanel = () => `
      <div class="panel" style="margin-top:16px">
        <div class="panel-head">
          <h2>② 反馈对象 · Feedback Recipients</h2>
          <span class="hint">已回复 ${a.responded_count}/${a.recipient_count}</span>
          <button class="btn btn-outline-secondary btn-sm ms-auto" data-addrec>+ 添加反馈对象</button>
        </div>
        <div class="panel-body tight table-wrap">
          <table class="table">
            <thead><tr>
              <th>Team</th><th>Person</th><th>回复状态</th><th>要求回复</th><th>实际回复</th>
              <th>回复摘要</th><th>正式意见</th><th></th>
            </tr></thead>
            <tbody>${a.recipients.length ? a.recipients.map((r) => `
              <tr>
                <td>${dash(r.respondent_team)}</td>
                <td>${dash(r.respondent_person)}</td>
                <td>${statusTag(r.response_status)}</td>
                <td class="num">${overdue(r.response_due_date) && r.response_status === "Open"
                    ? `<span class="tag high">${esc(r.response_due_date)}</span>` : dash(r.response_due_date)}</td>
                <td class="num">${dash(r.response_actual_date)}</td>
                <td class="cell-sub">${clip(r.response_summary, 60)}</td>
                <td>${r.generated_comment_no
                    ? openBtn("comment", r.generated_comment_id, r.generated_comment_no)
                    : (r.response_summary
                        ? `<button class="btn btn-sm btn-outline-secondary" data-gencomment="${r.id}">+ 生成 Comment</button>`
                        : '<span class="cell-sub">待回复</span>')}</td>
                <td class="btn-row">
                  <button class="btn-link-quiet" data-editrec="${r.id}">编辑</button>
                  <button class="btn-link-quiet" data-delrec="${r.id}">删除</button>
                </td>
              </tr>`).join("")
              : emptyRow(8, "还没有反馈对象", "点右上角添加，逐个跟踪谁回了、谁没回")}</tbody>
          </table>
        </div>
      </div>`;

    /** 反馈 → 正式意见：就地开表单，存完直接叠出意见明细，不再跳去意见矩阵。 */
    async function generateComment(recipientId) {
      const childCtx = { trail: trailOf(ctx).concat(a.item_no), onChanged: refresh };
      try {
        const d = await get(`/api/actions/recipients/${recipientId}/comment-draft`);
        if (d.existing) {
          window.App.toast(`这条反馈已经生成过意见 ${d.existing.comment_no}`);
          open("comment", d.existing.id, childCtx);
          return;
        }
        commentForm(null, Object.assign({ prefill: d.prefill }, childCtx));
      } catch (e) { fail(e.message); }
    }

    function recipientForm(r) {
      Forms.formModal({
        title: r ? "编辑反馈对象" : "添加反馈对象",
        subtitle: "Subform · Feedback Recipients",
        size: "lg",
        fields: [
          { name: "respondent_team", label: "Respondent Team", cn: "征集团队", type: "lookup", category: "team", col: 6 },
          { name: "respondent_person", label: "Respondent Person", cn: "征集人员", type: "lookup", category: "person", col: 6,
            help: "Team 与 Person 至少填一个。" },
          { name: "response_status", label: "Response Status", cn: "回复状态", type: "fixed", options: M().response_statuses, required: true, col: 4 },
          { name: "response_due_date", label: "Response Due Date", cn: "要求回复日期", type: "date", col: 4 },
          { name: "response_actual_date", label: "Response Actual Date", cn: "实际回复日期", type: "date", col: 4 },
          { name: "response_summary", label: "Response Summary", cn: "回复内容摘要", type: "textarea", rows: 3, col: 12,
            help: "填了摘要之后，这一行就能一键生成正式意见。" },
        ],
        values: r || { response_status: "Open" },
        submitText: r ? "保存" : "添加",
        async onSubmit(payload, m) {
          if (r) await put(`/api/actions/recipients/${r.id}`, payload);
          else await post(`/api/actions/${a.id}/recipients`, payload);
          ok(r ? "已保存" : "已添加反馈对象");
          await m.close();
          await refresh();
        },
      });
    }

    render();

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      ActionForm.open({
        isNew: false,
        values: a,
        onSaved: refresh,
      });
    };
    dlg.footer.querySelector("[data-status]").onclick = () => {
      Forms.statusModal({
        title: `更新状态 · ${a.item_no}`,
        subtitle: "通用状态机制 · 事项状态历史",
        current: a.current_status,
        options: M().action_statuses,
        valueLabel: "New Status",
        url: `/api/actions/${a.id}/status-history`,
        onDone: refresh,
      });
    };
    dlg.footer.querySelector("[data-del]").onclick = () => {
      confirmDialog(`确认删除事项 ${a.item_no}？反馈对象与状态历史会一并删除。`, async () => {
        try {
          await del(`/api/actions/${a.id}`);
          ok("已删除");
          await dlg.close();
          if (ctx.onChanged) await ctx.onChanged();
        } catch (e) { fail(e.message); }
      });
    };
    return dlg;
  }

  /* ------------------------------------------------------------ 出口 */

  const DETAIL = {
    standard: standardDetail,
    draft: draftDetail,
    meeting: meetingDetail,
    comment: commentDetail,
    action: actionDetail,
  };

  const recordLayers = [];
  const openingRecords = new Map();
  const MAX_RECORD_DEPTH = 4;

  async function open(kind, id, ctx = {}) {
    const detail = DETAIL[kind];
    if (!detail) { fail("不支持的记录类型"); return null; }
    const key = `${kind}:${id}`;

    // 目标已经在路径里：退回已有那层，不再重复创建，彻底阻断循环打开。
    const existingIndex = recordLayers.findIndex((layer) => layer.key === key);
    if (existingIndex >= 0) {
      while (recordLayers.length - 1 > existingIndex) {
        const top = recordLayers[recordLayers.length - 1];
        await top.dlg.close();
      }
      return recordLayers[existingIndex] ? recordLayers[existingIndex].dlg : null;
    }

    if (recordLayers.length >= MAX_RECORD_DEPTH) {
      fail("关联记录最多打开四层，请先返回上一级");
      return null;
    }
    if (openingRecords.has(key)) return openingRecords.get(key);

    const task = (async () => {
      try {
        const dlg = await detail(id, ctx);
        const layer = { key, dlg };
        recordLayers.push(layer);
        dlg.el.addEventListener("hidden.bs.modal", () => {
          const index = recordLayers.indexOf(layer);
          if (index >= 0) recordLayers.splice(index, 1);
        }, { once: true });
        return dlg;
      } catch (e) {
        fail(e.message || "记录打开失败");
        return null;
      } finally {
        openingRecords.delete(key);
      }
    })();
    openingRecords.set(key, task);
    return task;
  }

  window.Records = {
    open,
    standardForm, draftForm, meetingForm, commentForm, clauseForm, derive,
  };
})();
