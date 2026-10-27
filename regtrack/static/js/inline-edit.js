/* Metadata editing is activated only by the explicit Edit button.
 * InlineEdit.mount({host, title, spec, values, extra, save, modal}).edit()
 * Keeps the existing key/value layout and protects unsaved changes. */
(function () {
  "use strict";

  const { esc, t, label, fail, ok, unsavedPrompt, uiText } = window.App;
  const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='tab'], [role='button'], [data-open], .row-click, .nav-link";

  /** 统一取值格式，便于比较是否改动（数字与字符串、空串与 null 视为相同）。 */
  function normalize(value) {
    if (value === null || value === undefined || value === "") return null;
    if (Array.isArray(value)) return value.map(String);
    return String(value);
  }

  function display(field, values) {
    if (field.view) return field.view(values);
    if (field.type === "auto") return field.display !== undefined ? field.display : values[field.name];
    const value = values[field.name];
    if (Array.isArray(value)) return value.join("、");
    if (field.type === "choices" && field.options) {
      const hit = field.options.find((o) => String(o.value) === String(value));
      return hit ? hit.text : value;
    }
    return value;
  }

  function mount(cfg) {
    const { host, title, spec, values, extra = [], save, modal } = cfg;
    const modalEl = modal ? modal.el : null;
    const editable = spec.filter((f) => !f.section && f.type !== "auto");
    let form = null;
    let editing = false;
    let touched = false;
    let busy = false;
    const self = {};

    // 同一位置重新挂载（页面刷新数据后）时，先卸下旧的编辑器及其监听。
    if (host.inlineEditor) host.inlineEditor.destroy();
    host.inlineEditor = self;
    host.classList.add("inline-edit");

    function viewHtml() {
      const rows = spec.map((f) => {
        if (f.section) return `<div class="kv-section">${esc(f.section)}</div>`;
        const text = display(f, values);
        const cell = text === null || text === undefined || text === "" ? "" : esc(text);
        if (f.type === "auto") return `<dt>${label(f.label, f.cn)}</dt><dd>${cell}</dd>`;
        return `<dt>${label(f.label, f.cn)}</dt>
          <dd class="inline-cell" data-field="${esc(f.name)}">${cell}</dd>`;
      }).join("");
      const tail = extra.map(([en, zh, text]) => `<dt>${label(en, zh)}</dt><dd>${text ? esc(text) : ""}</dd>`).join("");
      return `<dl class="kv inline-kv">${rows}${tail}</dl>`;
    }

    function renderView() {
      editing = false;
      touched = false;
      form = null;
      Fields.destroyIn(host);
      host.classList.remove("is-editing", "is-dirty");
      host.style.minHeight = "";
      host.innerHTML = viewHtml();
      
    }

    function isDirty() {
      if (!editing || !touched) return false;
      const current = form.read();
      return editable.some((f) => JSON.stringify(normalize(current[f.name])) !== JSON.stringify(normalize(values[f.name])));
    }

    function markState() {
      const dirty = isDirty();
      host.classList.toggle("is-dirty", dirty);
      const state = host.querySelector(".inline-state");
      if (state) state.textContent = dirty ? t("有未保存的修改", "Unsaved changes") : t("正在编辑", "Editing");
    }

    function edit(fieldName) {
      if (editing) return;
      editing = true;
      host.style.minHeight = host.getBoundingClientRect().height + "px";
      host.classList.add("is-editing");
      host.innerHTML = `<div class="inline-form"></div>
        <div class="inline-actions">
          <span class="inline-state" aria-live="polite">${esc(t("正在编辑", "Editing"))}</span>
          <button type="button" class="btn btn-outline-secondary btn-sm" data-inline-cancel>${uiText("取消", "Cancel")}</button>
          <button type="button" class="btn btn-primary btn-sm" data-inline-save>${uiText("保存", "Save")}</button>
        </div>`;
      const formHost = host.querySelector(".inline-form");
      form = Forms.buildForm(formHost, spec, values, "kv");
      const extraRows = extra.map(([en, zh, text]) => `<dt>${label(en, zh)}</dt><dd>${text ? esc(text) : ""}</dd>`).join("");
      if (extraRows) formHost.querySelector(".kv").insertAdjacentHTML("beforeend", extraRows);
      const onTouch = () => { touched = true; markState(); };
      formHost.addEventListener("input", onTouch);
      formHost.addEventListener("change", onTouch);
      host.querySelector("[data-inline-cancel]").onclick = () => renderView();
      host.querySelector("[data-inline-save]").onclick = () => trySave();
      if (fieldName) form.focusField(fieldName);
    }

    async function trySave() {
      if (busy) return false;
      busy = true;
      try {
        await save(form.read());
        ok(t(`${title}已保存`, `${title} saved`));
        // save 通常会重新渲染页面数据并挂上新的编辑器；仍是本编辑器时才切回只读视图。
        if (host.isConnected && host.inlineEditor === self && editing) renderView();
        return true;
      } catch (e) {
        fail(e.message);
        if (e.field) form.focusField(e.field);
        return false;
      } finally {
        busy = false;
      }
    }

    /** 询问如何处理未保存的修改；返回 true 表示可以继续离开。 */
    async function resolveLeave() {
      const choice = await unsavedPrompt(t(`「${title}」有修改尚未保存。`, `${title} has unsaved changes.`));
      if (choice === "stay") return false;
      if (choice === "save") return trySave();
      renderView();
      return true;
    }

    function cleanup() {
      if (host.inlineEditor === self) host.inlineEditor = null;
      document.removeEventListener("click", onOutsideClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (modalEl) modalEl.removeEventListener("hide.bs.modal", onHide);
    }

    async function onOutsideClick(event) {
      if (!host.isConnected) { cleanup(); return; }
      if (!editing || busy) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || host.contains(target) || target.closest(".ts-dropdown")) return;
      const inModal = target.closest(".modal");
      // 上层弹窗（提示框、子记录）里的操作不算离开；所在弹窗的关闭交给 hide 事件处理。
      if (inModal && inModal !== modalEl) return;
      if (inModal && (target === modalEl || target.closest("[data-bs-dismiss], [data-back]"))) return;
      if (!target.closest(INTERACTIVE)) return;
      if (!isDirty()) return;
      event.preventDefault();
      event.stopPropagation();
      if (await resolveLeave() && target.isConnected) target.click();
    }

    function onBeforeUnload(event) {
      if (!host.isConnected) { cleanup(); return; }
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function onHide(event) {
      if (!isDirty() || busy) return;
      event.preventDefault();
      resolveLeave().then((leave) => { if (leave) modal.modal.hide(); });
    }

    document.addEventListener("click", onOutsideClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    if (modalEl) {
      modalEl.addEventListener("hide.bs.modal", onHide);
      modalEl.addEventListener("hidden.bs.modal", cleanup, { once: true });
    }
    renderView();
    return Object.assign(self, { edit, isDirty, destroy: cleanup });
  }

  window.InlineEdit = { mount };
})();
