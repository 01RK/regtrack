/* 阶段推进 / 补录。
 *
 * 一个入口，两种行为：选当前阶段之后的阶段就是正常推进，选当前阶段之前
 * 尚未填写的阶段就进入历史补录模式（弹窗顶部给出审计提示，日期可填真实
 * 发生时间）。已填写的阶段不锁定：点开时间轴上的任意一段都能更正日期、
 * 依据与说明，创建时间与最近修改时间一并显示，留痕交给这两个时间戳。
 */
(function () {
  "use strict";

  const { esc, dash, get, post, put, ok, fail, openModal } = window.App;

  const MODE = {
    ADVANCE: { key: "ADVANCE", label: "正常推进", cls: "advance" },
    BACKFILL: { key: "BACKFILL", label: "历史补录", cls: "backfill" },
  };

  const STATE_TEXT = {
    done: "已完成", current: "当前阶段", missing: "未填写 · 可补录", future: "未进入",
  };

  const warningText = () => (window.App.meta && window.App.meta.backfill_warning)
    || "⚠您正在补充更早阶段信息，请注意外部审计规范性";

  /* ------------------------------------------------------------ 时间轴 */

  /** 标准明细里的阶段时间轴：每一段都能点开看详情 / 补录。 */
  function timelineHtml(timeline) {
    return `
      <div class="stage-track">
        ${timeline.map((st) => {
          const r = st.record;
          return `
          <button type="button" class="stage-step is-${st.state}" data-stage="${esc(st.code)}"
                  title="${esc(st.label)} · ${esc(STATE_TEXT[st.state])}">
            <span class="st-name">${esc(st.label)}</span>
            <span class="st-date">${r ? esc(r.effective_date) : esc(STATE_TEXT[st.state])}</span>
            ${r && r.record_type === MODE.BACKFILL.key
              ? '<span class="st-flag">补录</span>' : ""}
          </button>`;
        }).join("")}
      </div>`;
  }

  /** 记录时间：创建时间必显示，改过的再补一行最近修改。 */
  function stampHtml(r) {
    return `<div class="meta">创建于 ${esc(r.created_at)} · 记录人 ${esc(r.created_by)}</div>
      <div class="meta">${r.modified
        ? `最近修改 ${esc(r.updated_at)} · 修改人 ${esc(r.updated_by || "—")}`
        : "最近修改：未修改过"}</div>`;
  }

  /** 阶段记录列表（明细页「阶段历史」标签页）。 */
  function historyHtml(records) {
    if (!records.length) return '<div class="empty">还没有阶段记录</div>';
    return '<div class="timeline">' + records.map((r) => `
      <div class="ev">
        <div class="head">
          <span class="tag info">${esc(r.stage_label)}</span>
          <span class="tag ${r.record_type === MODE.BACKFILL.key ? "medium" : "muted"}">${esc(r.record_type_label)}</span>
          <span class="date num">${esc(r.effective_date)}</span>
        </div>
        ${stampHtml(r)}
        ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
        ${r.reference ? `<div class="meta">依据：${esc(r.reference)}</div>` : ""}
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
        text: s.label + (s.record ? "（已填写）" : s.state === "missing" ? "（补录）" : ""),
        sub: s.record
          ? `${s.record.effective_date} · ${s.record.record_type_label} · 已填写，可在时间轴上点开修改`
          : s.state === "missing" ? "当前阶段之前，尚未填写" : "按流程向后推进",
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
      fail("所有阶段都已填写，没有可推进或补录的阶段");
      return;
    }
    const initial = cfg.preselect && selectable.some((o) => o.value === cfg.preselect)
      ? cfg.preselect
      : selectable[0].value;

    Forms.formModal({
      title: `推进 / 补录阶段 · ${cfg.title}`,
      subtitle: "Standard Stage · 阶段管理",
      size: "lg",
      rebuildOn: ["stage_code"],
      fields: (vals) => {
        const mode = modeOf(timeline, vals.stage_code);
        return [
          { name: "stage_code", label: "Target Stage", cn: "目标阶段", type: "choices",
            options, required: true, col: 6,
            help: `当前阶段：${cfg.stage}。选择靠后的阶段为正常推进，选择当前阶段之前尚未填写的阶段为历史补录。` },
          { name: "effective_date", label: "Effective Date", cn: "生效日期", type: "date",
            required: true, col: 6,
            help: mode === MODE.BACKFILL
              ? "补录可填写真实发生时间，不受当前阶段时间顺序限制。"
              : "正常推进的日期不得早于当前阶段的生效日期。" },
          { name: "reference", label: "Supporting Reference", cn: "依据链接 / 路径", type: "text",
            col: 12, placeholder: "https:// 或 \\\\共享盘\\路径" },
          { name: "note", label: "Note", cn: "补充说明", type: "textarea", rows: 2, col: 12 },
        ];
      },
      values: { stage_code: initial, effective_date: Forms.today() },
      after: (bodyEl, form, vals) => banner(bodyEl, modeOf(timeline, vals.stage_code)),
      submitText: "记录阶段",
      async onSubmit(payload, m) {
        const res = await post(`/api/standards/${cfg.standardId}/stages`, payload);
        ok(res.record.record_type === MODE.BACKFILL.key
          ? `已补录「${res.record.stage_label}」阶段信息`
          : `阶段已推进至「${res.record.stage_label}」`);
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
      ? [["阶段", `${r.stage_label}（${st.code}）`],
         ["记录类型", r.record_type_label],
         ["生效日期", r.effective_date],
         ["依据", r.reference || ""],
         ["说明", r.note || ""],
         ["创建时间", `${r.created_at} · ${r.created_by}`],
         ["最近修改", r.modified ? `${r.updated_at} · ${r.updated_by || "—"}` : "未修改过"]]
      : [["阶段", `${st.label}（${st.code}）`],
         ["状态", STATE_TEXT[st.state]]];

    const canBackfill = !r && st.state === "missing";
    const canEdit = !!r && r.editable;
    const m = openModal({
      title: `${st.label} · 阶段详情`,
      subtitle: "Standard Stage · 阶段管理",
      size: "md",
      body: `
        <dl class="kv">${rows.map(([k, v]) =>
          `<dt>${esc(k)}</dt><dd>${dash(v)}</dd>`).join("")}</dl>
        ${r
          ? '<div class="form-text">生效日期、依据与说明都可以更正；每次修改都会刷新上面的「最近修改」。阶段本身不可改写——换阶段请另填一条记录。</div>'
          : ""}
        ${canBackfill
          ? `<div class="stage-banner">${esc(warningText())}</div>`
          : ""}
        ${st.state === "future" && !r
          ? '<div class="form-text">该阶段尚未进入，可在「推进 / 补录阶段」中按流程推进。</div>'
          : ""}`,
      footer: `${canBackfill ? '<button class="btn btn-primary btn-sm" data-fill>补录该阶段</button>' : ""}
               ${canEdit ? '<button class="btn btn-primary btn-sm" data-edit>修改</button>' : ""}
               <button class="btn btn-outline-secondary btn-sm ms-auto" data-bs-dismiss="modal">关闭</button>`,
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
    Forms.formModal({
      title: `修改阶段信息 · ${record.stage_label}`,
      subtitle: `Standard Stage · ${record.record_type_label}`,
      size: "lg",
      fields: [
        { name: "stage", label: "Stage", cn: "阶段（不可改写）", type: "auto", col: 6,
          display: `${record.stage_label}（${record.stage_code}）` },
        { name: "effective_date", label: "Effective Date", cn: "真实发生日期", type: "date",
          required: true, col: 6 },
        { name: "reference", label: "Supporting Reference", cn: "依据链接 / 路径", type: "text", col: 12 },
        { name: "note", label: "Note", cn: "补充说明", type: "textarea", rows: 2, col: 12 },
        { name: "created_stamp", label: "Created", cn: "创建时间 / 记录人", type: "auto", col: 6,
          display: `${record.created_at} · ${record.created_by}` },
        { name: "updated_stamp", label: "Last Updated", cn: "最近修改时间 / 修改人", type: "auto", col: 6,
          display: record.modified ? `${record.updated_at} · ${record.updated_by || "—"}` : "未修改过" },
      ],
      values: record,
      after: (bodyEl) => banner(bodyEl, isBackfill ? MODE.BACKFILL : MODE.ADVANCE),
      submitText: "保存修改",
      async onSubmit(payload, m) {
        const res = await put(
          `/api/standards/${cfg.standardId}/stages/${record.id}`, payload);
        ok(`已更新「${res.record.stage_label}」的阶段信息`);
        await m.close();
        if (cfg.onDone) await cfg.onDone(res);
      },
    });
  }

  /** 从标准 id 现取一次阶段数据再开窗，供列表页等没有完整数据的地方调用。 */
  async function open(standardId, title, onDone) {
    const data = await get(`/api/standards/${standardId}/stages`);
    openForm({ standardId, title, stage: data.stage, timeline: data.timeline, onDone });
  }

  window.Stages = { timelineHtml, historyHtml, openForm, openDetail, open, MODE, STATE_TEXT };
})();
