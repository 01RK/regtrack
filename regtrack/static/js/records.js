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
          emptyRow, ok, fail, confirmDialog, confirmAsync, openModal, t, label } = window.App;
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

  /** 明细字段：[[英文名, 中文名, 值], ...]，值按纯文本显示。 */
  const kv = (rows) =>
    `<dl class="kv">${rows.map(([en, zh, v]) => `<dt>${label(en, zh)}</dt><dd>${v ? esc(v) : ""}</dd>`).join("")}</dl>`;

  /** 表头：[[英文名, 中文名], ...]；空字符串为操作列。 */
  const table = (head, rows, cols, emptyTitle, emptyHint) => `
    <div class="table-wrap"><table class="table">
      <thead><tr>${head.map((h) => `<th>${h ? label(h[0], h[1]) : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows || emptyRow(cols, emptyTitle, emptyHint)}</tbody>
    </table></div>`;

  const openBtn = (kind, id, text) =>
    `<button class="btn-link-quiet" data-open="${kind}:${id}">${esc(text)} →</button>`;

  /* ================================================== 1. 标准主档 */

  function standardSpec(isNew, values) {
    const spec = [
      { section: t("身份", "Identity") },
      { name: "std_no", label: "Standard No.", cn: "标准编号", type: "text", col: 6, placeholder: t("如 GB 38031—2025，可留空", "e.g. GB 38031—2025; optional") },
      { name: "plan_no", label: "Plan No.", cn: "计划号", type: "text", col: 6 },
      { name: "name_cn", label: "Standard Name CN", cn: "中文名称", type: "text", required: true, col: 6 },
      { name: "name_en", label: "Standard Name EN", cn: "英文名称", type: "text", col: 12 },
    ];
    if (isNew) {
      spec.push(
        { name: "stage_code", label: "Current Stage", cn: "当前阶段", type: "choices",
          options: M().stages.map((s) => ({ value: s.code, text: window.App.stageLabel(s.code), sub: t(s.note, "") })),
          required: true, col: 6,
          help: t("先登记现在所处的阶段；更早的阶段可以随后用「推进 / 补录阶段」补齐。",
                  "Record the stage it is in now; earlier stages can be added later with Advance / Backfill Stage.") },
        { name: "stage_effective_date", label: "Stage Entry Date", cn: "阶段进入日期", type: "date", col: 6,
          help: t("写入阶段历史第一条。", "Saved as the first stage history record.") });
    } else {
      spec.push({ name: "stage_display", label: "Current Stage", cn: "当前阶段", type: "auto", col: 12,
                  display: window.App.stageLabel(values.stage_code),
                  help: t("阶段信息请通过推进/补录阶段功能调整。", "Change stages with Advance / Backfill Stage.") });
    }
    return spec.concat([
      { section: t("归口与责任", "Ownership") },
      { name: "std_type", label: "Standard Type", cn: "标准类别", type: "fixed", options: M().standard_types, col: 4 },
      { name: "tc_wg", label: "TC / WG", cn: "归口技委会", type: "lookup", category: "tc_wg", col: 4 },
      { name: "responsible_authority", label: "Responsible Authority", cn: "主管机构", type: "lookup", category: "organization", col: 4 },
      { name: "leading_org", label: "Leading Organization", cn: "牵头起草单位", type: "lookup", category: "organization", col: 4 },
      { name: "mb_owner", label: "MB Owner", cn: "内部负责人", type: "lookup", category: "person", col: 4 },
      { name: "risk_level", label: "Current Risk Level", cn: "风险等级", type: "fixed", options: M().risk_levels, col: 4 },
      { name: "impact_area_list", label: "Main Impact Area", cn: "影响领域", type: "lookup", category: "impact_area", multiple: true, col: 12 },
      { section: t("时间与范围", "Dates and Scope") },
      { name: "planned_release_date", label: "Planned Release Date", cn: "预计发布日期", type: "date", col: 4 },
      { name: "actual_release_date", label: "Actual Release Date", cn: "实际发布日期", type: "date", col: 4 },
      { name: "effective_date", label: "Effective Date", cn: "实施日期", type: "date", col: 4 },
      { name: "scope", label: "Scope", cn: "适用范围", type: "textarea", rows: 3, col: 12 },
    ]);
  }

  /** 新建标准主档（已有标准在明细的「概览」里就地编辑）。 */
  function standardForm(ctx = {}) {
    Forms.formModal({
      title: t("新建标准主档", "New Standard Profile"),
      subtitle: "Standard Profile",
      fields: standardSpec(true, {}),
      values: { stage_code: M().stages[0].code, stage_effective_date: Forms.today() },
      submitText: t("建档", "Create"),
      async onSubmit(payload, m) {
        const saved = await post("/api/standards", payload);
        ok(t(`已建档 ${saved.std_no || saved.name_cn}`, `Created ${saved.std_no || saved.name_cn}`));
        await window.App.refreshLookups();
        await m.close();
        if (ctx.onChanged) await ctx.onChanged();
        open("standard", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
      },
    });
  }

  async function standardDetail(id, ctx) {
    let s = await get(`/api/standards/${id}`);
    const body = document.createElement("div");
    const dlg = shell(ctx, {
      title: `${s.std_no || s.plan_no || ""} ${s.name_cn}`,
      subtitle: t("Standard Profile · 标准主档", "Standard Profile"),
      body,
      footer: `<button class="btn btn-outline-danger btn-sm" data-delete>${window.App.uiText("删除", "Delete")}</button>
               <button class="btn btn-outline-secondary btn-sm" data-archive></button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-stage>${window.App.uiText("推进 / 补录阶段", "Advance / Backfill Stage")}</button>
                 <button class="btn btn-outline-secondary btn-sm" data-edit>${window.App.uiText("编辑", "Edit")}</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">${window.App.uiText("关闭", "Close")}</button>
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
      title: `${s.std_no || s.plan_no || ""} ${s.name_cn}`,
      stage: window.App.stageLabel(s.stage_code),
      timeline: s.stage_timeline,
      onDone: refresh,
    });

    function render(keepTab) {
      dlg.footer.querySelector("[data-archive]").textContent = s.archived ? t("恢复", "Restore") : t("归档", "Archive");
      body.innerHTML = `
        ${s.archived ? `<div class="stage-banner">${t("本标准已归档：数据完整保留，但不在正常列表中展示。", "This standard is archived: all data is kept but it is hidden from normal lists.")}</div>` : ""}
        ${Stages.timelineHtml(s.stage_timeline)}
        <div class="form-text" style="margin-top:6px">${t("点击时间轴上的阶段可查看详情；当前阶段之前尚未填写的阶段可就地补录。", "Click a stage on the timeline for details; missing stages before the current one can be backfilled there.")}</div>
        <ul class="nav nav-tabs" style="margin-top:14px" role="tablist">
          ${tabBtn("ov", t("概览", "Overview"), "")}
          ${tabBtn("st", t("阶段历史", "Stage History"), s.stage_history.length)}
          ${tabBtn("dr", t("草案", "Drafts"), s.drafts.length)}
          ${tabBtn("mt", t("会议", "Meetings"), s.meetings.length)}
          ${tabBtn("cm", t("意见", "Opinions"), s.comments.length)}
          ${tabBtn("ac", t("事项", "Actions"), s.actions.length)}
        </ul>
        <div class="tab-content" style="padding-top:14px">
          <div class="tab-pane fade" id="p-ov">
            <section class="panel" style="margin-top:16px;padding:16px"><h3 class="h6">${t("阶段文件", "Stage files")}</h3>
            <div class="btn-row" style="flex-wrap:wrap">${[...M().stages.map(x=>({code:x.code,name:x.label,en:x.en})),{code:"OTHER",name:"其他",en:"Other"}].map(x=>`<a class="btn btn-outline-secondary btn-sm" href="/file-manager?scope=standard&owner_id=${s.id}&stage=${encodeURIComponent(x.code)}">${esc(t(x.name,x.en))}</a>`).join("")}</div></section><div data-inline-host></div></div>
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
      editor = InlineEdit.mount({
        host: body.querySelector("[data-inline-host]"), modal: dlg,
        title: t("标准主档", "Standard profile"),
        spec: standardSpec(false, s), values: s,
        extra: [["Created", "创建", `${s.created_by || "—"} · ${s.created_at}`],
                ["Last Updated", "最近修改", `${s.updated_by || "—"} · ${s.updated_at}`]],
        async save(payload) {
          await put(`/api/standards/${s.id}`, payload);
          await window.App.refreshLookups();
          await refresh();
        },
      });
    }
    let editor;

    const tabBtn = (key, label, count) =>
      `<li class="nav-item" role="presentation">
         <button class="nav-link" data-bs-toggle="tab" data-bs-target="#p-${key}" type="button">${esc(label)}
           ${count !== "" ? `<span class="cnt">${count}</span>` : ""}
         </button></li>`;

    const draftTable = (rows) => table(
      [["Version", "版本"], ["Sub-Version", "子版本"], ["Draft Date", "草案日期"], ["Overall Impact", "总体影响"], ["Chapters", "章节"], ["Issued By", "发布方"], ""],
      rows.map((d) => `<tr>
        <td class="cell-main">${esc(d.version_name)}</td>
        <td class="num">${esc(d.sub_version_no)}</td>
        <td class="num">${esc(d.draft_date)}</td>
        <td>${tag(d.overall_impact)}</td>
        <td class="num">${d.clause_count}</td>
        <td>${dash(d.issued_by)}</td>
        <td>${openBtn("draft", d.id, t("打开草案", "Open draft"))}</td>
      </tr>`).join(""), 7, ["还没有登记草案", "No drafts yet"], ["在「草案登记」里把草案挂到这个标准上", "Register drafts for this standard in Draft Registry"]);

    const meetingTable = (rows) => table(
      [["Meeting No.", "会议号"], ["Meeting Title", "会议标题"], ["Date", "日期"], ["Type", "类型"], ""],
      rows.map((r) => `<tr>
        <td class="num">${esc(r.meeting_no)}</td>
        <td class="cell-main">${esc(r.title)}</td>
        <td class="num">${esc(r.meeting_date)}</td>
        <td>${dash(r.meeting_type)}</td>
        <td>${openBtn("meeting", r.id, t("打开会议", "Open meeting"))}</td>
      </tr>`).join(""), 5, ["还没有会议挂到这个标准", "No meetings linked yet"], ["在「工作组会议」里把标准挂进会议", "Link this standard to meetings in WG Meeting"]);

    const commentTable = (rows) => table(
      [["Comment No.", "意见号"], ["Draft and Clause", "草案与条款"], ["Comment Type", "意见类型"], ["Status", "状态"], ["Submitted By", "提交人"], ["Submission Date", "提交日期"], ""],
      rows.map((r) => `<tr>
        <td class="num">${esc(r.comment_no)}</td>
        <td class="cell-sub">${CommentView.reference(r)}</td>
        <td>${esc(r.comment_type)}</td>
        <td>${statusTag(r.status)}</td>
        <td>${esc(r.submitted_by)}</td>
        <td class="num">${dash(r.submission_date)}</td>
        <td>${openBtn("comment", r.id, t("打开意见", "Open opinion"))}</td>
      </tr>`).join(""), 7, ["还没有正式意见", "No opinions yet"], ["保存草案批注或导入意见后生成，也可由事项的反馈生成", "Created from draft annotations, opinion imports or action feedback"]);

    const actionTable = (rows) => table(
      [["Action No.", "事项号"], ["Type", "类型"], ["Title", "标题"], ["Status", "状态"], ["Priority", "优先级"], ["Due Date", "截止日期"], ""],
      rows.map((r) => `<tr>
        <td class="num">${esc(r.item_no)}</td>
        <td>${esc(r.item_type)}</td>
        <td class="cell-main">${esc(r.title)}</td>
        <td>${statusTag(r.current_status)}</td>
        <td>${tag(r.priority)}</td>
        <td class="num">${overdue(r.due_date) ? `<span class="tag high">${esc(r.due_date)}</span>` : dash(r.due_date)}</td>
        <td>${openBtn("action", r.id, t("打开事项", "Open action"))}</td>
      </tr>`).join(""), 7, ["还没有关联事项", "No actions yet"], ["在「事项」里新建，或从会议行内按钮派生", "Create one in Action Item, or derive it from a meeting"]);

    render("#p-ov");

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      bootstrap.Tab.getOrCreateInstance(body.querySelector('[data-bs-target="#p-ov"]')).show();
      editor.edit();
    };
    dlg.footer.querySelector("[data-stage]").onclick = () => {
      Stages.openForm(stageCtx());
    };
    const archiveBtn = dlg.footer.querySelector("[data-archive]");
    archiveBtn.onclick = () => {
      if (s.archived) {
        confirmDialog(t(`把 ${s.std_no} 从归档中恢复？恢复后重新出现在标准列表里。`, `Restore ${s.std_no} from the archive? It will appear in the standard list again.`), async () => {
          try {
            await post(`/api/standards/${s.id}/restore`);
            ok(t("已恢复", "Restored"));
            await refresh();
          } catch (e) { fail(e.message); }
        });
        return;
      }
      confirmDialog(
        t(`确认归档 ${s.std_no}？归档后它不再出现在正常列表中，但主档、阶段历史与全部关联记录都会保留，随时可以恢复。`,
          `Archive ${s.std_no}? It will be hidden from normal lists; the profile, stage history and all linked records are kept and can be restored at any time.`),
        async () => {
          try {
            await post(`/api/standards/${s.id}/archive`);
            ok(t("已归档", "Archived"));
            await refresh();
          } catch (e) { fail(e.message); }
        });
    };
    dlg.footer.querySelector("[data-delete]").onclick = () => deleteStandard(s, async () => {
      await dlg.close();
      if (ctx.onChanged) await ctx.onChanged();
    });
    Object.assign(dlg, { label: s.std_no || s.name_cn, refresh });
    return dlg;
  }

  /**
   * 永久删除标准：先列出将删除的记录数量，再要求输入标准号（无编号时输入名称）确认。
   * 会议保留，只解除挂载。
   */
  async function deleteStandard(s, onDeleted) {
    const scope = await get(`/api/standards/${s.id}/deletion`);
    const word = s.std_no || s.name_cn;
    const item = (zh, en, n) => `<li>${t(zh, en)}：<b>${n}</b></li>`;
    const dlg = openModal({
      title: t("永久删除标准", "Delete standard permanently"),
      size: "md",
      body: `<p style="font-size:13.5px;margin:0">${t("将永久删除", "This permanently deletes")} <b>${esc(s.std_no || "")} ${esc(s.name_cn)}</b> ${t("及其全部关联记录，无法撤销。", "and all linked records. This cannot be undone.")}</p>
        <div class="danger-impact">
          <b>${t("将一并删除", "Also deleted")}</b>
          <ul>
            ${item("草案版本（含原文章节、批注）", "Draft versions (with chapters and annotations)", scope.drafts)}
            ${item("草案附图文件", "Draft figure files", scope.images)}
            ${item("阶段与其他文件", "Stage and other files", scope.files)}
            ${item("意见（含状态历史）", "Opinions (with status history)", scope.comments)}
            ${item("标准比对", "Draft comparisons", scope.comparisons)}
            ${item("关联事项（含状态历史、反馈对象）", "Linked actions (with status history and recipients)", scope.actions)}
            <li>${t("阶段历史与影响领域", "Stage history and impact areas")}</li>
          </ul>
          <div class="kept" style="margin-top:8px">${t(`工作组会议保留：将从 ${scope.meetings} 场会议中解除挂载，挂载批注随之删除。`, `WG meetings are kept: the standard is unlinked from ${scope.meetings} meeting(s) and its notes there are removed.`)}</div>
        </div>
        <div class="form-text" style="margin-bottom:10px">${t("只想隐藏这项标准？请改用「归档」，数据会完整保留并可随时恢复。", "Only want to hide it? Use Archive instead; all data is kept and can be restored.")}</div>
        <label class="danger-confirm-label" for="delete-confirm">${t("请输入", "Type")} <code>${esc(word)}</code> ${t("以确认删除", "to confirm")}</label>
        <input id="delete-confirm" class="form-control form-control-sm mt-1" autocomplete="off">`,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${window.App.uiText("取消", "Cancel")}</button>
               <button class="btn btn-danger btn-sm" data-confirm disabled>${window.App.uiText("永久删除", "Delete permanently")}</button>`,
      onShown: (el) => el.querySelector("#delete-confirm").focus(),
    });
    const input = dlg.body.querySelector("#delete-confirm");
    const button = dlg.footer.querySelector("[data-confirm]");
    input.oninput = () => { button.disabled = input.value.trim() !== word; };
    button.onclick = async () => {
      try {
        await del(`/api/standards/${s.id}`);
        ok(t(`已删除 ${word}`, `${word} deleted`));
        await dlg.close();
        await onDeleted();
      } catch (e) { fail(e.message); }
    };
  }

  /* ================================================== 2. 草案登记 */

  const draftSpec = () => [
    { section: t("所属标准", "Standard") },
    { name: "standard_id", label: "Standard", cn: "所属标准", type: "standard", required: true, col: 12,
      help: t("先搜编号或名称；搜不到说明这个标准还没建档，用下拉底部的按钮建档后会自动选中。",
              "Search by number or name. If it is not found, create it with the button at the bottom of the list; it will be selected automatically.") },
    { section: t("版本信息", "Version") },
    { name: "version_name", label: "Version Name", cn: "版本名称", type: "fixed", options: M().version_names, required: true, col: 4 },
    { name: "sub_version_no", label: "Draft Sub-Version No.", cn: "子版本号", type: "text", required: true, col: 4, placeholder: "1.0" },
    { name: "draft_date", label: "Draft Date", cn: "草案日期", type: "date", required: true, col: 4 },
    { name: "issued_by", label: "Issued By", cn: "发布方", type: "lookup", category: "organization", col: 6 },
    { name: "overall_impact", label: "Overall Impact", cn: "总体影响", type: "fixed", options: M().overall_impacts, col: 6 },
    { name: "file_link", label: "Draft File / Link", cn: "原文位置", type: "text", col: 12, placeholder: t("https:// 或 \\\\共享盘\\路径", "https:// or \\\\share\\path") },
    { name: "main_summary", label: "Main Summary", cn: "主要内容", type: "textarea", rows: 3, col: 12 },
    { name: "notes", label: "Notes", cn: "备注", type: "textarea", rows: 2, col: 12 },
  ];

  /** 登记草案（已有草案在草案详情的「草案元数据」里就地编辑）。 */
  function draftForm(ctx = {}) {
    Forms.formModal({
      title: t("登记草案", "Register Draft"),
      subtitle: "Draft Registry",
      fields: draftSpec(),
      values: Object.assign({ draft_date: Forms.today() }, ctx.prefill || {}),
      submitText: t("登记", "Register"),
      async onSubmit(payload, m) {
        const saved = await post("/api/drafts", payload);
        ok(t("草案已登记", "Draft registered"));
        await m.close();
        if (ctx.onChanged) await ctx.onChanged();
        open("draft", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
      },
    });
  }

  /* ================================================== 3. 工作组会议 */

  const meetingSpec = () => [
    { section: t("会议基本信息", "Meeting") },
    { name: "title", label: "Meeting Title", cn: "会议标题", type: "text", required: true, col: 8 },
    { name: "meeting_date", label: "Meeting Date", cn: "开会日期", type: "date", required: true, col: 4 },
    { name: "meeting_type", label: "Meeting Type", cn: "会议类型", type: "fixed", options: M().meeting_types, col: 4 },
    { name: "organizer", label: "Organizer", cn: "组织方", type: "lookup", category: "organization", col: 4 },
    { name: "next_meeting_date", label: "Next Meeting Date", cn: "下次会议日期", type: "date", col: 4 },
    { name: "participants", label: "Participants", cn: "参会单位 / 人员", type: "textarea", rows: 2, col: 12 },
    { name: "key_discussions", label: "Key Discussions", cn: "讨论议题", type: "textarea", rows: 3, col: 12 },
    { name: "overall_conclusion", label: "Overall Conclusion", cn: "整体结论", type: "textarea", rows: 3, col: 12 },
    { name: "material_link", label: "Meeting Material / Minutes", cn: "会议材料 / 纪要", type: "text", col: 12 },
  ];

  /** 登记会议（已有会议在会议明细里就地编辑；涉及标准在明细的「涉及标准」里挂载 / 移除）。 */
  function meetingForm(ctx = {}) {
    const spec = meetingSpec().concat(
      { section: t("涉及标准", "Related Standards") },
      { name: "standard_ids", label: "Related Standards", type: "standard", multiple: true, col: 12,
        cn: "涉及标准",
        help: t("一场会议可同时挂多项标准，也可以先不挂，稍后在会议明细里补；搜不到可在下拉底部快速建档。",
                "A meeting can cover several standards. You can also add them later in the meeting detail; create missing standards from the bottom of the list.") });
    Forms.formModal({
      title: t("登记工作组会议", "Register WG Meeting"),
      subtitle: "WG Meeting",
      fields: spec,
      values: { meeting_date: Forms.today(), standard_ids: [] },
      submitText: t("登记会议", "Register meeting"),
      async onSubmit(payload, m) {
        const saved = await post("/api/meetings", payload);
        ok(t(`已登记 ${saved.meeting_no}`, `Registered ${saved.meeting_no}`));
        await m.close();
        if (ctx.onChanged) await ctx.onChanged();
        open("meeting", saved.id, { trail: trailOf(ctx), onChanged: ctx.onChanged });
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
      subtitle: t("WG Meeting · 工作组会议", "WG Meeting"),
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-del>${window.App.uiText("删除", "Delete")}</button>
               <div class="ms-auto btn-row">
                 <a class="btn btn-outline-primary btn-sm" href="/meetings/import?meeting_id=${id}">${window.App.uiText("导入纪要", "Import minutes")}</a>
                 <button class="btn btn-outline-secondary btn-sm" data-edit>${window.App.uiText("编辑会议", "Edit meeting")}</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">${window.App.uiText("关闭", "Close")}</button>
               </div>`,
    });

    const refresh = bubble(ctx, async () => { m = await get(`/api/meetings/${id}`); render(); });

    let editor;
    function render() {
      body.innerHTML = `
        <div data-inline-host></div>


        <div class="panel" style="margin-top:16px">
          <div class="panel-head">
            <h2>${window.App.uiText("涉及标准", "Related Standards")}</h2>
            <span class="hint">${t(`共 ${m.standards.length} 项 · 每项标准可单独写本会批注`, `${m.standards.length} standard(s) · each can have its own meeting note`)}</span>
          </div>
          <div class="panel-body">
            <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:12px">
              <div style="flex:1"><select id="attach-std"></select></div>
              <button class="btn btn-primary btn-sm" data-attach style="height:34px">${window.App.uiText("挂上标准", "Link standard")}</button>
            </div>
            ${MeetingStandards.render(m.standards, m, {showNotes:true})}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>${window.App.uiText("本会派生的事项", "Actions from this meeting")}</h2><span class="hint">${t(`共 ${m.actions.length} 条`, `${m.actions.length} item(s)`)}</span></div>
          <div class="panel-body tight table-wrap">
            <table class="table">
              <thead><tr><th>${label("Action No.", "事项号")}</th><th>${label("Type", "类型")}</th><th>${label("Title", "标题")}</th><th>${label("Related Standard", "关联标准")}</th><th>${label("Status", "状态")}</th></tr></thead>
              <tbody>${m.actions.length ? m.actions.map((a) => `
                <tr class="row-click meeting-action-row" data-open="action:${a.id}" tabindex="0" role="button" aria-label="${t("打开事项：", "Open action: ")}${esc(a.title)}">
                  <td class="num">${esc(a.item_no)}</td>
                  <td>${esc(a.item_type)}</td>
                  <td class="cell-main">${esc(a.title)}</td>
                  <td class="cell-sub meeting-action-standard"><div>${a.std_no ? esc(a.std_no) : "—"}</div>${a.name_cn ? `<div>${esc(a.name_cn)}</div>` : ""}</td>
                  <td>${statusTag(a.current_status)}</td>
                </tr>`).join("")
                : emptyRow(5, ["还没有派生事项", "No derived actions"], ["在上面标准行的按钮里一键派生", "Use the buttons on a standard row above"])}</tbody>
            </table>
          </div>
        </div>`;

      const ts = Fields.standard(body.querySelector("#attach-std"), { placeholder: t("搜索要挂上的标准…", "Search a standard to link…") });
      body.querySelector("[data-attach]").onclick = async () => {
        const sid = ts.getValue();
        if (!sid) { fail(t("请先选择标准", "Select a standard first")); return; }
        try {
          await post(`/api/meetings/${m.id}/standards`, { standard_id: Number(sid) });
          ok(t("已挂上标准", "Standard linked"));
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
            ? t("您正在取消挂载一份批注过 Note 的标准，如确认移除，Note 也将丢失。", "You are unlinking a standard that has a meeting note. The note will be lost.")
            : t("把这个标准从会议中移除？已派生的事项不受影响。", "Remove this standard from the meeting? Derived actions are not affected."));
          if (!yes) return;
          try {
            await del(`/api/meetings/${m.id}/standards/${b.dataset.detach}?drop_notes=1`);
            ok(t("已移除", "Removed"));
            await refresh();
          } catch (e) { fail(e.message); }
        };
      });
      bindLinks(body, ctx, m.meeting_no, refresh);
      editor = InlineEdit.mount({
        host: body.querySelector("[data-inline-host]"), modal: dlg,
        title: t("会议信息", "Meeting details"),
        spec: meetingSpec().flatMap((f, i) => i === 0
          ? [f, { name: "meeting_no", label: "Meeting No.", cn: "会议号", type: "auto", display: m.meeting_no }]
          : [f]),
        values: m,
        async save(payload) {
          await put(`/api/meetings/${m.id}`, payload);
          await window.App.refreshLookups();
          await refresh();
        },
      });
      body.querySelectorAll(".meeting-action-row").forEach((row) => {
        row.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            row.click();
          }
        };
      });
    }

    /** 编辑某一项标准在本次会议上的批注。
        一场会常常一次过好几项标准，各自的议论分开记，才不会糊成一段会议纪要。 */
    function editNote(s) {
      if (!s) return;
      Forms.inlineForm({
        host: body,
        title: `${t("本会批注", "Meeting note")} · ${s.std_no}`,
        subtitle: `${m.meeting_no} · ${t("涉及标准", "Related Standards")}`,
        size: "md",
        fields: [
          { name: "std", label: "Standard", cn: "标准", type: "auto", col: 12,
            display: `${s.std_no || s.plan_no || ""} ${s.name_cn}` },
          { name: "note", label: "Note", cn: "本会批注", type: "textarea",
            rows: 4, col: 12,
            help: t("只记这场会上关于这项标准的讨论；它属于这条挂载关系，取消挂载会一并删除。",
                    "Only this meeting's discussion of this standard. It belongs to the link and is deleted when the standard is unlinked.") },
        ],
        values: { note: s.note || "" },
        async onSubmit(payload, modal) {
          await put(`/api/meetings/${m.id}/standards/${s.id}`, { note: payload.note });
          await modal.close();
          ok(payload.note.trim() ? t("批注已保存", "Note saved") : t("批注已清空", "Note cleared"));
          await refresh();
        },
      });
    }


    render();

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      body.scrollIntoView({ block: "start" });
      editor.edit();
    };
    dlg.footer.querySelector("[data-del]").onclick = () => {
      confirmDialog(t(`确认删除会议 ${m.meeting_no}？派生的事项会保留，但不再关联会议。`, `Delete meeting ${m.meeting_no}? Derived actions are kept but no longer linked to it.`), async () => {
        try {
          await del(`/api/meetings/${m.id}`);
          ok(t("已删除", "Deleted"));
          await dlg.close();
          if (ctx.onChanged) await ctx.onChanged();
        } catch (e) { fail(e.message); }
      });
    };
    Object.assign(dlg, { label: m.meeting_no, refresh });
    return dlg;
  }

  /* ================================================== 4. 意见矩阵 */

  function commentSpec(isNew, values) {
    const locked = !!(values.source_annotation_id || values.comparison_id);
    const comparison = values.source_kind === "comparison";
    const wholeHelp = t("条款编号留空即整份草案范围。", "Leave the clause number empty for whole-draft scope.");
    const sourceOptions = Object.keys(M().comment_sources).map((value) => ({ value, text: CommentView.sourceLabel(value) }));
    const s = [
      { section: t("来源与范围", "Source and scope") },
      locked
        ? { name: "source_kind", label: "Source", cn: "意见来源", type: "auto", submit: true, col: 6, display: CommentView.sourceLabel(values.source_kind) }
        : { name: "source_kind", label: "Source", cn: "意见来源", type: "choices", required: true, col: 6, options: sourceOptions },
      locked
        ? { name: "standard_id", label: "Standard", cn: "标准", type: "auto", submit: true, col: 6, display: values.name_cn }
        : { name: "standard_id", label: "Standard", cn: "标准", type: "standard", required: true, col: 6 },
    ];
    if (comparison) {
      s.push(
        { section: t("前一版草案", "Before draft") },
        { name: "before_draft_id", label: "Before Draft", cn: "前一版草案", type: "draft", dependsOn: "standard_id", required: true, col: 6 },
        { name: "before_clause_no", label: "Before Clause No.", cn: "前版条款号", type: "text", col: 6, help: wholeHelp },
        { section: t("后一版草案", "After draft") },
        { name: "after_draft_id", label: "After Draft", cn: "后一版草案", type: "draft", dependsOn: "standard_id", required: true, col: 6 },
        { name: "after_clause_no", label: "After Clause No.", cn: "后版条款号", type: "text", col: 6, help: wholeHelp });
    } else {
      s.push(locked
        ? { name: "draft_id", label: "Related Draft", cn: "关联草案", type: "auto", submit: true, col: 6,
            display: `${values.version_name} v${values.sub_version_no}` }
        : { name: "draft_id", label: "Related Draft", cn: "关联草案", type: "draft", dependsOn: "standard_id", required: true, col: 6 },
        locked
        ? { name: "clause_no", label: "Clause No.", cn: "条款号", type: "auto", submit: true, col: 6, display: values.clause_no || t("整份草案", "Whole draft") }
        : { name: "clause_no", label: "Clause No.", cn: "条款号", type: "text", col: 6, help: wholeHelp });
    }
    s.push(
      { section: t("意见内容", "Comment / Proposal") },
      { name: "comment_type", label: "Comment Type", cn: "意见类型", type: "fixed", options: M().annotation_types, required: true, col: 6 },
      { name: "comment_text", label: "Comment / Proposal", cn: "意见内容", type: "textarea", rows: 5, required: true, col: 12 },
      { section: t("提交与跟进", "Submission and follow-up") },
      { name: "needs_follow_up", label: "Follow-up required", cn: "需要后续跟进", type: "checkbox", col: 6 },
      { name: "status", label: "Comment Status", cn: "意见状态", type: "auto", col: 6, display: values.status },
      { name: "submitted_by", label: "Submitted By", cn: "提交人", type: "lookup", category: "person", required: true, col: 4 },
      { name: "submission_date", label: "Submission Date", cn: "提交日期", type: "date", col: 4 },
      { name: "submission_channel", label: "Submission Channel", cn: "提交渠道", type: "auto", col: 12, display: M().comment_sources[values.source_kind] });
    if (values.comparison_id) {
      for (const field of s) {
        if (['before_draft_id','after_draft_id','before_clause_no','after_clause_no'].includes(field.name)) {
          field.type = 'auto'; field.submit = true;
          field.display = field.name.endsWith('_draft_id')
            ? `${values[field.name.replace('_draft_id','_version_name')]} v${values[field.name.replace('_draft_id','_sub_version_no')]}`
            : values[field.name];
        }
      }
    }
    return s;
  }

  function commentForm(values, ctx = {}) {
    const isNew = !values;
    const v = values || Object.assign({ status: "Draft", source_kind: "single", comment_type: "Proposed Change", submitted_by: window.App.user }, ctx.prefill || {});
    if (isNew && v.needs_follow_up == null) v.needs_follow_up = true;
    const ctl = (isNew ? Forms.formModal : Forms.inlineForm)({
      host: ctx.host,
      title: isNew ? t("新建意见", "New opinion") : `${t("编辑", "Edit")} ${v.comment_no}`,
      subtitle: "Comment Matrix",
      fields: vals => commentSpec(isNew, vals),
      rebuildOn: isNew ? ["source_kind"] : [],
      values: v,
      after: (host, form) => { if (!isNew) OpinionHistory.mount(host, form, v); },
      submitText: isNew ? t("保存意见", "Save opinion") : t("保存修改", "Save changes"),
      extraFooter: isNew
        ? `<button class="btn btn-outline-secondary btn-sm me-auto" data-newstd>${window.App.uiText("搜不到标准？新建标准主档", "Standard not listed? Create it")}</button>`
        : "",
      async onSubmit(payload, m, form) {
        if (!isNew) {
          const update = OpinionHistory.read(form);
          if (update) payload.status_update = update;
        }
        if (v.source_annotation_id) payload.source_annotation_id = v.source_annotation_id;
        const unused = payload.source_kind === "comparison"
          ? ["draft_id", "clause_no"] : ["before_draft_id", "before_clause_no", "after_draft_id", "after_clause_no"];
        unused.forEach(name => payload[name] = null);
        const saved = isNew
          ? await post("/api/comments", payload)
          : await put(`/api/comments/${v.id}`, payload);
        ok(isNew ? t(`已保存 ${saved.comment_no}`, `Saved ${saved.comment_no}`) : t("已保存", "Saved"));
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
      subtitle: t("Comment Matrix · 意见", "Comment Matrix · Opinion"),
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-del>${window.App.uiText("删除", "Delete")}</button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-edit>${window.App.uiText("编辑", "Edit")}</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">${window.App.uiText("关闭", "Close")}</button>
               </div>`,
    });

    const refresh = bubble(ctx, async () => { c = await get(`/api/comments/${id}`); render(); });

    function render() {
      body.innerHTML = `
        <dl class="kv">
          <dt>${label("Comment No.", "意见号")}</dt><dd>${esc(c.comment_no)}（${t("系统自动", "Automatic")}）</dd>
          <dt>${label("Standard", "标准")}</dt><dd>${esc(c.std_no)} ${esc(c.name_cn)}</dd>
          <dt>${label("Comment Type", "意见类型")}</dt><dd>${esc(c.comment_type)}</dd>
          <dt>${label("Related Draft and Clause", "关联草案与条款")}</dt><dd>${CommentView.reference(c)}</dd>
          <dt>${label("Comment / Proposal", "意见内容")}</dt><dd>${esc(c.comment_text)}</dd>
          <dt>${label("Comment Status", "意见状态")}</dt><dd>${esc(c.status)}</dd>
          <dt>${label("Submitted By", "提交人")}</dt><dd>${esc(c.submitted_by)}</dd>
          <dt>${label("Submission Channel", "提交渠道")}</dt><dd>${c.submission_channel ? esc(c.submission_channel) : ""}</dd>
          <dt>${label("Submission Date", "提交日期")}</dt><dd>${c.submission_date ? esc(c.submission_date) : ""}</dd>
        </dl>
        <div class="panel" style="margin-top:16px">
          <div class="panel-head"><h2>${window.App.uiText("意见状态历史", "Comment Status History")}</h2>
            <span class="hint">${t(`共 ${c.status_history.length} 条`, `${c.status_history.length} records`)}</span></div>
          <div class="panel-body">${OpinionHistory.table(c.status_history)}</div>
        </div>`;
      bindLinks(body, ctx, c.comment_no, refresh);
    }
    render();

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      commentForm(c, { host: body, trail: trailOf(ctx), onChanged: refresh });
    };
    dlg.footer.querySelector("[data-del]").onclick = () => {
      confirmDialog(t(`确认删除意见 ${c.comment_no}？其状态历史会一并删除。`, `Delete opinion ${c.comment_no}? Its status history will also be deleted.`), async () => {
        try {
          await del(`/api/comments/${c.id}`);
          ok(t("已删除", "Deleted"));
          await dlg.close();
          if (ctx.onChanged) await ctx.onChanged();
        } catch (e) { fail(e.message); }
      });
    };
    Object.assign(dlg, { label: c.comment_no, refresh });
    return dlg;
  }

  /* ================================================== 5. 事项 */

  const TYPE_KV = {
    "Survey Feedback": [["Requesting Body", "提出要求的机构", "requesting_body"], ["Submission Due Date", "上达截止日期", "submission_due_date"],
                        ["Submission Channel", "上达渠道", "submission_channel"]],
    "Lobby with Drafter": [["Drafter / Counterpart", "起草人 / 对口机构", "drafter_counterpart"], ["Target Position", "目标立场", "target_position"],
                           ["Actual Lobby Time", "实际沟通时间", "actual_lobby_time"], ["Lobby Method", "沟通方式", "lobby_method"], ["Outcome", "沟通结果", "outcome"]],
    "Compliance Check": [["Responsible Person / Team", "核查负责人 / 团队", "check_owner"], ["Due Date", "截止日期", "check_due_date"],
                         ["Actual Check Time", "实际完成时间", "actual_check_time"], ["Check Result", "核查结论", "check_result"],
                         ["Gap Description", "差距说明", "gap_description"]],
    Others: [["Coordinator", "协调人", "coordinator"], ["Target Date", "目标完成日期", "target_date"]],
    "Collect Comments": [],
  };

  async function actionDetail(id, ctx) {
    let a = await get(`/api/actions/${id}`);
    const body = document.createElement("div");
    const dlg = shell(ctx, {
      title: `${a.item_no} · ${a.title}`,
      subtitle: `Action Item · ${ActionForm.typeText(a.item_type)}`,
      body,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-del>${window.App.uiText("删除", "Delete")}</button>
               <div class="ms-auto btn-row">
                 <button class="btn btn-outline-secondary btn-sm" data-status>${window.App.uiText("更新状态", "Update status")}</button>
                 <button class="btn btn-outline-secondary btn-sm" data-edit>${window.App.uiText("编辑", "Edit")}</button>
                 <button class="btn btn-primary btn-sm" data-bs-dismiss="modal">${window.App.uiText("关闭", "Close")}</button>
               </div>`,
    });

    const refresh = bubble(ctx, async () => { a = await get(`/api/actions/${id}`); render(); });

    function render() {
      const rows = [
        ["Related Standard", "关联标准", a.std_no ? `${a.std_no} ${a.name_cn}` : ""],
        ["Related Meeting", "关联会议", a.meeting_no ? `${a.meeting_no} ${a.meeting_title}` : ""],
        ["Related Draft", "关联草案", a.version_name ? `${a.version_name} v${a.sub_version_no}` : ""],
        ["Item No.", "事项号", `${a.item_no}（${t("系统自动", "Automatic")}）`],
        ["Item Type", "事项类型", ActionForm.typeText(a.item_type)],
        ["Title", "标题", a.title], ["Description", "描述", a.description],
        ["Related Clause", "关联条款", a.related_clause], ["Priority", "优先级", a.priority],
        ["Current Status", "当前状态", a.current_status],
      ].concat(TYPE_KV[a.item_type].map(([en, zh, key]) => [en, zh, a[key]]))
       .concat([["Final Summary", "结论", a.final_summary], ["Supporting Reference", "支撑材料", a.supporting_ref]]);

      body.innerHTML = `
        ${kv(rows)}
        ${a.item_type === "Collect Comments" ? recipientsPanel() : ""}
        <div class="panel" style="margin-top:16px">
          <div class="panel-head"><h2>${window.App.uiText("状态历史", "Status History")}</h2><span class="hint">${t(`共 ${a.status_history.length} 条`, `${a.status_history.length} records`)}</span></div>
          <div class="panel-body">${Forms.historyList(a.status_history)}</div>
        </div>`;

      const addBtn = body.querySelector("[data-addrec]");
      if (addBtn) addBtn.onclick = () => recipientForm(null);
      body.querySelectorAll("[data-editrec]").forEach((b) => {
        b.onclick = () => recipientForm(a.recipients.find((r) => r.id === Number(b.dataset.editrec)));
      });
      body.querySelectorAll("[data-delrec]").forEach((b) => {
        b.onclick = () => confirmDialog(t("删除这个反馈对象？", "Delete this feedback recipient?"), async () => {
          try {
            await del(`/api/actions/recipients/${b.dataset.delrec}`);
            ok(t("已删除", "Deleted"));
            await refresh();
          } catch (e) { fail(e.message); }
        });
      });
      bindLinks(body, ctx, a.item_no, refresh);
    }

    const recipientsPanel = () => `
      <div class="panel recipient-panel" style="margin-top:16px">
        <div class="panel-head">
          <h2>${window.App.uiText("反馈对象", "Feedback Recipients")}</h2>
          <span class="hint">${t(`已回复 ${a.responded_count}/${a.recipient_count} · 全部回复后事项自动完成`, `${a.responded_count}/${a.recipient_count} responded · the action completes automatically when all have responded`)}</span>
          <button class="btn btn-outline-secondary btn-sm ms-auto" data-addrec>${window.App.uiText("+ 添加反馈对象", "+ Add recipient")}</button>
        </div>
        <div class="panel-body tight table-wrap">
          <table class="table recipient-table">
            <colgroup><col style="width:17%"><col style="width:12%"><col style="width:13%"><col style="width:12%"><col style="width:12%"><col><col style="width:116px"></colgroup>
            <thead><tr>
              <th>${label("Team", "团队")}</th><th>${label("Person", "人员")}</th><th>${label("Response Status", "回复状态")}</th><th>${label("Due Date", "要求回复")}</th><th>${label("Actual Date", "实际回复")}</th>
              <th>${label("Response Summary", "回复摘要")}</th><th></th>
            </tr></thead>
            <tbody>${a.recipients.map((r) => `
              <tr>
                <td>${dash(r.respondent_team)}</td>
                <td>${dash(r.respondent_person)}</td>
                <td>${statusTag(r.response_status)}</td>
                <td class="num">${overdue(r.response_due_date) && r.response_status === "Open"
                    ? `<span class="tag high">${esc(r.response_due_date)}</span>` : dash(r.response_due_date)}</td>
                <td class="num">${dash(r.response_actual_date)}</td>
                <td class="cell-sub recipient-summary">${dash(r.response_summary)}</td>
                <td class="recipient-actions">
                  <button class="btn-link-quiet" data-editrec="${r.id}">${window.App.uiText("编辑", "Edit")}</button>
                  <button class="btn-link-quiet text-danger" data-delrec="${r.id}" ${a.recipients.length === 1 ? `disabled title="${t("至少保留 1 个反馈对象", "Keep at least one recipient")}"` : ""}>${window.App.uiText("删除", "Delete")}</button>
                </td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
      </div>`;

    function recipientForm(r) {
      (r ? Forms.inlineForm : Forms.formModal)({
        host: body,
        title: r ? t("编辑反馈对象", "Edit Recipient") : t("添加反馈对象", "Add Recipient"),
        subtitle: "Subform · Feedback Recipients",
        size: "lg",
        fields: [
          { name: "respondent_team", label: "Respondent Team", cn: "征集团队", type: "lookup", category: "team", col: 6 },
          { name: "respondent_person", label: "Respondent Person", cn: "征集人员", type: "lookup", category: "person", col: 6,
            help: t("Team 与 Person 至少填一个。", "Fill in at least Team or Person.") },
          { name: "response_status", label: "Response Status", cn: "回复状态", type: "fixed", options: M().response_statuses, required: true, col: 4 },
          { name: "response_due_date", label: "Response Due Date", cn: "要求回复日期", type: "date", col: 4 },
          { name: "response_actual_date", label: "Response Actual Date", cn: "实际回复日期", type: "date", col: 4 },
          { name: "response_summary", label: "Response Summary", cn: "回复摘要", type: "textarea", rows: 3, col: 12,
            help: t("记录对方回复的要点。回复状态改为 Open 以外的值后，全部反馈对象都回复时事项会自动置为 Completed。",
                    "Key points of the reply. Once every recipient's status is no longer Open, the action is set to Completed automatically.") },
        ],
        values: r || { response_status: "Open" },
        submitText: r ? t("保存", "Save") : t("添加", "Add"),
        async onSubmit(payload, m) {
          if (r) await put(`/api/actions/recipients/${r.id}`, payload);
          else await post(`/api/actions/${a.id}/recipients`, payload);
          ok(r ? t("已保存", "Saved") : t("已添加反馈对象", "Recipient added"));
          await m.close();
          const before = a.current_status;
          await refresh();
          if (a.current_status !== before) {
            ok(a.current_status === "Completed"
              ? t("全部反馈对象均已回复，事项已自动置为 Completed", "All recipients have responded; the action is now Completed")
              : t("有反馈对象尚未回复，事项已恢复为 In Progress", "A recipient is open again; the action is back to In Progress"));
          }
        },
      });
    }

    render();

    dlg.footer.querySelector("[data-edit]").onclick = () => {
      ActionForm.open({
        isNew: false,
        host: body,
        values: a,
        onSaved: refresh,
      });
    };
    dlg.footer.querySelector("[data-status]").onclick = () => {
      Forms.statusModal({
        title: `${t("更新状态", "Update status")} · ${a.item_no}`,
        subtitle: t("事项状态历史", "Action status history"),
        current: a.current_status,
        options: M().action_statuses,
        valueLabel: "New Status",
        url: `/api/actions/${a.id}/status-history`,
        onDone: refresh,
      });
    };
    dlg.footer.querySelector("[data-del]").onclick = () => {
      confirmDialog(t(`确认删除事项 ${a.item_no}？反馈对象与状态历史会一并删除。`, `Delete action ${a.item_no}? Its recipients and status history will also be deleted.`), async () => {
        try {
          await del(`/api/actions/${a.id}`);
          ok(t("已删除", "Deleted"));
          await dlg.close();
          if (ctx.onChanged) await ctx.onChanged();
        } catch (e) { fail(e.message); }
      });
    };
    Object.assign(dlg, { label: a.item_no, refresh });
    return dlg;
  }

  /* ------------------------------------------------------------ 出口 */

  const DETAIL = {
    standard: standardDetail,

    meeting: meetingDetail,
    comment: commentDetail,
    action: actionDetail,
  };

  const recordLayers = [];
  const openingRecords = new Map();
  const MAX_RECORD_DEPTH = 4;

  async function open(kind, id, ctx = {}) {
    if (kind === "draft") { window.location.href = `/drafts/${id}`; return; }
    const detail = DETAIL[kind];
    if (!detail) { fail(t("不支持的记录类型", "Unsupported record type")); return null; }
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
      fail(t("关联记录最多打开四层，请先返回上一级", "Up to four linked records can be open. Go back one level first."));
      return null;
    }
    if (openingRecords.has(key)) return openingRecords.get(key);

    const task = (async () => {
      try {
        const dlg = await detail(id, ctx);
        const layer = { key, dlg };
        recordLayers.push(layer);
        syncUrl();
        dlg.el.addEventListener("hidden.bs.modal", () => {
          const index = recordLayers.indexOf(layer);
          if (index >= 0) recordLayers.splice(index, 1);
          syncUrl();
        }, { once: true });
        return dlg;
      } catch (e) {
        fail(e.message || t("记录打开失败", "Failed to open the record"));
        return null;
      } finally {
        openingRecords.delete(key);
      }
    })();
    openingRecords.set(key, task);
    return task;
  }

  /* 弹窗层级写在地址的 records 参数里（如 ?records=standard:5,action:3）：
     从弹窗进入整页视图（草案详情等）后点「返回」、或刷新页面，都能按原层级重新打开。 */
  function syncUrl() {
    const url = new URL(location.href);
    if (recordLayers.length) url.searchParams.set("records", recordLayers.map((layer) => layer.key).join(","));
    else url.searchParams.delete("records");
    history.replaceState(history.state, "", url);
  }

  /** 页面载入后按地址里的 records 参数逐层重开弹窗；ctx 为页面自己的上下文（列表刷新等）。 */
  async function restore(ctx = {}) {
    const keys = (new URLSearchParams(location.search).get("records") || "").split(",").filter(Boolean);
    let current = ctx;
    for (const key of keys) {
      const [kind, rid] = key.split(":");
      const dlg = await open(kind, Number(rid), current);
      if (!dlg) return;
      current = { trail: trailOf(current).concat(dlg.label), onChanged: dlg.refresh };
    }
  }

  window.Records = {
    open, restore, draftSpec,
    standardForm, draftForm, meetingForm, commentForm, derive,
  };
})();
