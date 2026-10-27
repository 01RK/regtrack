/* 下拉框工厂。
   原则：选项里冗余显示足以让人一眼确认「就是这一条」的信息
   —— 标准显示编号 + 名称 + 阶段 + 归口 + 草案数，草案显示版本 + 日期。 */
(function () {
  "use strict";

  const { esc, get, post, ok, fail, openModal, REPOSITION, t, label } = window.App;

  function destroy(el) {
    if (el.tomselect) el.tomselect.destroy();
  }

  /** 销毁容器内所有下拉框。面板挂在 body 上，重建表单或关弹窗时必须显式清理。 */
  function destroyIn(host) {
    host.querySelectorAll("select, input").forEach(destroy);
  }

  const base = {
    maxOptions: 60,
    plugins: ["dropdown_input"],
    render: {
      no_results: () => `<div class="no-results">${t("没有匹配项", "No matches")}</div>`,
    },
  };

  /**
   * 面板挂在哪里：弹窗内的下拉框挂到 .modal 本身，页面上的挂到 body。
   *
   * 不挂在控件内部，是为了脱离 .modal-body 这个滚动容器 —— 否则面板会被裁切，
   * 展开时还会把弹窗撑大。也不能一律挂到 body：Bootstrap 弹窗会把焦点强行
   * 收回弹窗内，body 上的搜索框一拿到焦点就被抢走，面板随即关闭。
   * .modal 铺满视口且不产生定位上下文，面板按 fixed 定位不会被它裁切。
   */
  const panelHost = (el) => el.closest(".modal") || document.body;

  const GAP = 4;            // 面板与输入框的间距
  const MIN_ROOM = 132;     // 低于这个高度就改为向上展开
  const MAX_ROOM = 320;     // 面板最高高度

  /**
   * 让下拉面板浮在输入框旁边：跟随控件位置、按可用空间决定向下还是向上展开，
   * 并把可滚动区域限制在剩余空间内，面板再长也不会顶破视口。
   */
  function floatDropdown(ts) {
    const place = () => {
      const box = ts.control.getBoundingClientRect();
      const dd = ts.dropdown;
      const list = dd.querySelector(".ts-dropdown-content");
      const extra = dd.offsetHeight - (list ? list.offsetHeight : 0);
      const below = window.innerHeight - box.bottom - GAP;
      const above = box.top - GAP;
      const up = below < MIN_ROOM && above > below;
      // 留 1px 余量，避免边框取整后面板刚好压线越出视口
      const room = Math.max(MIN_ROOM, Math.min(MAX_ROOM, (up ? above : below) - 1));

      dd.style.position = "fixed";
      dd.style.width = box.width + "px";
      dd.style.left = Math.round(box.left) + "px";
      dd.style.top = up ? "auto" : Math.round(box.bottom + GAP) + "px";
      dd.style.bottom = up ? Math.round(window.innerHeight - box.top + GAP) + "px" : "auto";
      if (list) list.style.maxHeight = Math.max(80, room - extra) + "px";
    };

    // Tom Select 在打开、页面滚动、窗口缩放时都会调用 positionDropdown。
    ts.positionDropdown = place;
    const follow = () => { if (ts.isOpen) place(); };
    ts.on("dropdown_open", () => {
      place();
      window.addEventListener(REPOSITION, follow);
      document.addEventListener("scroll", follow, true);   // 捕获阶段：弹窗内部滚动也能跟上
    });
    ts.on("dropdown_close", () => {
      window.removeEventListener(REPOSITION, follow);
      document.removeEventListener("scroll", follow, true);
    });
    return ts;
  }

  /** 所有下拉框的统一入口：清掉旧实例、套用公共配置、接上浮动面板。 */
  function create(el, settings) {
    destroy(el);
    const ts = new TomSelect(el, Object.assign({}, base, settings, {
      dropdownParent: panelHost(el),
    }));
    return floatDropdown(ts);
  }

  function optionHtml(title, parts) {
    const sub = parts.filter(Boolean).map((p) => `<span>${p}</span>`).join("");
    return `<div><div class="opt-title">${title}</div>${sub ? `<div class="opt-sub">${sub}</div>` : ""}</div>`;
  }

  /* ----------------------------------------------------------- 标准 */
  /**
   * 可搜索的标准下拉。opts.recommended：推荐匹配的标准（可带 name_similarity / similarity），
   * 置顶为「推荐匹配」一组；其余标准在「全部标准」一组中，输入编号或名称即从服务端搜索。
   */
  function standard(el, opts = {}) {
    const recommendedIds = new Set((opts.recommended || []).map((s) => String(s.id)));
    const grouped = !!opts.recommended;
    const tag = (rows, group) => rows.map((s) => Object.assign({}, s, { group }));
    const similarity = (d) => {
      const value = d.name_similarity !== undefined ? Math.round(d.name_similarity * 100) : d.similarity;
      return value === undefined ? "" : `<b class="opt-match">${t(`名称相似度 ${value}%`, `${value}% name match`)}</b>`;
    };
    const ts = create(el, {
      valueField: "id",
      labelField: "std_no",
      searchField: ["std_no", "name_cn", "name_en"],
      preload: true,
      maxItems: opts.multiple ? null : 1,
      options: tag(opts.recommended || [], "recommended"),
      optgroupField: grouped ? "group" : "optgroup",
      optgroups: grouped ? [
        { value: "recommended", label: t("推荐匹配", "Suggested matches") },
        { value: "all", label: t("全部标准 · 输入编号或名称搜索", "All standards · type a number or name to search") },
      ] : [],
      lockOptgroupOrder: true,
      placeholder: opts.placeholder || t("按编号或名称搜索标准…", "Search standards by number or name…"),
      load(query, callback) {
        get("/api/standards/options", { q: query })
          .then((rows) => callback(rows.filter((s) => !recommendedIds.has(String(s.id))).map((s) => Object.assign(s, { group: "all" }))))
          .catch(() => callback());
      },
      render: Object.assign({}, base.render, {
        optgroup_header: (d, e) => `<div class="optgroup-header">${e(d.label)}</div>`,
        option: (d, e) => optionHtml(
          `${e(d.std_no || t("尚未编号", "No number yet"))} <span style="font-weight:400">${e(d.name_cn)}</span>`,
          [similarity(d),
           `<b>${e(window.App.stageLabel(d.stage_code))}</b>`,
           d.tc_wg ? e(d.tc_wg) : "",
           d.mb_owner ? t("负责人 ", "Owner ") + e(d.mb_owner) : "",
           d.draft_count === undefined ? "" : t(`草案 ${d.draft_count} 版`, `${d.draft_count} draft(s)`)]),
        item: (d, e) => `<div>${e(d.std_no || t("尚未编号", "No number yet"))} <span style="color:#7b8899">${e(d.name_cn)}</span></div>`,
      }),
      onChange: opts.onChange,
    });
    // 固定在下拉框底部，不随搜索结果滚动；用于没有匹配项时就地建档。
    if (opts.quickCreate !== false) {
      const footer = document.createElement("div");
      footer.className = "ts-fixed-create";
      footer.innerHTML = `<button type="button" class="btn btn-outline-secondary btn-sm">${window.App.uiText("+ 没有此标准？快速建档", "+ Not listed? Create a standard")}</button>`;
      ts.dropdown.appendChild(footer);
      footer.querySelector("button").onclick = () => {
        const prefill = (ts.control_input && ts.control_input.value || "").trim();
        const quickPrefill = opts.quickCreatePrefill || {};
        quickCreateStandard(quickPrefill.std_no || prefill, (created) => {
          ts.addOption(created);
          ts.addItem(String(created.id));
          if (opts.onQuickCreate) opts.onQuickCreate(created);
        }, quickPrefill.name_cn || "");
      };
    }
    const preselect = opts.value === undefined || opts.value === null || opts.value === ""
      ? []
      : (Array.isArray(opts.value) ? opts.value : [opts.value]);
    preselect.forEach((id) => {
      if (ts.options[String(id)]) {
        ts.addItem(String(id), true);
        return;
      }
      get(`/api/standards/${id}`).then((s) => {
        ts.addOption(s);
        ts.addItem(String(s.id), true);
      }).catch(() => {});
    });
    return ts;
  }

  /* ----------------------------------------------------------- 草案 */
  function draft(el, opts = {}) {
    const ts = create(el, {
      valueField: "id",
      labelField: "version_name",
      searchField: ["version_name", "sub_version_no", "draft_date"],
      placeholder: opts.standardId ? t("选择草案版本…", "Select a draft version…") : t("请先选择标准", "Select a standard first"),
      render: Object.assign({}, base.render, {
        option: (d, e) => optionHtml(
          `${e(d.version_name)} <span style="font-weight:400">v${e(d.sub_version_no)}</span>`,
          [e(d.draft_date), d.overall_impact ? t("总体影响 ", "Impact ") + e(d.overall_impact) : ""]),
        item: (d, e) => `<div>${e(d.version_name)} v${e(d.sub_version_no)} <span style="color:#7b8899">${e(d.draft_date || "")}</span></div>`,
      }),
      onChange: opts.onChange,
    });
    const setHint = (text) => {
      ts.settings.placeholder = text;
      if (ts.control_input) ts.control_input.setAttribute("placeholder", text);
    };
    ts.reload = (standardId, keep) => {
      if (!keep) ts.clear(true);
      ts.clearOptions();
      if (!standardId) {
        setHint(t("请先选择标准", "Select a standard first"));
        ts.disable();
        return Promise.resolve([]);
      }
      ts.enable();
      return get("/api/drafts/options", { standard_id: standardId }).then((rows) => {
        ts.addOptions(rows);
        setHint(rows.length ? t("选择草案版本…", "Select a draft version…") : t("该标准还没有登记草案", "No drafts registered for this standard"));
        if (keep && opts.value) ts.addItem(String(opts.value), true);
        return rows;
      });
    };
    ts.reload(opts.standardId, true);
    return ts;
  }

  /** 先选标准、再选该标准下的草案版本；草案变化时回调草案 id（未选为 null）。 */
  function standardDraft(standardEl, draftEl, onDraft) {
    const draftTs = draft(draftEl, { onChange: (value) => onDraft(value ? Number(value) : null) });
    standard(standardEl, {
      quickCreate: false,
      onChange: (value) => { draftTs.reload(value || null); onDraft(null); },
    });
    return draftTs;
  }

  /* ----------------------------------------------------------- 会议 */
  function meeting(el, opts = {}) {
    const ts = create(el, {
      valueField: "id",
      labelField: "title",
      searchField: ["title", "meeting_no"],
      preload: true,
      placeholder: t("按会议名称或会议号搜索…", "Search meetings by title or number…"),
      load(query, callback) {
        get("/api/meetings/options", { q: query }).then(callback).catch(() => callback());
      },
      render: Object.assign({}, base.render, {
        option: (d, e) => optionHtml(
          `${e(d.meeting_no)} <span style="font-weight:400">${e(d.title)}</span>`,
          [e(d.meeting_date), d.meeting_type ? e(d.meeting_type) : ""]),
        item: (d, e) => `<div>${e(d.meeting_no)} <span style="color:#7b8899">${e(d.title)}</span></div>`,
      }),
      onChange: opts.onChange,
    });
    if (opts.value) {
      get("/api/meetings/options").then((rows) => {
        ts.addOptions(rows);
        ts.addItem(String(opts.value), true);
      });
    }
    return ts;
  }

  /* ------------------------------------------------- 字典（可现场新增） */
  const NEW_NOTE = t("本次新增", "New");
  function lookup(el, opts = {}) {
    const rows = (window.App.lookups[opts.category] || []).filter((r) => r.is_active);
    const ts = create(el, {
      valueField: "value",
      labelField: "value",
      searchField: ["value", "note"],
      options: rows,
      maxItems: opts.multiple ? null : 1,
      placeholder: opts.placeholder || t("搜索或直接输入新值…", "Search or type a new value…"),
      create: opts.create === false ? false : (input) => ({ value: input, note: NEW_NOTE }),
      createFilter: (input) => input.trim().length > 0,
      render: Object.assign({}, base.render, {
        option: (d, e) => optionHtml(e(d.value), [d.note ? e(d.note) : ""]),
        item: (d, e) => `<div>${e(d.value)}</div>`,
        option_create: (d, e) => `<div class="create">${t(`新增「${e(d.input)}」并写入字典`, `Add "${e(d.input)}" to the dictionary`)}</div>`,
      }),
      onChange: opts.onChange,
      // 现场新增的值不再单独发一次请求：保存业务记录时后端会在同一个事务里
      // 把它补进字典。少一次并发写，既避免数据库写锁，也不会出现
      // 「字典写进去了但记录没存上」的半截状态。
      onOptionAdd(value, data) {
        if (data && data.note === NEW_NOTE) ok(t(`「${value}」将随本条记录一并写入字典`, `"${value}" will be added to the dictionary when this record is saved`));
      },
    });
    if (opts.value) {
      const vals = Array.isArray(opts.value) ? opts.value : [opts.value];
      vals.forEach((v) => {
        if (v && !ts.options[v]) ts.addOption({ value: v, note: "" });
        if (v) ts.addItem(v, true);
      });
    }
    return ts;
  }

  /* ------------------------- 任意选项列表（值与显示分离，可带副标题） */
  function choices(el, opts = {}) {
    const ts = create(el, {
      valueField: "value",
      labelField: "text",
      searchField: ["text", "sub"],
      options: opts.options || [],
      disabledField: "disabled",
      maxItems: opts.multiple ? null : 1,
      allowEmptyOption: true,
      placeholder: opts.placeholder || t("请选择…", "Select…"),
      render: Object.assign({}, base.render, {
        option: (d, e) => optionHtml(e(d.text), [d.sub ? e(d.sub) : ""]),
        item: (d, e) => `<div>${e(d.text)}</div>`,
      }),
      onChange: opts.onChange,
    });
    if (opts.value !== undefined && opts.value !== null && opts.value !== "") {
      ts.addItem(String(opts.value), true);
    }
    return ts;
  }

  /* -------------------------------------------------------- 固定取值 */
  function fixed(el, opts = {}) {
    const items = (opts.options || []).map((v) =>
      typeof v === "string" ? { value: v, text: v } : v);
    const ts = create(el, {
      valueField: "value",
      labelField: "text",
      searchField: ["text"],
      options: items,
      disabledField: "disabled",
      maxItems: opts.multiple ? null : 1,
      allowEmptyOption: true,
      openOnFocus: true,
      placeholder: opts.placeholder || t("请选择…", "Select…"),
      render: Object.assign({}, base.render, {
        option: (d, e) => `<div>${e(d.text ?? d.value ?? "")}</div>`,
        item: (d, e) => `<div>${e(d.text ?? d.value ?? "")}</div>`,
      }),
      onChange: opts.onChange,
    });
    if (opts.value) ts.addItem(opts.value, true);
    return ts;
  }

  /* -------------------------------- 搜不到标准 → 就地新建，建完自动选中 */
  function quickCreateStandard(prefill, onCreated, namePrefill = "") {
    const stages = window.App.stageList();
    const m = openModal({
      title: t("新建标准主档", "New Standard Profile"),
      subtitle: t("Standard Profile · 快速建档", "Standard Profile · Quick create"),
      size: "md",
      body: `
        <p class="form-text" style="margin-bottom:12px">
          ${t("系统里还没有这个标准。填写名称和当前阶段即可建档，保存后自动回到刚才的位置并选中。更早的阶段可以随后用「推进 / 补录阶段」补齐，其余信息在标准主档补充。",
              "This standard is not in the system yet. Enter the name and current stage to create it; it will be selected when you return. Earlier stages can be added later with Advance / Backfill Stage, and other details in the Standard Profile.")}
        </p>
        <div class="form-grid">
          <div class="f-12">
            <label class="form-label" for="qc-no">${label("Standard No.", "标准编号")}</label>
            <input class="form-control" id="qc-no" placeholder="${t("如 GB 38031—2025", "e.g. GB 38031—2025")}" value="${esc(prefill || "")}">
          </div>
          <div class="f-12">
            <label class="form-label" for="qc-name">${label("Standard Name CN", "中文名称")}<span class="req">*</span></label>
            <input class="form-control" id="qc-name" value="${esc(namePrefill)}">
          </div>
          <div class="f-12">
            <label class="form-label" for="qc-stage">${label("Current Stage", "当前阶段")}<span class="req">*</span></label>
            <select class="form-select" id="qc-stage">
              ${stages.map((s) => `<option value="${esc(s.code)}">${esc(window.App.stageLabel(s.code))}</option>`).join("")}
            </select>
          </div>
          <div class="f-12">
            <label class="form-label" for="qc-date">${label("Stage Entry Date", "阶段进入日期")}</label>
            <input type="date" class="form-control" id="qc-date" value="${new Date().toISOString().slice(0, 10)}">
          </div>
        </div>`,
      footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${window.App.uiText("取消", "Cancel")}</button>
               <button class="btn btn-primary btn-sm" data-save>${window.App.uiText("建档并选中", "Create and select")}</button>`,
    });
    const q = (id) => m.el.querySelector(id);
    q("#qc-name").focus();
    m.footer.querySelector("[data-save]").onclick = async () => {
      try {
        const created = await post("/api/standards", {
          std_no: q("#qc-no").value,
          name_cn: q("#qc-name").value,
          stage_code: q("#qc-stage").value,
          stage_effective_date: q("#qc-date").value,
        });
        ok(t(`已建档 ${created.std_no || created.name_cn}`, `Created ${created.std_no || created.name_cn}`));
        await m.close();
        onCreated(created);
      } catch (e) {
        fail(e.message);
      }
    };
  }

  window.Fields = { standard, draft, standardDraft, meeting, lookup, fixed, choices, quickCreateStandard, destroyIn };
})();
