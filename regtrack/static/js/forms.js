/* 表单层：按字段声明生成表单、表单弹窗、通用「状态/阶段历史」子表。 */
(function () {
  "use strict";

  const { esc, dash, get, post, ok, fail, openModal, statusTag, today, t, label: fieldLabel } = window.App;


  function inlineForm(cfg) {
    const dialogs = [...document.querySelectorAll('.modal.show')];
    const host = cfg.host || (dialogs.length ? dialogs[dialogs.length - 1].querySelector('.modal-body') : document.querySelector('main.content'));
    if (host.querySelector(':scope > .inline-panel')) return;
    const previous = [...host.children].map(el => [el, el.hidden]);
    previous.forEach(([el]) => { el.hidden = true; });
    const panel = document.createElement('section');
    panel.className = 'inline-panel inline-edit is-editing';
    panel.innerHTML = `<h3 class="inline-title">${esc(cfg.title)}</h3><div data-fields></div><div class="inline-actions"><span class="inline-state" aria-live="polite"></span><button type="button" class="btn btn-outline-secondary btn-sm" data-cancel>${esc(t('\u53d6\u6d88', 'Cancel'))}</button><button type="button" class="btn btn-primary btn-sm" data-save>${esc(cfg.submitText || t('\u4fdd\u5b58', 'Save'))}</button></div>`;
    host.prepend(panel);
    const fieldsHost = panel.querySelector('[data-fields]');
    const modalEl = host.closest('.modal');
    const footer = modalEl && modalEl.querySelector('.modal-footer');
    const buttons = footer ? [...footer.querySelectorAll('button:not([data-bs-dismiss]):not([data-back])')].map(b => [b, b.disabled]) : [];
    buttons.forEach(([b]) => { b.disabled = true; });
    let form, baseline, busy = false, touched = false;
    const snapshot = () => JSON.stringify({values: form.read(), history: [...fieldsHost.querySelectorAll('[data-history-field]')].map(el => el.value)});
    const dirty = () => touched && snapshot() !== baseline;
    function render(vals) {
      const fields = typeof cfg.fields === 'function' ? cfg.fields(vals) : cfg.fields;
      form = buildForm(fieldsHost, fields, vals, 'kv');
      if (cfg.after) cfg.after(fieldsHost, form, vals);
      (cfg.rebuildOn || []).forEach(name => {
        const c = form.controls[name];
        c.ts.on('change', value => render(Object.assign({}, vals, form.read(), {[name]: value})));
      });
    }
    render(cfg.values || {});
    baseline = snapshot();
    const beginInteraction = () => { if (!touched) baseline = snapshot(); touched = true; };
    fieldsHost.addEventListener("pointerdown", beginInteraction, true);
    fieldsHost.addEventListener("keydown", beginInteraction, true);
    const status = panel.querySelector('.inline-state');
    function mark() { status.textContent = dirty() ? t('\u6709\u672a\u4fdd\u5b58\u7684\u4fee\u6539', 'Unsaved changes') : t('\u6b63\u5728\u7f16\u8f91', 'Editing'); }
    panel.addEventListener('input', mark);
    panel.addEventListener('change', mark);
    function close() {
      Fields.destroyIn(panel);
      panel.remove();
      previous.forEach(([el, hidden]) => { el.hidden = hidden; });
      buttons.forEach(([b, disabled]) => { b.disabled = disabled; });
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', outsideClick, true);
      if (modalEl) modalEl.removeEventListener('hide.bs.modal', onHide);
    }
    async function save() {
      if (busy) return false;
      busy = true;
      panel.querySelector('[data-save]').disabled = true;
      panel.querySelector('[data-cancel]').disabled = true;
      try { await cfg.onSubmit(form.read(), {close}, form); return true; }
      catch (e) { fail(e.message); if (e.field) form.focusField(e.field); return false; }
      finally { busy = false; panel.querySelectorAll('[data-save], [data-cancel]').forEach(b => { b.disabled = false; }); }
    }
    async function leave() {
      if (busy) return false;
      if (!dirty()) { close(); return true; }
      const choice = await App.unsavedPrompt(t('\u6709\u4fee\u6539\u5c1a\u672a\u4fdd\u5b58\u3002', 'There are unsaved changes.'));
      if (choice === 'save') return save();
      if (choice === 'stay') return false;
      close(); return true;
    }
    async function outsideClick(e) {
      const target = e.target.closest('a, button, [role="tab"], [data-open], .row-click');
      if (!target || panel.contains(target) || target.closest('.ts-dropdown')) return;
      const otherModal = target.closest('.modal');
      if (otherModal && otherModal !== modalEl) return;
      if (target.closest('[data-bs-dismiss], [data-back]')) return;
      e.preventDefault(); e.stopPropagation();
      if (await leave() && target.isConnected) target.click();
    }
    document.addEventListener('click', outsideClick, true);
    function beforeUnload(e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } }
    function onHide(e) { e.preventDefault(); leave().then(ok => { if (ok) bootstrap.Modal.getInstance(modalEl).hide(); }); }
    window.addEventListener('beforeunload', beforeUnload);
    if (modalEl) modalEl.addEventListener('hide.bs.modal', onHide);
    panel.querySelector('[data-cancel]').onclick = leave;
    panel.querySelector('[data-save]').onclick = save;
    mark();
    return {modal: {el: panel, footer: panel.querySelector('.inline-actions'), close}, getForm: () => form};
  }

  /* ---------------------------------------------------------- 生成表单
     layout "grid"：弹窗表单的栅格布局；"kv"：与明细相同的「字段名 | 值」两栏，用于就地编辑。 */
  function buildForm(host, spec, values = {}, layout = "grid") {
    const automaticText = t("系统自动", "Automatic");
    const v = values || {};
    const controls = {};   // name -> {type, el, ts}
    // 重建表单前先销毁旧下拉框：面板挂在 body 上，不会随 innerHTML 一起消失。
    Fields.destroyIn(host);
    host.innerHTML = "";
    const kvLayout = layout === "kv";
    const grid = document.createElement(kvLayout ? "dl" : "div");
    grid.className = kvLayout ? "kv kv-edit" : "form-grid";
    host.appendChild(grid);

    spec.forEach((f) => {
      if (f.section) {
        const h = document.createElement("div");
        h.className = kvLayout ? "kv-section" : "fieldset-title";
        h.textContent = f.section;
        grid.appendChild(h);
        return;
      }
      const wrap = document.createElement(kvLayout ? "dd" : "div");
      wrap.className = kvLayout ? "kv-field" : "f-" + (f.col || 6);
      wrap.dataset.field = f.name;
      const label = f.label
        ? `<label class="form-label" for="fld-${f.name}">${fieldLabel(f.label, f.cn)}${f.required ? '<span class="req">*</span>' : ""}</label>`
        : "";
      const help = f.help ? `<div class="form-text">${esc(f.help)}</div>` : "";
      const val = v[f.name];

      let control = "";
      switch (f.type) {
        case "auto":
          control = `<div class="auto-field" id="fld-${f.name}">${dash(f.display !== undefined ? f.display : val)}<em>${esc(automaticText)}</em></div>`;
          break;
        case "textarea":
          control = `<textarea class="form-control" id="fld-${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || "")}">${esc(val || "")}</textarea>`;
          break;
        case "checkbox":
          control = `<div class="follow-up-control form-check"><input class="form-check-input" type="checkbox" id="fld-${f.name}" ${val ? "checked" : ""}><label class="form-check-label" for="fld-${f.name}">${fieldLabel(f.label, f.cn)}</label>${window.App.followUpInfo()}</div>`;
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
      if (kvLayout) {
        const dt = document.createElement("dt");
        dt.innerHTML = label;
        grid.appendChild(dt);
        wrap.innerHTML = control + help;
      } else {
        wrap.innerHTML = (f.type === "checkbox" ? "" : label) + control + help;
      }
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
        c.ts = Fields.standard(c.el, { value: val, multiple: f.multiple, placeholder: f.placeholder });
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
        if (c.spec.type === "auto") return v[name];
        if (c.ts) {
          const raw = c.ts.getValue();
          if (Array.isArray(raw)) return raw;
          return raw === "" ? null : raw;
        }
        if (!c.el) return undefined;
        if (c.el.type === "checkbox") return c.el.checked;
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
      submitText = t("保存", "Save"), onSubmit, rebuildOn = [], extraFooter = "", after = null, cancelText = t("取消", "Cancel"),
    } = cfg;

    let form;
    const bodyEl = document.createElement("div");
    const m = openModal({
      title, subtitle, size, body: bodyEl,
      footer: `${extraFooter}<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${esc(cancelText)}</button>
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
    if (!rows.length) return `<div class="empty">${t("还没有记录", "No records yet")}</div>`;
    return '<div class="timeline">' + rows.map((r) => `
      <div class="ev">
        <div class="head">
          ${r.previous_value ? `<span class="tag muted">${esc(r.previous_value)}</span><span style="color:#7b8899">→</span>` : ""}
          ${statusTag(r.new_value)}
          <span class="date num">${esc(r.effective_date)}</span>
        </div>
        <div class="meta">${t("记录于", "Recorded")} ${esc(r.recorded_at)} · ${t("记录人", "by")} ${esc(r.recorded_by)}</div>
        ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
        ${r.reference ? `<div class="meta">${t("依据：", "Reference: ")}${esc(r.reference)}</div>` : ""}
      </div>`).join("") + "</div>";
  }

  /**
   * 打开「状态/阶段历史」子表：上半只读历史，下半新增一条。
   * cfg: {title, subtitle, current, options, url, valueLabel, showReference, onDone}
   */
  function statusModal(cfg) {
    const bodyEl = document.createElement("div");
    bodyEl.innerHTML = `<div class="loading">${t("载入历史…", "Loading history…")}</div>`;
    const m = openModal({
      title: cfg.title,
      subtitle: cfg.subtitle,
      size: "lg",
      body: bodyEl,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${window.App.uiText("关闭", "Close")}</button>
               <button class="btn btn-primary btn-sm" data-save>${window.App.uiText("新增一条变更", "Add change")}</button>`,
    });

    let form;
    async function refresh() {
      const rows = await get(cfg.url);
      bodyEl.innerHTML = `
        <div class="panel" style="margin-bottom:14px">
          <div class="panel-head"><h2>${window.App.uiText("历史记录", "History")}</h2><span class="hint">${t(`共 ${rows.length} 条 · 只读`, `${rows.length} records · read-only`)}</span></div>
          <div class="panel-body">${historyList(rows)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>${window.App.uiText("新增一条", "New record")}</h2>
            <span class="hint">${t("当前值：", "Current: ")}${esc(cfg.current || "—")} · ${t("上一值 / 记录时间 / 记录人由系统写入", "previous value, time and recorder are filled in automatically")}</span>
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
        spec.push({ name: "reference", label: "Supporting Reference", cn: "依据链接 / 路径", type: "text", col: 12, placeholder: t("https:// 或 \\\\共享盘\\路径", "https:// or \\\\share\\path") });
      }
      spec.push({ name: "note", label: "Note", cn: "备注", type: "textarea", rows: 2, col: 12 });
      form = buildForm(bodyEl.querySelector("[data-form]"), spec, { effective_date: today() });
    }

    refresh().catch((e) => { bodyEl.innerHTML = `<div class="empty"><b>${t("载入失败", "Failed to load")}</b>${esc(e.message)}</div>`; });

    const btn = m.footer.querySelector("[data-save]");
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const payload = form.read();
        await post(cfg.url, payload);
        ok(t("已记录状态变更", "Status change recorded"));
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

  window.Forms = { inlineForm, buildForm, formModal, statusModal, historyList, today };
})();
