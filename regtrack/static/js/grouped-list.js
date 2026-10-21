/* 标准分组列表：统一负责组标题、展开收起与当前页状态。 */
(function () {
  "use strict";

  function create(body, expandButton, collapseButton, { defaultCollapsed = false } = {}) {
    const storageKey = `regtrack.grouped-list:${location.pathname}:${body.id}`;
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{"collapsed":[],"expanded":[]}');
    const collapsed = new Set(saved.collapsed);
    const expanded = new Set(saved.expanded);
    const seen = new Set([...collapsed, ...expanded]);
    let currentKeys = [];

    function saveState() {
      sessionStorage.setItem(storageKey, JSON.stringify({
        collapsed: [...collapsed],
        expanded: [...expanded],
      }));
    }

    function keyOf(value) {
      return String(value);
    }

    function header(group, colCount) {
      const key = keyOf(group.group_key);
      const closed = collapsed.has(key);
      const standardId = group.standard_id;
      const countLabel = App.t(`符合 ${group.item_count} 条`, `${group.item_count} matching`);
      const latest = group.latest_created_at ? App.t(`最新登记 ${group.latest_created_at}`, `Latest ${group.latest_created_at}`) : "";
      return `<tr class="standard-group-row" data-group-row="${App.esc(key)}">
        <td colspan="${colCount}">
          <button type="button" class="standard-group-toggle" aria-expanded="${closed ? "false" : "true"}"
                  title="${closed ? App.t("展开", "Expand") : App.t("收起", "Collapse")} ${App.esc(group.std_no)}">
            <span class="group-chevron" aria-hidden="true">${closed ? "▸" : "▾"}</span>
            <span class="group-standard-no">${App.esc(group.std_no)}</span>
            <span class="group-standard-name">${App.esc(group.name_cn)}</span>
            ${standardId === null ? `<span class="tag muted">${App.t("未关联", "Unlinked")}</span>` : ""}
            <span class="group-summary">${App.esc(countLabel)}${latest ? ` · ${App.esc(latest)}` : ""}</span>
          </button>
        </td>
      </tr>`;
    }

    function itemAttrs(group) {
      const key = keyOf(group.group_key);
      return `data-group-item="${App.esc(key)}"${collapsed.has(key) ? " hidden" : ""}`;
    }

    function render(groups, colCount, itemRenderer) {
      currentKeys = groups.map((group) => keyOf(group.group_key));
      currentKeys.forEach(key => {
        if (!seen.has(key) && defaultCollapsed) collapsed.add(key);
        seen.add(key);
      });
      body.innerHTML = groups.map((group) =>
        header(group, colCount) + group.items.map((item) =>
          itemRenderer(item, itemAttrs(group))).join("")
      ).join("");
      bindHeaders();
    }

    function apply(key, shouldCollapse) {
      if (shouldCollapse) {
        collapsed.add(key);
        expanded.delete(key);
      } else {
        collapsed.delete(key);
        expanded.add(key);
      }
      saveState();
      const groupRow = Array.from(body.querySelectorAll("[data-group-row]"))
        .find((row) => row.dataset.groupRow === key);
      if (groupRow) {
        const button = groupRow.querySelector(".standard-group-toggle");
        const chevron = groupRow.querySelector(".group-chevron");
        button.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
        button.title = `${shouldCollapse ? App.t("展开", "Expand") : App.t("收起", "Collapse")} ${groupRow.querySelector(".group-standard-no").textContent}`;
        chevron.textContent = shouldCollapse ? "▸" : "▾";
      }
      body.querySelectorAll("[data-group-item]").forEach((row) => {
        if (row.dataset.groupItem === key) row.hidden = shouldCollapse;
      });
    }

    function bindHeaders() {
      body.querySelectorAll("[data-group-row]").forEach((row) => {
        row.querySelector(".standard-group-toggle").onclick = () => {
          const key = row.dataset.groupRow;
          apply(key, !collapsed.has(key));
        };
      });
    }

    function expandAll() {
      currentKeys.forEach((key) => apply(key, false));
    }

    function collapseAll() {
      currentKeys.forEach((key) => apply(key, true));
    }

    function reset() {
      collapsed.clear();
      expanded.clear();
      seen.clear();
      saveState();
    }

    if (expandButton) expandButton.onclick = expandAll;
    if (collapseButton) collapseButton.onclick = collapseAll;

    return { render, reset, expandAll, collapseAll };
  }

  window.GroupedList = { create };
})();
