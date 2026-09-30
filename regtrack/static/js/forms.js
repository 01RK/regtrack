/* 表单层：按字段声明生成表单、表单弹窗、通用「状态/阶段历史」子表。 */
(function () {
  "use strict";

  const { esc, dash, get, post, ok, fail, openModal, statusTag, today } = window.App;

  /* ---------------------------------------------------------- 生成表单 */
  function buildForm(host, spec, values = {}) {
    const v = values || {};
    const controls = {};   // name -> {type, el, ts}
    // 重建表单前先销毁旧下拉框：面板挂在 body 上，不会随 innerHTML 一起消失。
    Fields.destroyIn(host);
    host.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "form-grid";
    host.appendChild(grid);

    spec.forEach((f) => {
      if (f.section) {
        const h = document.createElement("div");
        h.className = "fieldset-title";
        h.textContent = f.section;
        grid.appendChild(h);
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "f-" + (f.col || 6);
      const label = f.label
        ? `<label class="form-label" for="fld-${f.name}">${esc(f.label)}${f.required ? '<span class="req">*</span>' : ""}${f.cn ? `<span class="en">${esc(f.cn)}</span>` : ""}</label>`
        : "";
      const help = f.help ? `<div class="form-text">${esc(f.help)}</div>` : "";
      const val = v[f.name];

      let control = "";
      switch (f.type) {
        case "auto":
          control = `<div class="auto-field">${dash(f.display !== undefined ? f.display : val)}<em>系统自动</em></div>`;
          break;
        case "textarea":
          control = `<textarea class="form-control" id="fld-${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || "")}">${esc(val || "")}</textarea>`;
          break;
        case "date":
          control = `<input type="date" class="form-control" id="fld-${f.name}" value="${esc(val || "")}">`;
          break;
        case "fixed":
        case "choices":
        case "lookup":
        case "standard":
        case "draft":
        case "meeting":
          control = `<select id="fld-${f.name}" ${f.multiple ? "multiple" : ""}></select>`;
          break;
        default:
          control = `<input type="text" class="form-control" id="fld-${f.name}" value="${esc(val === null || val === undefined ? "" : val)}" placeholder="${esc(f.placeholder || "")}">`;
      }
      wrap.innerHTML = label + control + help;
      grid.appendChild(wrap);

      const el = wrap.querySelector(`#fld-${CSS.escape(f.name)}`);
      controls[f.name] = { spec: f, el };
    });

    // TomSelect 初始化（放在 DOM 完成之后，便于处理字段间联动）
    spec.forEach((f) => {
      if (f.section || !controls[f.name]) return;
      const c = controls[f.name];
      const val = v[f.name];
      if (f.type === "fixed") {
        c.ts = Fields.fixed(c.el, { options: f.options, value: val, multiple: f.multiple, placeholder: f.placeholder });
      } else if (f.type === "choices") {
        c.ts = Fields.choices(c.el, { options: f.options, value: val, multiple: f.multiple, placeholder: f.placeholder });
      } else if (f.type === "lookup") {
        c.ts = Fields.lookup(c.el, { category: f.category, value: val, multiple: f.multiple, create: f.create, placeholder: f.placeholder });
      } else if (f.type === "standard") {
        c.ts = Fields.standard(c.el, { value: val, multiple: f.multiple, preload: f.preload, placeholder: f.placeholder });
      } else if (f.type === "meeting") {
        c.ts = Fields.meeting(c.el, { value: val });
      } else if (f.type === "draft") {
        const src = f.dependsOn ? controls[f.dependsOn] : null;
        const startId = src ? (v[f.dependsOn] || null) : null;
        c.ts = Fields.draft(c.el, { standardId: startId, value: val });
      }
    });

    // 标准 → 草案 联动
    spec.forEach((f) => {
      if (f.type === "draft" && f.dependsOn && controls[f.dependsOn] && controls[f.dependsOn].ts) {
        controls[f.dependsOn].ts.on("change", (sid) => controls[f.name].ts.reload(sid));
      }
    });

    return {
      controls,
      el: host,
      value(name) {
        const c = controls[name];
        if (!c) return undefined;
        if (c.ts) {
          const raw = c.ts.getValue();
          if (Array.isArray(raw)) return raw;
          return raw === "" ? null : raw;
        }
        if (!c.el) return undefined;
        const s = c.el.value.trim();
        return s === "" ? null : s;
      },
      read() {
        const out = {};
        spec.forEach((f) => {
          if (f.section || f.readOnly) return;
          // 「系统自动」字段没有控件，默认不回传。但有些字段虽然在当前表单里
          // 不让改（如从会议派生事项时已定死的类型、标准、会议），后端仍把它
          // 当必填项，声明 submit:true 就按传入值一并提交，不会漏字段。
          if (f.type === "auto") {
            if (f.submit) out[f.name] = v[f.name] === undefined ? null : v[f.name];
            return;
          }
          let val = this.value(f.name);
          if (f.multiple && !Array.isArray(val)) val = val ? [val] : [];
          out[f.name] = val;
        });
        return out;
      },
      focusField(name) {
        const c = controls[name];
        if (!c) return;
        if (c.ts) c.ts.focus();
        else if (c.el) c.el.focus();
      },
    };
  }

  /* -------------------------------------------------------- 表单弹窗 */
  function formModal(cfg) {
    const {
      title, subtitle, fields, values = {}, size = "lg",
      submitText = "保存", onSubmit, rebuildOn = [], extraFooter = "", after = null,
    } = cfg;

    let form;
    const bodyEl = document.createElement("div");
    const m = openModal({
      title, subtitle, size, body: bodyEl,
      footer: `${extraFooter}<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">取消</button>
               <button class="btn btn-primary btn-sm" data-save>${esc(submitText)}</button>`,
    });

    function render(vals) {
      const spec = typeof fields === "function" ? fields(vals) : fields;
      form = buildForm(bodyEl, spec, vals);
      rebuildOn.forEach((name) => {
        const c = form.controls[name];
        if (c && c.ts) {
          c.ts.on("change", (nv) => {
            const cur = form.read();
            cur[name] = nv;
            render(Object.assign({}, vals, cur));
          });
        }
      });
      if (after) after(bodyEl, form, vals);
    }
    render(values);

    const saveBtn = m.footer.querySelector("[data-save]");
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        await onSubmit(form.read(), m, form);
      } catch (e) {
        fail(e.message);
        if (e.field) form.focusField(e.field);
      } finally {
        saveBtn.disabled = false;
      }
    };
    return { modal: m, getForm: () => form };
  }

  /* ------------------------- 通用状态 / 阶段历史（文档 §6 的统一实现） */
  function historyList(rows) {
    if (!rows.length) return '<div class="empty">还没有记录</div>';
    return '<div class="timeline">' + rows.map((r) => `
      <div class="ev">
        <div class="head">
          ${r.previous_value ? `<span class="tag muted">${esc(r.previous_value)}</span><span style="color:#7b8899">→</span>` : ""}
          ${statusTag(r.new_value)}
          <span class="date num">${esc(r.effective_date)}</span>
        </div>
        <div class="meta">记录于 ${esc(r.recorded_at)} · 记录人 ${esc(r.recorded_by)}</div>
        ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
        ${r.reference ? `<div class="meta">依据：${esc(r.reference)}</div>` : ""}
      </div>`).join("") + "</div>";
  }

  /**
   * 打开「状态/阶段历史」子表：上半只读历史，下半新增一条。
   * cfg: {title, subtitle, current, options, url, valueLabel, showReference, onDone}
   */
  function statusModal(cfg) {
    const bodyEl = document.createElement("div");
    bodyEl.innerHTML = '<div class="loading">载入历史…</div>';
    const m = openModal({
      title: cfg.title,
      subtitle: cfg.subtitle,
      size: "lg",
      body: bodyEl,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">关闭</button>
               <button class="btn btn-primary btn-sm" data-save>新增一条变更</button>`,
    });

    let form;
    async function refresh() {
      const rows = await get(cfg.url);
      bodyEl.innerHTML = `
        <div class="panel" style="margin-bottom:14px">
          <div class="panel-head"><h2>历史记录</h2><span class="hint">共 ${rows.length} 条 · 只读</span></div>
          <div class="panel-body">${historyList(rows)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>新增一条</h2>
            <span class="hint">当前值：${esc(cfg.current || "—")} · 上一值 / 记录时间 / 记录人由系统写入</span>
          </div>
          <div class="panel-body"><div data-form></div></div>
        </div>`;
      const options = typeof cfg.options === "function" ? cfg.options(rows, cfg.current) : cfg.options;
      const spec = [
        { name: "new_value", label: cfg.valueLabel || "New Value", cn: "新值", type: "fixed", options, required: true, col: 6,
          help: cfg.valueHelp || "" },
        { name: "effective_date", label: "Effective Date", cn: "生效日期", type: "date", required: true, col: 6 },
      ];
      if (cfg.showReference !== false) {
        spec.push({ name: "reference", label: "Supporting Reference", cn: "依据链接 / 路径", type: "text", col: 12, placeholder: "https:// 或 \\\\共享盘\\路径" });
      }
      spec.push({ name: "note", label: "Note", cn: "补充说明", type: "textarea", rows: 2, col: 12 });
      form = buildForm(bodyEl.querySelector("[data-form]"), spec, { effective_date: today() });
    }

    refresh().catch((e) => { bodyEl.innerHTML = `<div class="empty"><b>载入失败</b>${esc(e.message)}</div>`; });

    const btn = m.footer.querySelector("[data-save]");
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const payload = form.read();
        await post(cfg.url, payload);
        ok("已记录状态变更");
        cfg.current = payload.new_value;
        if (cfg.onDone) await cfg.onDone(payload.new_value);
        await m.close();
      } catch (e) {
        fail(e.message);
      } finally {
        btn.disabled = false;
      }
    };
    return m;
  }

  window.Forms = { buildForm, formModal, statusModal, historyList, today };
})();
