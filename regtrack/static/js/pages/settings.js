App.ready(async () => {
  const { esc, dash, get, post, put, del, emptyRow, ok, fail, confirmDialog } = App;
  const CATS = App.meta.lookup_categories;
  let activeCategory = Object.keys(CATS)[0];
  let categoryRows = {};
  let sorter;

  document.querySelectorAll("[data-setting-tab]").forEach((tab) => {
    tab.onclick = () => {
      const key = tab.dataset.settingTab;
      document.querySelectorAll("[data-setting-tab]").forEach((x) => x.classList.toggle("active", x === tab));
      document.querySelectorAll("[data-setting-section]").forEach((x) => x.classList.toggle("active", x.dataset.settingSection === key));
    };
  });

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
              <p><code>${esc(cat)}</code><span>${activeCount} 条启用，共 ${rows.length} 条</span></p>
            </div>
            <div class="lookup-toolbar ms-auto" aria-label="${esc(CATS[cat])}操作">
              <button class="btn btn-outline-secondary btn-sm" data-export="${cat}">导出</button>
              <label class="btn btn-outline-secondary btn-sm mb-0">导入<input type="file" accept=".json,application/json" hidden data-import="${cat}"></label>
              <button class="btn btn-outline-secondary btn-sm" data-add="${cat}">+ 新增</button>
            </div>
          </div>
          <div class="lookup-table-note"><span>拖动左侧手柄调整顺序，松开即保存。</span><span class="lookup-order-status" role="status" aria-live="polite"></span></div>
          <div class="panel-body tight table-wrap lookup-table-wrap">
            <table class="table lookup-table">
              <thead><tr><th><span class="visually-hidden">拖动排序</span></th><th>值</th><th>说明（下拉框里的冗余显示）</th>
                <th>状态</th><th><span class="visually-hidden">操作</span></th></tr></thead>
              <tbody>${rows.length ? rows.map((r) => `
                <tr data-id="${r.id}">
                  <td><button type="button" class="lookup-drag-handle" aria-label="调整${esc(r.value)}的顺序" title="拖动排序；也可使用 Alt + ↑ / ↓">
                    <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.5"/><circle cx="11" cy="5" r="1.5"/><circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/><circle cx="5" cy="15" r="1.5"/><circle cx="11" cy="15" r="1.5"/></svg>
                  </button></td>
                  <td class="cell-main">${esc(r.value)}</td>
                  <td class="cell-sub">${dash(r.note)}</td>
                  <td>${r.is_active ? '<span class="tag ok">启用</span>' : '<span class="tag muted">停用</span>'}</td>
                  <td><div class="lookup-actions">
                    <button class="btn-link-quiet" data-edit='${esc(JSON.stringify(r))}'>编辑</button>
                    <button class="btn-link-quiet" data-toggle="${r.id}" data-active="${r.is_active}">${r.is_active ? "停用" : "启用"}</button>
                    <button class="btn-link-quiet" data-del="${r.id}">删除</button>
                  </div></td>
                </tr>`).join("")
                : emptyRow(5, "这个字典还是空的", "点右上角新增第一个值")}</tbody>
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
        status.textContent = "正在保存…";
        status.className = "lookup-order-status";
        try {
          categoryRows[cat] = await put(`/api/lookups/${cat}/order`, { ids: sorter.toArray().map(Number) });
          App.lookups[cat] = categoryRows[cat];
          status.textContent = "✓ 已自动保存";
          status.classList.add("is-saved");
        } catch (error) {
          sorter.sort(previous, true);
          status.textContent = "保存失败，已恢复原顺序";
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
        const mode = window.confirm("导入方式：点击‘确定’选择补充；点击‘取消’选择完全替换。") ? "append" : "replace";
        try {
          const fd = new FormData(); fd.append("file", file); fd.append("mode", mode);
          const res = await fetch(`/api/transfer/lookup/${encodeURIComponent(input.dataset.import)}/import`, { method: "POST", body: fd, headers: { "X-User": encodeURIComponent(App.user || "未署名") } });
          const body = await res.json(); if (!res.ok) throw new Error(body.error || "导入失败");
          ok(`导入完成，${body.count} 条记录`); await reload();
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
        ok("已更新");
        await reload();
      };
    });
    host.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = () => confirmDialog("删除这个字典值？已经写进业务记录里的旧值不受影响。", async () => {
        try {
          await del(`/api/lookups/${b.dataset.del}`);
          ok("已删除");
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
    sel.innerHTML = users.length ? users.map((u) => `<option>${esc(u)}</option>`).join("") : '<option value="">暂无登记数据</option>';
    if (App.user) sel.value = App.user;
    document.getElementById("export-user").onclick = () => {
      const user = sel.value;
      if (!user) return fail("请选择登记人");
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
    if (!res.ok) throw new Error(body.detail ? `${body.error}（${body.detail}）` : (body.error || "操作失败"));
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
      title: "确认导入数据包",
      subtitle: `数据交换 · ${file.name}`,
      size: "md",
      body: `
        <div class="import-confirm">
          <p class="lead">数据包登记人为 <b>${esc(info.user || "（未注明）")}</b>，共 <b>${info.total}</b> 条记录。</p>
          <div class="import-counts">
            ${(info.counts || []).map((c) => `<span class="tag">${esc(c.label)} ${c.count}</span>`).join("")}
          </div>
          <label class="form-label" for="imp-user">这批数据记到哪位操作人名下</label>
          <select id="imp-user" class="form-select">
            ${people.map((u) => `<option value="${esc(u)}"${u === preset ? " selected" : ""}>${esc(u)}</option>`).join("")}
            <option value="${NEW_PERSON}"${preset === NEW_PERSON ? " selected" : ""}>新增操作人…</option>
          </select>
          <input id="imp-new" class="form-control mt-2" placeholder="填写新的操作人姓名"
                 value="${esc(info.user || "")}" ${preset === NEW_PERSON ? "" : "hidden"}>
          <div class="form-text">
            本机已有这个人就选它，同一个人的中英文两种写法也请选同一条——
            选错会在本机分裂成两个操作人，统计和筛选都会对不上。
          </div>
          <div class="form-text">
            导入时会重新编号：标准编号、草案版本、字典值等本机已有的记录自动合并，
            不会覆盖你自己的数据。
          </div>
        </div>`,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">取消</button>
               <button class="btn btn-primary btn-sm" data-go>确认导入</button>`,
    });
    const sel = m.body.querySelector("#imp-user");
    const input = m.body.querySelector("#imp-new");
    sel.onchange = () => {
      input.hidden = sel.value !== NEW_PERSON;
      if (!input.hidden) input.focus();
    };
    m.footer.querySelector("[data-go]").onclick = async () => {
      const asUser = (sel.value === NEW_PERSON ? input.value : sel.value).trim();
      if (!asUser) return fail("请选择或填写操作人");
      try {
        const res = await upload("/api/transfer/import", file, { as_user: asUser });
        await m.close();
        ok(`导入完成：新增 ${res.inserted} 条，合并 ${res.merged} 条` +
           (res.skipped ? `，跳过 ${res.skipped} 条` : ""));
        showImportResult(res);
        await loadTransferUsers();
      } catch (e) { fail(e.message); }
    };
  }

  /** 有跳过的记录时把逐表明细摊开，不让问题悄悄溜过去。 */
  function showImportResult(res) {
    if (!res.skipped) return;
    App.openModal({
      title: "导入结果",
      subtitle: `全部记在 ${res.user} 名下`,
      size: "md",
      body: `
        <table class="table">
          <thead><tr><th>内容</th><th class="num">新增</th><th class="num">合并</th><th class="num">跳过</th><th>跳过原因</th></tr></thead>
          <tbody>${res.tables.map((r) => `
            <tr><td>${esc(r.label)}</td><td class="num">${r.inserted}</td>
                <td class="num">${r.merged}</td><td class="num">${r.skipped}</td>
                <td class="cell-sub">${esc((r.reasons || []).join("；"))}</td></tr>`).join("")}
          </tbody>
        </table>
        <div class="form-text">「合并」是本机已有同一条记录，沿用原记录、不重复建档。</div>`,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">知道了</button>`,
    });
  }

  async function loadOperator() {
    const sel = document.getElementById("operator-user");
    if (!sel) return;
    const people = (App.lookups.person || []).map((p) => p.value);
    if (App.user && !people.includes(App.user)) people.unshift(App.user);
    sel.innerHTML = people.map((u) => `<option>${esc(u)}</option>`).join("");
    sel.value = App.user || people[0] || "";
    document.getElementById("operator-current").textContent = App.user || "未署名";
    document.getElementById("operator-confirm").onclick = () => {
      const next = sel.value; if (!next || next === App.user) return fail("请选择不同的操作人");
      confirmDialog(`确认切换操作人账户为${next}吗？`, async () => {
        App.user = next; localStorage.setItem("regtrack.user", next);
        document.getElementById("operator-current").textContent = next;
        const display = document.getElementById("current-user"); if (display) display.textContent = next;
        ok("当前操作人已切换为 " + next);
      });
    };
  }

  async function reload() {
    App.lookups = await get("/api/lookups");
    await load();
  }

  function openForm(category, row) {
    Forms.formModal({
      title: row ? `编辑 ${row.value}` : `新增${CATS[category]}`,
      subtitle: `字典 · ${category}`,
      size: "md",
      fields: [
        { name: "value", label: "值", cn: "写入业务记录的内容", type: "text", required: true, col: 12 },
        { name: "note", label: "说明", cn: "下拉框里显示在值下方", type: "text", col: 12,
          help: "例如人员写所在部门，机构写全称，方便同事确认选的是不是那一条。" },
      ],
      values: row || {},
      submitText: row ? "保存" : "新增",
      async onSubmit(payload, m) {
        if (row) await put(`/api/lookups/${row.id}`, payload);
        else await post(`/api/lookups/${category}`, payload);
        ok(row ? "已保存" : "已新增");
        await m.close();
        await reload();
      },
    });
  }

  await load();
  await loadTransferUsers();
  await loadOperator();
});
