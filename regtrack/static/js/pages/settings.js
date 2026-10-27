App.ready(async () => {
  const { esc, dash, get, post, put, del, emptyRow, ok, fail, confirmDialog, t, label } = App;
  const CATEGORY_EN = { impact_area: "Impact Areas", person: "People", team: "Teams / Departments",
                        organization: "Organizations", tc_wg: "TC / WG" };
  const CATS = Object.fromEntries(Object.entries(App.meta.lookup_categories)
    .map(([key, zh]) => [key, t(zh, CATEGORY_EN[key])]));
  let activeCategory = Object.keys(CATS)[0];
  let categoryRows = {};
  let sorter;

  async function load() {
    const host = document.getElementById("cats");
    const nav = document.getElementById("lookup-categories");
    const categories = Object.keys(CATS);
    categoryRows = Object.fromEntries(await Promise.all(categories.map(async (cat) => [
      cat, await get(`/api/lookups/${cat}`, { all: 1 }),
    ])));
    if (!categoryRows[activeCategory]) activeCategory = categories[0];

    nav.innerHTML = categories.map((cat) => {
      const rows = categoryRows[cat];
      const active = rows.filter((row) => row.is_active).length;
      return `<button type="button" class="lookup-category${cat === activeCategory ? " active" : ""}"
        data-lookup-category="${esc(cat)}" aria-pressed="${cat === activeCategory}">
        <span>${esc(CATS[cat])}</span><small>${active} / ${rows.length}</small>
      </button>`;
    }).join("");

    function renderCategory(cat) {
      if (sorter) sorter.destroy();
      activeCategory = cat;
      const rows = categoryRows[cat] || [];
      const activeCount = rows.filter((row) => row.is_active).length;
      nav.querySelectorAll("[data-lookup-category]").forEach((button) => {
        const selected = button.dataset.lookupCategory === cat;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      host.innerHTML = `
        <div class="panel lookup-panel">
          <div class="panel-head lookup-panel-head">
            <div class="lookup-title">
              <h2>${esc(CATS[cat])}</h2>
              <p><code>${esc(cat)}</code><span>${t(`${activeCount} 条启用，共 ${rows.length} 条`, `${activeCount} active of ${rows.length}`)}</span></p>
            </div>
            <div class="lookup-toolbar ms-auto" aria-label="${esc(CATS[cat])}">
              <button class="btn btn-outline-secondary btn-sm" data-export="${cat}">${window.App.uiText("导出", "Export")}</button>
              <label class="btn btn-outline-secondary btn-sm mb-0">${t("导入", "Import")}<input type="file" accept=".json,application/json" hidden data-import="${cat}"></label>
              <button class="btn btn-outline-secondary btn-sm" data-add="${cat}">${window.App.uiText("+ 新增", "+ Add")}</button>
            </div>
          </div>
          <div class="lookup-table-note"><span>${window.App.uiText("拖动左侧手柄调整顺序，松开即保存。", "Drag the handle to reorder; the order is saved when you drop.")}</span><span class="lookup-order-status" role="status" aria-live="polite"></span></div>
          <div class="panel-body tight table-wrap lookup-table-wrap">
            <table class="table lookup-table">
              <thead><tr><th><span class="visually-hidden">${window.App.uiText("拖动排序", "Reorder")}</span></th><th>${label("Value", "值")}</th><th>${label("Note", "说明")}</th>
                <th>${label("Status", "状态")}</th><th><span class="visually-hidden">${window.App.uiText("操作", "Actions")}</span></th></tr></thead>
              <tbody>${rows.length ? rows.map((r) => `
                <tr data-id="${r.id}">
                  <td><button type="button" class="lookup-drag-handle" aria-label="${t("调整顺序：", "Reorder: ")}${esc(r.value)}" title="${t("拖动排序；也可使用 Alt + ↑ / ↓", "Drag to reorder, or use Alt + ↑ / ↓")}">
                    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/><circle cx="5" cy="15" r="1.5"/><circle cx="11" cy="15" r="1.5"/></svg>
                  </button></td>
                  <td class="cell-main">${esc(r.value)}</td>
                  <td class="cell-sub">${dash(r.note)}</td>
                  <td>${r.is_active ? `<span class="tag ok">${window.App.uiText("启用", "Active")}</span>` : `<span class="tag muted">${window.App.uiText("停用", "Inactive")}</span>`}</td>
                  <td><div class="lookup-actions">${cat === "tc_wg" ? `<a class="btn btn-outline-secondary btn-sm" href="/file-manager?scope=workgroup&owner_id=${r.id}&stage=OTHER">${t("文件", "Files")}</a>` : ""}
                    <button class="btn-link-quiet" data-edit='${esc(JSON.stringify(r))}'>${window.App.uiText("编辑", "Edit")}</button>
                    <button class="btn-link-quiet" data-toggle="${r.id}" data-active="${r.is_active}">${r.is_active ? t("停用", "Deactivate") : t("启用", "Activate")}</button>
                    <button class="btn-link-quiet" data-del="${r.id}">${window.App.uiText("删除", "Delete")}</button>
                  </div></td>
                </tr>`).join("")
                : emptyRow(5, ["这个字典还是空的", "This dictionary is empty"], ["点右上角新增第一个值", "Add the first value at the top right"])}</tbody>
            </table>
          </div>
        </div>`;

      bindCategoryActions();
      const tbody = host.querySelector("tbody");
      sorter = Sortable.create(tbody, {
        handle: ".lookup-drag-handle", draggable: "tr[data-id]",
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160,
        ghostClass: "lookup-drag-ghost", chosenClass: "lookup-drag-chosen",
        onEnd: (event) => { if (event.oldIndex !== event.newIndex) saveOrder(); },
      });

      async function saveOrder() {
        const previous = categoryRows[cat].map((row) => String(row.id));
        const status = host.querySelector(".lookup-order-status");
        const controls = [...host.querySelectorAll("button, input"), ...nav.querySelectorAll("button")];
        sorter.option("disabled", true);
        controls.forEach((control) => { control.disabled = true; });
        status.textContent = t("正在保存…", "Saving…");
        status.className = "lookup-order-status";
        try {
          categoryRows[cat] = await put(`/api/lookups/${cat}/order`, { ids: sorter.toArray().map(Number) });
          App.lookups[cat] = categoryRows[cat];
          status.textContent = t("✓ 已自动保存", "✓ Saved");
          status.classList.add("is-saved");
        } catch (error) {
          sorter.sort(previous, true);
          status.textContent = t("保存失败，已恢复原顺序", "Save failed; the previous order was restored");
          status.classList.add("is-error");
          fail(error.message);
        } finally {
          sorter.option("disabled", false);
          controls.forEach((control) => { control.disabled = false; });
        }
      }

      tbody.querySelectorAll(".lookup-drag-handle").forEach((handle) => {
        handle.onkeydown = async (event) => {
          if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const row = handle.closest("tr");
          const sibling = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
          if (!sibling) return;
          if (event.key === "ArrowUp") tbody.insertBefore(row, sibling);
          else tbody.insertBefore(sibling, row);
          await saveOrder();
          handle.focus();
        };
      });
    }

    nav.querySelectorAll("[data-lookup-category]").forEach((button) => {
      button.onclick = () => renderCategory(button.dataset.lookupCategory);
    });
    renderCategory(activeCategory);
  }

  function bindCategoryActions() {
    const host = document.getElementById("cats");
    host.querySelectorAll("[data-add]").forEach((b) => {
      b.onclick = () => openForm(b.dataset.add, null);
    });
    host.querySelectorAll("[data-export]").forEach((b) => {
      b.onclick = () => { window.location.href = `/api/transfer/lookup/${encodeURIComponent(b.dataset.export)}/export`; };
    });
    host.querySelectorAll("[data-import]").forEach((input) => {
      input.onchange = async (ev) => {
        const file = ev.target.files[0]; if (!file) return;
        const mode = window.confirm(t("导入方式：点击‘确定’选择补充；点击‘取消’选择完全替换。", "Import mode: OK to append, Cancel to replace everything.")) ? "append" : "replace";
        try {
          const fd = new FormData(); fd.append("file", file); fd.append("mode", mode);
          const res = await fetch(`/api/transfer/lookup/${encodeURIComponent(input.dataset.import)}/import`, { method: "POST", body: fd, headers: { "X-User": encodeURIComponent(App.user || "未署名") } });
          const body = await res.json(); if (!res.ok) throw new Error(body.error || t("导入失败", "Import failed"));
          ok(t(`导入完成，${body.count} 条记录`, `Imported ${body.count} records`)); await reload();
        } catch (e) { fail(e.message); } finally { ev.target.value = ""; }
      };
    });
    host.querySelectorAll("[data-edit]").forEach((b) => {
      const row = JSON.parse(b.dataset.edit);
      b.onclick = () => openForm(row.category, row);
    });
    host.querySelectorAll("[data-toggle]").forEach((b) => {
      b.onclick = async () => {
        await put(`/api/lookups/${b.dataset.toggle}`, { is_active: b.dataset.active === "1" ? 0 : 1 });
        ok(t("已更新", "Updated"));
        await reload();
      };
    });
    host.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = () => confirmDialog(t("删除这个字典值？已经写进业务记录里的旧值不受影响。", "Delete this value? Records that already use it are not affected."), async () => {
        try {
          await del(`/api/lookups/${b.dataset.del}`);
          ok(t("已删除", "Deleted"));
          await reload();
        } catch (e) { fail(e.message); }
      });
    });
  }

  async function loadTransferUsers() {
    const sel = document.getElementById("transfer-user");
    if (!sel) return;
    const rows = await get("/api/transfer/users");
    const users = rows.map((r) => r.user);
    if (App.user && !users.includes(App.user)) users.unshift(App.user);
    sel.innerHTML = users.length ? users.map((u) => `<option>${esc(u)}</option>`).join("") : `<option value="">${t("暂无登记数据", "No records yet")}</option>`;
    if (App.user) sel.value = App.user;
    document.getElementById("export-user").onclick = () => {
      const user = sel.value;
      if (!user) return fail(t("请选择登记人", "Select an operator"));
      window.location.href = `/api/transfer/export?user=${encodeURIComponent(user)}`;
    };
    document.getElementById("import-user").onchange = async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";           // 同一个文件再选一次也要能触发
      if (!file) return;
      try {
        // 先预检，把包里有什么、该记到谁名下摆给用户确认，再真正写库
        const info = await upload("/api/transfer/inspect", file);
        confirmImport(file, info);
      } catch (e) { fail(e.message); }
    };
  }

  /** 带上当前操作人请求头上传文件，并把后端的报错原样抛出来。 */
  async function upload(url, file, extra = {}) {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    const res = await fetch(url, {
      method: "POST", body: fd,
      headers: { "X-User": encodeURIComponent(App.user || "未署名") },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail ? `${body.error}（${body.detail}）` : (body.error || t("操作失败", "Operation failed")));
    return body;
  }

  const NEW_PERSON = "__new__";

  /** 导入前的确认：这批数据记到哪位操作人名下。
      同一个人写成「Wang, Xuesong」和「王学松」是常事，让用户挑一次，
      就不会在本机分裂成两个操作人。 */
  function confirmImport(file, info) {
    const people = info.people || [];
    const preset = info.matched ? info.user : NEW_PERSON;
    const m = App.openModal({
      title: t("确认导入数据包", "Confirm Data Import"),
      subtitle: `${t("数据交换", "Data exchange")} · ${file.name}`,
      size: "md",
      body: `
        <div class="import-confirm">
          <p class="lead">${t("数据包登记人为", "Recorded by")} <b>${esc(info.user || t("（未注明）", "(not stated)"))}</b>${t("，共", ", ")} <b>${info.total}</b> ${t("条记录。", "records.")}</p>
          <div class="import-counts">
            ${(info.counts || []).map((c) => `<span class="tag">${esc(c.label)} ${c.count}</span>`).join("")}
          </div>
          <label class="form-label" for="imp-user">${label("Recorded By", "登记人")}</label>
          <select id="imp-user" class="form-select">
            ${people.map((u) => `<option value="${esc(u)}"${u === preset ? " selected" : ""}>${esc(u)}</option>`).join("")}
            <option value="${NEW_PERSON}"${preset === NEW_PERSON ? " selected" : ""}>${t("新增操作人…", "New operator…")}</option>
          </select>
          <input id="imp-new" class="form-control mt-2" placeholder="${t("填写新的操作人姓名", "Enter the new operator's name")}"
                 value="${esc(info.user || "")}" ${preset === NEW_PERSON ? "" : "hidden"}>
          <div class="form-text">${t("本机已有这个人就选它，同一个人的中英文两种写法也请选同一条——选错会在本机分裂成两个操作人，统计和筛选都会对不上。",
            "If this person already exists here, choose them—even if the name is written differently. Otherwise the same person is split into two operators.")}</div>
          <div class="form-text">${t("导入时会重新编号：标准编号、草案版本、字典值等本机已有的记录自动合并，不会覆盖你自己的数据。",
            "Records are renumbered on import. Existing standards, draft versions and dictionary values are merged; your data is not overwritten.")}</div>
        </div>`,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${window.App.uiText("取消", "Cancel")}</button>
               <button class="btn btn-primary btn-sm" data-go>${window.App.uiText("确认导入", "Import")}</button>`,
    });
    const sel = m.body.querySelector("#imp-user");
    const input = m.body.querySelector("#imp-new");
    sel.onchange = () => {
      input.hidden = sel.value !== NEW_PERSON;
      if (!input.hidden) input.focus();
    };
    m.footer.querySelector("[data-go]").onclick = async () => {
      const asUser = (sel.value === NEW_PERSON ? input.value : sel.value).trim();
      if (!asUser) return fail(t("请选择或填写操作人", "Select or enter an operator"));
      try {
        const res = await upload("/api/transfer/import", file, { as_user: asUser });
        await m.close();
        ok(t(`导入完成：新增 ${res.inserted} 条，合并 ${res.merged} 条`, `Imported: ${res.inserted} added, ${res.merged} merged`) +
           (res.skipped ? t(`，跳过 ${res.skipped} 条`, `, ${res.skipped} skipped`) : ""));
        showImportResult(res);
        await loadTransferUsers();
      } catch (e) { fail(e.message); }
    };
  }

  /** 有跳过的记录时把逐表明细摊开，不让问题悄悄溜过去。 */
  function showImportResult(res) {
    if (!res.skipped) return;
    App.openModal({
      title: t("导入结果", "Import Result"),
      subtitle: t(`全部记在 ${res.user} 名下`, `All assigned to ${res.user}`),
      size: "md",
      body: `
        <table class="table">
          <thead><tr><th>${label("Content", "内容")}</th><th class="num">${label("Added", "新增")}</th><th class="num">${label("Merged", "合并")}</th><th class="num">${label("Skipped", "跳过")}</th><th>${label("Reason", "跳过原因")}</th></tr></thead>
          <tbody>${res.tables.map((r) => `
            <tr><td>${esc(r.label)}</td><td class="num">${r.inserted}</td>
                <td class="num">${r.merged}</td><td class="num">${r.skipped}</td>
                <td class="cell-sub">${esc((r.reasons || []).join("；"))}</td></tr>`).join("")}
          </tbody>
        </table>
        <div class="form-text">${t("「合并」是本机已有同一条记录，沿用原记录、不重复建档。", "Merged means the same record already exists here; the existing one is kept.")}</div>`,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${window.App.uiText("知道了", "OK")}</button>`,
    });
  }

  function renderOperators(selected) {
    const sel = document.getElementById("operator-user");
    const people = (App.lookups.person || []).filter((p) => p.is_active);
    if (App.user && !people.some((p) => p.value === App.user)) people.unshift({ value: App.user, note: "" });
    sel.innerHTML = people.map((p) => `<option value="${esc(p.value)}">${esc(p.value)}${p.note ? ` · ${esc(p.note)}` : ""}</option>`).join("");
    sel.value = selected || App.user || (people[0] && people[0].value) || "";
  }

  async function loadOperator() {
    const sel = document.getElementById("operator-user");
    if (!sel) return;
    renderOperators();
    // 部门：从「团队 / 部门」字典选择，或直接键入新部门（保存时由后端补进字典）。
    const department = () => Fields.lookup(document.getElementById("operator-new-note"), {
      category: "team", placeholder: t("选择或输入部门…", "Select or type a department…") });
    let departmentPicker = department();
    // 新增操作人：写入人员字典（与「字典维护 → 人员」同一份名单），并选中它，再确认切换即可。
    document.getElementById("operator-add-form").onsubmit = async (event) => {
      event.preventDefault();
      const name = document.getElementById("operator-new-name").value.trim();
      const note = departmentPicker.getValue();
      if (!name) return fail(t("请填写操作人姓名", "Enter the operator's name"));
      try {
        const saved = await post("/api/lookups/person", { value: name, note });
        await App.refreshLookups();
        renderOperators(saved.value);
        event.target.reset();
        departmentPicker = department();
        ok(t(`已添加操作人 ${saved.value}，点「确认切换」即可使用`, `Added ${saved.value}. Click Switch to use it.`));
      } catch (e) { fail(e.message); }
    };
    document.getElementById("operator-current").textContent = App.user || t("未署名", "Unsigned");
    document.getElementById("operator-confirm").onclick = () => {
      const next = sel.value; if (!next || next === App.user) return fail(t("请选择不同的操作人", "Select a different operator"));
      confirmDialog(t(`确认切换操作人账户为${next}吗？`, `Switch the operator to ${next}?`), async () => {
        App.user = next; localStorage.setItem("regtrack.user", next);
        document.getElementById("operator-current").textContent = next;
        const display = document.getElementById("current-user"); if (display) display.textContent = next;
        ok(t("当前操作人已切换为 ", "Operator switched to ") + next);
      });
    };
  }

  async function reload() {
    await App.refreshLookups();
    await load();
  }

  function openForm(category, row) {
    (row ? Forms.inlineForm : Forms.formModal)({
      title: row ? `${t("编辑", "Edit")} ${row.value}` : `${t("新增", "Add")} · ${CATS[category]}`,
      subtitle: `${t("字典", "Dictionary")} · ${category}`,
      size: "md",
      fields: [
        { name: "value", label: "Value", cn: "值", type: "text", required: true, col: 12,
          help: t("写入业务记录的内容。", "The text saved in records.") },
        { name: "note", label: "Note", cn: "说明", type: "text", col: 12,
          help: t("显示在下拉框的值下方，例如人员写所在部门，机构写全称。", "Shown under the value in drop-downs, e.g. a person's department or an organization's full name.") },
      ],
      values: row || {},
      submitText: row ? t("保存", "Save") : t("新增", "Add"),
      async onSubmit(payload, m) {
        if (row) await put(`/api/lookups/${row.id}`, payload);
        else await post(`/api/lookups/${category}`, payload);
        ok(row ? t("已保存", "Saved") : t("已新增", "Added"));
        await m.close();
        await reload();
      },
    });
  }

  await load();
  await loadTransferUsers();
  await loadOperator();
});
