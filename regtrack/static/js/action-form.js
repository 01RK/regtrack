/* Action Item 录入表单。
   会议行内派生按钮与「事项」页共用同一份定义：类型决定显示哪些字段，
   从会议进入时会议与标准已带好，同事只补事项本身的少量信息。 */
(function () {
  "use strict";

  const { esc, post, put, ok } = window.App;

  const TYPE_LABEL = {
    "Survey Feedback": "问卷 / 意见上达",
    "Collect Comments": "征集意见",
    "Lobby with Drafter": "与起草人沟通",
    "Compliance Check": "内部合规核查",
    Others: "其他",
  };

  function typeFields(type, M) {
    switch (type) {
      case "Survey Feedback":
        return [
          { section: "① Survey Feedback 特有字段" },
          { name: "requesting_body", label: "Requesting Body", cn: "提出要求的工作组 / 机构", type: "lookup", category: "organization", required: true, col: 4 },
          { name: "submission_due_date", label: "Submission Due Date", cn: "上达截止日期", type: "date", required: true, col: 4 },
          { name: "submission_channel", label: "Submission Channel", cn: "上达渠道", type: "fixed", options: M.submission_channels, col: 4 },
        ];
      case "Lobby with Drafter":
        return [
          { section: "③ Lobby with Drafter 特有字段" },
          { name: "drafter_counterpart", label: "Drafter / Counterpart", cn: "起草人 / 对口机构", type: "text", required: true, col: 6 },
          { name: "target_position", label: "Target Position", cn: "我方希望传达的立场", type: "textarea", rows: 3, required: true, col: 12 },
          { name: "actual_lobby_time", label: "Actual Lobby Time", cn: "实际沟通时间", type: "date", col: 4 },
          { name: "lobby_method", label: "Method", cn: "沟通方式", type: "fixed", options: M.lobby_methods, col: 4 },
          { name: "outcome", label: "Outcome", cn: "沟通结果", type: "textarea", rows: 3, col: 12 },
        ];
      case "Compliance Check":
        return [
          { section: "④ Compliance Check 特有字段" },
          { name: "check_owner", label: "Responsible Person / Team", cn: "核查负责人 / 团队", type: "lookup", category: "person", required: true, col: 4 },
          { name: "check_due_date", label: "Due Date", cn: "核查截止日期", type: "date", required: true, col: 4 },
          { name: "actual_check_time", label: "Actual Check Time", cn: "实际完成时间", type: "date", col: 4 },
          { name: "check_result", label: "Check Result", cn: "核查结论", type: "fixed", options: M.check_results, col: 4,
            help: "事项置为 Completed / Closed 前必须填写。" },
          { name: "gap_description", label: "Gap Description", cn: "差距具体在哪", type: "textarea", rows: 3, col: 12 },
        ];
      case "Others":
        return [
          { section: "⑤ Others 特有字段" },
          { name: "coordinator", label: "Coordinator", cn: "协调人", type: "lookup", category: "person", required: true, col: 6 },
          { name: "target_date", label: "Target Date", cn: "目标完成日期", type: "date", col: 6 },
        ];
      default:
        return [];
    }
  }

  function spec(vals, isNew, locked, typeLocked) {
    const M = window.App.meta;
    const type = vals.item_type || "Survey Feedback";
    const head = [{ section: "顶层共有字段" }];

    head.push((isNew && !typeLocked)
      ? { name: "item_type", label: "Item Type", cn: "事项类型（决定下方字段）", type: "fixed", options: M.action_types, required: true, col: 4 }
      : { name: "item_type", label: "Item Type", cn: "事项类型", type: "auto", submit: true, col: 4, display: `${type} · ${TYPE_LABEL[type]}` });

    head.push(locked && locked.standard
      ? { name: "standard_id", label: "Related Standard", cn: "关联标准", type: "auto", submit: true, col: 8, display: locked.standard }
      : { name: "standard_id", label: "Related Standard", cn: type === "Others" ? "关联标准（Others 可空）" : "关联标准", type: "standard", required: type !== "Others", col: 8 });

    head.push(locked && locked.meeting
      ? { name: "meeting_id", label: "Related Meeting", cn: "关联会议", type: "auto", submit: true, col: 6, display: locked.meeting }
      : { name: "meeting_id", label: "Related Meeting", cn: "关联会议", type: "meeting", col: 6 });

    head.push({ name: "draft_id", label: "Related Draft", cn: "关联草案（按标准过滤）", type: "draft", dependsOn: "standard_id", col: 6 });
    head.push(
      { name: "title", label: "Title", cn: "事项标题", type: "text", required: true, col: 12 },
      { name: "description", label: "Description", cn: "要解决什么问题", type: "textarea", rows: 3, required: true, col: 12 },
      { name: "related_clause", label: "Related Clause", cn: "关联条款号（可多填）", type: "text", col: 4, placeholder: "5.2.2, 5.4.1" },
      { name: "priority", label: "Priority", cn: "优先级", type: "fixed", options: M.priorities, col: 4 });

    head.push(isNew
      ? { name: "current_status", label: "Current Status", cn: "当前状态", type: "fixed", options: M.action_statuses, required: true, col: 4 }
      : { name: "current_status", label: "Current Status", cn: "当前状态", type: "auto", col: 4, display: vals.current_status,
          help: "状态通过「状态历史」推进。" });

    return head
      .concat(typeFields(type, M))
      .concat([
        { section: "收尾" },
        { name: "final_summary", label: "Final Summary", cn: "完成 / 关闭时的结论", type: "textarea", rows: 2, col: 12 },
        { name: "supporting_ref", label: "Supporting Reference", cn: "支撑材料位置", type: "text", col: 12 },
      ]);
  }

  /* ------------------------------ Collect Comments 的反馈对象编辑器 */
  function recipientEditor(bodyEl, rows) {
    const M = window.App.meta;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.marginTop = "16px";
    bodyEl.appendChild(panel);

    function draw() {
      panel.innerHTML = `
        <div class="panel-head">
          <h2>② 反馈对象 · Feedback Recipients</h2>
          <span class="hint">至少 1 个；Team 与 Person 至少填一个</span>
          <button class="btn btn-outline-secondary btn-sm ms-auto" data-add>+ 添加反馈对象</button>
        </div>
        <div class="panel-body tight table-wrap">
          <table class="table">
            <thead><tr><th>Team</th><th>Person</th><th>回复状态</th><th>要求回复日期</th><th></th></tr></thead>
            <tbody>${rows.length ? rows.map((r, i) => `
              <tr>
                <td>${esc(r.respondent_team || "—")}</td>
                <td>${esc(r.respondent_person || "—")}</td>
                <td>${esc(r.response_status)}</td>
                <td class="num">${esc(r.response_due_date || "—")}</td>
                <td><button class="btn-link-quiet" data-rm="${i}">移除</button></td>
              </tr>`).join("")
              : '<tr><td colspan="5"><div class="empty">还没有反馈对象，点右上角添加</div></td></tr>'}
            </tbody>
          </table>
        </div>`;
      panel.querySelector("[data-add]").onclick = addRow;
      panel.querySelectorAll("[data-rm]").forEach((b) => {
        b.onclick = () => { rows.splice(Number(b.dataset.rm), 1); draw(); };
      });
    }

    function addRow() {
      Forms.formModal({
        title: "添加反馈对象",
        subtitle: "Subform · Feedback Recipients",
        size: "md",
        fields: [
          { name: "respondent_team", label: "Respondent Team", cn: "征集团队", type: "lookup", category: "team", col: 6 },
          { name: "respondent_person", label: "Respondent Person", cn: "征集人员", type: "lookup", category: "person", col: 6 },
          { name: "response_status", label: "Response Status", cn: "回复状态", type: "fixed", options: M.response_statuses, required: true, col: 6 },
          { name: "response_due_date", label: "Response Due Date", cn: "要求回复日期", type: "date", col: 6 },
        ],
        values: { response_status: "Open" },
        submitText: "添加",
        async onSubmit(payload, m) {
          if (!payload.respondent_team && !payload.respondent_person) {
            throw new Error("Team 与 Person 至少填一个");
          }
          rows.push(payload);
          await m.close();
          draw();
        },
      });
    }

    draw();
  }

  /**
   * 打开事项录入 / 编辑。
   * cfg: {values, isNew, locked:{standard, meeting}, onSaved}
   */
  function open(cfg) {
    const isNew = cfg.isNew !== false;
    const values = Object.assign({ item_type: "Survey Feedback", current_status: "Open" }, cfg.values || {});
    const recipients = [];

    Forms.formModal({
      title: isNew ? "新建事项" : `编辑 ${values.item_no}`,
      subtitle: "Action Item · 事项",
      size: "xl",
      fields: (v) => spec(v, isNew, cfg.locked, cfg.typeLocked),
      values,
      rebuildOn: isNew && !cfg.typeLocked ? ["item_type"] : [],
      submitText: isNew ? "创建事项" : "保存修改",
      after(bodyEl, form, vals) {
        if (isNew && vals.item_type === "Collect Comments") recipientEditor(bodyEl, recipients);
      },
      async onSubmit(payload, m) {
        // 类型在「新建 xx 事项」入口就已定死，表单里只作展示，这里兜底补齐，
        // 避免后端收不到 item_type 而报「取值不合法」。
        if (isNew && !payload.item_type) payload.item_type = values.item_type;
        if (cfg.locked && cfg.locked.standard_id) payload.standard_id = cfg.locked.standard_id;
        if (cfg.locked && cfg.locked.meeting_id) payload.meeting_id = cfg.locked.meeting_id;
        let saved;
        if (isNew) {
          if (payload.item_type === "Collect Comments") payload.recipients = recipients;
          saved = await post("/api/actions", payload);
          ok(`已创建事项 ${saved.item_no}`);
        } else {
          saved = await put(`/api/actions/${values.id}`, payload);
          ok("已保存");
        }
        await m.close();
        if (cfg.onSaved) await cfg.onSaved(saved);
      },
    });
  }

  window.ActionForm = { open, spec, TYPE_LABEL };
})();
