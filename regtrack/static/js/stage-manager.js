/* 阶段推进 / 补录。
 *
 * 一个入口，两种行为：选当前阶段之后的阶段就是正常推进，选当前阶段之前
 * 尚未填写的阶段就进入历史补录模式（弹窗顶部给出审计提示，日期可填真实
 * 发生时间）。已填写的阶段不锁定：点开时间轴上的任意一段都能更正日期、
 * 依据与说明，创建时间与最近修改时间一并显示，留痕交给这两个时间戳。
 */
(function () {
  "use strict";

  const { esc, dash, get, post, put, ok, fail, openModal, t, label, stageLabel } = window.App;

  const MODE = {
    ADVANCE: { key: "ADVANCE", label: t("正常推进", "Advance"), cls: "advance" },
    BACKFILL: { key: "BACKFILL", label: t("历史补录", "Backfill"), cls: "backfill" },
  };
  const modeLabel = (type) => MODE[type].label;

  const STATE_TEXT = {
    done: t("已完成", "Done"), current: t("当前阶段", "Current"),
    missing: t("未填写 · 可补录", "Missing · can backfill"), future: t("未进入", "Not reached"),
  };

  const warningText = () => t(window.App.meta.backfill_warning,
    "⚠ You are adding an earlier stage. Keep it consistent with external audit requirements.");

  /* ------------------------------------------------------------ 时间轴 */

  /** 标准明细里的阶段时间轴：每一段都能点开看详情 / 补录。 */
  function timelineHtml(timeline) {
    return `
      <div class="stage-track">
        ${timeline.map((st) => {
          const r = st.record;
          return `
          <button type="button" class="stage-step is-${st.state}" data-stage="${esc(st.code)}"
                  title="${esc(stageLabel(st.code))} · ${esc(STATE_TEXT[st.state])}">
            <span class="st-name">${esc(stageLabel(st.code))}</span>
            <span class="st-date">${r ? esc(r.effective_date) : esc(STATE_TEXT[st.state])}</span>
            ${r && r.record_type === MODE.BACKFILL.key
              ? `<span class="st-flag">${window.App.uiText("补录", "Backfill")}</span>` : ""}
          </button>`;
        }).join("")}
      </div>`;
  }

  /** 记录时间：创建时间必显示，改过的再补一行最近修改。 */
  function stampHtml(r) {
    return `<div class="meta">${t("创建于", "Created")} ${esc(r.created_at)} · ${t("记录人", "by")} ${esc(r.created_by)}</div>
      <div class="meta">${r.modified
        ? `${t("最近修改", "Last updated")} ${esc(r.updated_at)} · ${t("修改人", "by")} ${esc(r.updated_by || "—")}`
        : t("最近修改：未修改过", "Last updated: never")}</div>`;
  }

  /** 阶段记录列表（明细页「阶段历史」标签页）。 */
  function historyHtml(records) {
    if (!records.length) return `<div class="empty">${t("还没有阶段记录", "No stage records yet")}</div>`;
    return '<div class="timeline">' + records.map((r) => `
      <div class="ev">
        <div class="head">
          <span class="tag info">${esc(stageLabel(r.stage_code))}</span>
          <span class="tag ${r.record_type === MODE.BACKFILL.key ? "medium" : "muted"}">${esc(modeLabel(r.record_type))}</span>
          <span class="date num">${esc(r.effective_date)}</span>
        </div>
        ${stampHtml(r)}
        ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
        ${r.reference ? `<div class="meta">${t("依据：", "Reference: ")}${esc(r.reference)}</div>` : ""}
      </div>`).join("") + "</div>";
  }

  /* -------------------------------------------------- 推进 / 补录表单 */

  function modeOf(timeline, code) {
    const hit = timeline.find((s) => s.code === code);
    return hit && hit.state === "missing" ? MODE.BACKFILL : MODE.ADVANCE;
  }

  function stageOptions(timeline) {
    return timeline
      .filter((s) => s.state !== "current")
      .map((s) => ({
        value: s.code,
        text: stageLabel(s.code) + (s.record ? t("（已填写）", " (recorded)") : s.state === "missing" ? t("（补录）", " (backfill)") : ""),
        sub: s.record
          ? `${s.record.effective_date} · ${modeLabel(s.record.record_type)} · ${t("已填写，可在时间轴上点开修改", "recorded; edit it from the timeline")}`
          : s.state === "missing" ? t("当前阶段之前，尚未填写", "Before the current stage, not recorded") : t("按流程向后推进", "Advance along the process"),
        disabled: !!s.record,
      }));
  }

  /**
   * 打开「推进 / 补录阶段」。
   * cfg: {standardId, title, stage, timeline, preselect, onDone}
   */
  function openForm(cfg) {
    const timeline = cfg.timeline;
    const options = stageOptions(timeline);
    const selectable = options.filter((o) => !o.disabled);
    if (!selectable.length) {
      fail(t("所有阶段都已填写，没有可推进或补录的阶段", "All stages are recorded; nothing to advance or backfill"));
      return;
    }
    const initial = cfg.preselect && selectable.some((o) => o.value === cfg.preselect)
      ? cfg.preselect
      : selectable[0].value;

    Forms.inlineForm({
      title: `${t("推进 / 补录阶段", "Advance / Backfill Stage")} · ${cfg.title}`,
      subtitle: t("Standard Stage · 阶段管理", "Standard Stage"),
      size: "lg",
      rebuildOn: ["stage_code"],
      fields: (vals) => {
        const mode = modeOf(timeline, vals.stage_code);
        return [
          { name: "stage_code", label: "Target Stage", cn: "目标阶段", type: "choices",
            options, required: true, col: 6,
            help: t(`当前阶段：${cfg.stage}。选择靠后的阶段为正常推进，选择当前阶段之前尚未填写的阶段为历史补录。`,
                    `Current stage: ${cfg.stage}. A later stage advances the standard; an unrecorded earlier stage is a backfill.`) },
          { name: "effective_date", label: "Effective Date", cn: "生效日期", type: "date",
            required: true, col: 6,
            help: mode === MODE.BACKFILL
              ? t("补录可填写真实发生时间，不受当前阶段时间顺序限制。", "A backfill may use the actual date, regardless of the current stage date.")
              : t("正常推进的日期不得早于当前阶段的生效日期。", "The date cannot be earlier than the current stage's effective date.") },
          { name: "reference", label: "Supporting Reference", cn: "依据链接 / 路径", type: "text",
            col: 12, placeholder: t("https:// 或 \\\\共享盘\\路径", "https:// or \\\\share\\path") },
          { name: "note", label: "Note", cn: "备注", type: "textarea", rows: 2, col: 12 },
        ];
      },
      values: { stage_code: initial, effective_date: Forms.today() },
      after: (bodyEl, form, vals) => banner(bodyEl, modeOf(timeline, vals.stage_code)),
      submitText: t("记录阶段", "Record stage"),
      async onSubmit(payload, m) {
        const res = await post(`/api/standards/${cfg.standardId}/stages`, payload);
        const name = stageLabel(res.record.stage_code);
        ok(res.record.record_type === MODE.BACKFILL.key
          ? t(`已补录「${name}」阶段信息`, `Backfilled stage "${name}"`)
          : t(`阶段已推进至「${name}」`, `Advanced to "${name}"`));
        await m.close();
        if (cfg.onDone) await cfg.onDone(res);
      },
    });
  }

  /** 历史补录模式下在表单顶部给出审计提示。 */
  function banner(bodyEl, mode) {
    const old = bodyEl.querySelector(".stage-banner");
    if (old) old.remove();
    if (mode !== MODE.BACKFILL) return;
    const el = document.createElement("div");
    el.className = "stage-banner";
    el.textContent = warningText();
    bodyEl.insertBefore(el, bodyEl.firstChild);
  }

  /* ---------------------------------------------------------- 阶段详情 */

  /** 点时间轴上的某一段：看详情；可补录的给补录入口，补录记录给修改入口。 */
  function openDetail(cfg) {
    const st = cfg.stage;
    const r = st.record;
    const rows = r
      ? [["Stage", "阶段", `${stageLabel(st.code)}（${st.code}）`],
         ["Record Type", "记录类型", modeLabel(r.record_type)],
         ["Effective Date", "生效日期", r.effective_date],
         ["Supporting Reference", "依据", r.reference || ""],
         ["Note", "备注", r.note || ""],
         ["Created At", "创建", `${r.created_at} · ${r.created_by}`],
         ["Last Updated", "最近修改", r.modified ? `${r.updated_at} · ${r.updated_by || "—"}` : t("未修改过", "Never")]]
      : [["Stage", "阶段", `${stageLabel(st.code)}（${st.code}）`],
         ["Status", "状态", STATE_TEXT[st.state]]];

    const canBackfill = !r && st.state === "missing";
    const canEdit = !!r && r.editable;
    const m = openModal({
      title: `${stageLabel(st.code)} · ${t("阶段详情", "Stage detail")}`,
      subtitle: t("Standard Stage · 阶段管理", "Standard Stage"),
      size: "md",
      body: `
        <dl class="kv">${rows.map(([en, zh, v]) =>
          `<dt>${label(en, zh)}</dt><dd>${dash(v)}</dd>`).join("")}</dl>
        ${r
          ? `<div class="form-text">${t("生效日期、依据与说明都可以更正；每次修改都会刷新上面的「最近修改」。阶段本身不可改写——换阶段请另填一条记录。", "The date, reference and note can be corrected; each change updates Last Updated. The stage itself cannot be changed—record another stage instead.")}</div>`
          : ""}
        ${canBackfill
          ? `<div class="stage-banner">${esc(warningText())}</div>`
          : ""}
        ${st.state === "future" && !r
          ? `<div class="form-text">${t("该阶段尚未进入，可在「推进 / 补录阶段」中按流程推进。", "This stage has not been reached. Use Advance / Backfill Stage to advance.")}</div>`
          : ""}`,
      footer: `${canBackfill ? `<button class="btn btn-primary btn-sm" data-fill>${window.App.uiText("补录该阶段", "Backfill this stage")}</button>` : ""}
               ${canEdit ? `<button class="btn btn-primary btn-sm" data-edit>${window.App.uiText("修改", "Edit")}</button>` : ""}
               <button class="btn btn-outline-secondary btn-sm ms-auto" data-bs-dismiss="modal">${window.App.uiText("关闭", "Close")}</button>`,
    });

    const fillBtn = m.el.querySelector("[data-fill]");
    if (fillBtn) fillBtn.onclick = async () => {
      await m.close();
      openForm(Object.assign({}, cfg, { preselect: st.code }));
    };
    const editBtn = m.el.querySelector("[data-edit]");
    if (editBtn) editBtn.onclick = async () => {
      await m.close();
      openEdit(cfg, r);
    };
    return m;
  }

  function openEdit(cfg, record) {
    const isBackfill = record.record_type === MODE.BACKFILL.key;
    Forms.inlineForm({
      title: `${t("修改阶段信息", "Edit stage")} · ${stageLabel(record.stage_code)}`,
      subtitle: `Standard Stage · ${modeLabel(record.record_type)}`,
      size: "lg",
      fields: [
        { name: "stage", label: "Stage", cn: "阶段", type: "auto", col: 6,
          display: `${stageLabel(record.stage_code)}（${record.stage_code}）`,
          help: t("阶段不可改写。", "The stage cannot be changed.") },
        { name: "effective_date", label: "Effective Date", cn: "生效日期", type: "date",
          required: true, col: 6,
          help: record.is_manual ? "" : t("保存修改后，这一阶段将作为手动记录参与当前阶段判断。", "After saving, this stage counts as a manual record when the current stage is determined.") },
        { name: "reference", label: "Supporting Reference", cn: "依据链接 / 路径", type: "text", col: 12 },
        { name: "note", label: "Note", cn: "备注", type: "textarea", rows: 2, col: 12 },
        { name: "created_stamp", label: "Created", cn: "创建", type: "auto", col: 6,
          display: `${record.created_at} · ${record.created_by}` },
        { name: "updated_stamp", label: "Last Updated", cn: "最近修改", type: "auto", col: 6,
          display: record.modified ? `${record.updated_at} · ${record.updated_by || "—"}` : t("未修改过", "Never") },
      ],
      values: record,
      after: (bodyEl) => banner(bodyEl, isBackfill ? MODE.BACKFILL : MODE.ADVANCE),
      submitText: t("保存修改", "Save changes"),
      async onSubmit(payload, m) {
        const res = await put(
          `/api/standards/${cfg.standardId}/stages/${record.id}`, payload);
        ok(t(`已更新「${stageLabel(res.record.stage_code)}」的阶段信息`, `Updated stage "${stageLabel(res.record.stage_code)}"`));
        await m.close();
        if (cfg.onDone) await cfg.onDone(res);
      },
    });
  }

  /** 从标准 id 现取一次阶段数据再开窗，供列表页等没有完整数据的地方调用。 */
  async function open(standardId, title, onDone) {
    const data = await get(`/api/standards/${standardId}/stages`);
    openForm({ standardId, title, stage: stageLabel(data.stage_code), timeline: data.timeline, onDone });
  }

  window.Stages = { timelineHtml, historyHtml, openForm, openDetail, open, MODE, STATE_TEXT };
})();
