/* 总览 · 标准生命周期回顾（泳道式时间轴）
   整个视图是一张看板：每个阶段一列，列头就是生命周期链上的节点，
   该阶段的会议、草案、意见卡片从节点下方垂挂排列。
   看板本身是铺满剩余屏幕高度的滚动区，链条吸顶；横向滚动时链条与各列同步。
   列宽用 CSS 变量表达，面板宽度变化时由容器查询统一调整。
   网址状态由 dashboard.js 维护，本模块只负责选择标准与渲染。 */
(function () {
  "use strict";

  const { esc, dash, get } = window.App;

  // 意见状态分组：总览环形图与本页筛选共用。
  const COMMENT_GROUPS = [
    { key: "accepted", label: "采纳", color: "#2f8f6d", statuses: ["Accepted"] },
    { key: "partial", label: "部分采纳", color: "#d69a2d", statuses: ["Partially Accepted"] },
    { key: "rejected", label: "不采纳", color: "#c8453c", statuses: ["Rejected"] },
    { key: "open", label: "进行中", color: "#3479b3", statuses: ["Draft", "Submitted", "Pending"] },
    { key: "withdrawn", label: "已撤回", color: "#9aa6b4", statuses: ["Withdrawn"] },
  ];
  const GROUP_OF = Object.fromEntries(
    COMMENT_GROUPS.flatMap((g) => g.statuses.map((s) => [s, g.key])));
  const GROUP_LABEL = Object.fromEntries(COMMENT_GROUPS.map((g) => [g.key, g.label]));
  const RISK_TEXT = { High: "高风险", Medium: "中风险", Low: "低风险", TBD: "风险待定" };

  const PREVIEW = 8;        // 每列默认显示的意见条数
  // 终止阶段（废止）以红色标示，取值由 /api/meta 下发的阶段编码决定
  const isTerminal = (st) => window.App.isTerminalStage(st.code);
  const STATE_TEXT = { done: "已完成", current: "当前阶段", future: "未进入" };

  let body, panel, exportBtn, profileBtn, fullscreenBtn, standardId = null, data = null;
  // 在详情弹窗里改过记录后重新载入时保留浏览状态；切换标准时清空。
  const view = { q: "", group: "", showAll: new Set(), opened: new Set() };

  const today = () => new Date().toISOString().slice(0, 10);
  const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  const isEmpty = (st) => !(st.meetings.length || st.drafts.length || st.comments.length);

  function init({ standardId: initial, onSelect }) {
    body = document.getElementById("lc-body");
    panel = body.closest(".lc-panel");
    exportBtn = document.getElementById("lc-export");
    profileBtn = document.getElementById("lc-profile");
    fullscreenBtn = document.getElementById("lc-fullscreen");
    profileBtn.onclick = () => Records.open("standard", standardId, ctx);
    fullscreenBtn.onclick = () => setImmersive(!isImmersive());
    // 沉浸查看期间按 Esc 退出，和真全屏的习惯一致；
    // 弹窗开着的时候 Esc 先关弹窗，这里就不插手。
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && isImmersive() && !document.querySelector(".modal.show")) {
        setImmersive(false);
      }
    });
    Fields.standard(document.getElementById("lc-standard"), {
      quickCreate: false,
      value: initial,
      placeholder: "搜索并选择要回顾的标准…",
      onChange: (value) => {
        const id = value ? Number(value) : null;
        if (id === standardId) return;
        Object.assign(view, { q: "", group: "" });
        view.showAll.clear();
        view.opened.clear();
        onSelect(id);
        load(id);
      },
    });
    body.addEventListener("click", onClick);
    body.addEventListener("input", (ev) => {
      if (ev.target.id !== "lc-q") return;
      view.q = ev.target.value.trim();
      refreshComments();
    });
    window.addEventListener("resize", fitBoard);
    load(initial);
  }

  /* 沉浸查看。
     原先用的是浏览器全屏 API（panel.requestFullscreen()）：全屏期间浏览器只绘制
     全屏元素及其子节点，而弹窗和遮罩都挂在 body 下，于是点开卡片什么也看不到。
     改成把面板铺满视口的一层覆盖：弹窗照常盖在它上面，Esc 退出，
     行为和全屏一样，实用性却不受影响。 */
  const isImmersive = () => panel.classList.contains("is-immersive");

  function setImmersive(active) {
    panel.classList.toggle("is-immersive", active);
    document.documentElement.classList.toggle("lc-immersive", active);
    fullscreenBtn.classList.toggle("active", active);
    fullscreenBtn.querySelector("span").textContent = active ? "退出沉浸" : "沉浸查看";
    fullscreenBtn.setAttribute("aria-pressed", String(active));
    fitBoard();
  }

  async function load(id) {
    standardId = id;
    exportBtn.classList.toggle("disabled", !id);
    exportBtn.setAttribute("href", id ? `/api/standards/${id}/lifecycle.md` : "#");
    profileBtn.disabled = !id;
    if (!id) {
      data = null;
      body.innerHTML = `
        <div class="lc-blank">
          <div class="lc-blank-art"><i></i><i></i><i></i><i></i></div>
          <b>选择一个标准，回顾它的制定过程</b>
          <span>每个阶段节点下方会挂出该阶段的工作组会议、草案版本与意见，可一键导出为 Markdown 知识库文件</span>
        </div>`;
      return;
    }
    body.innerHTML = '<div class="lc-blank"><span>载入中…</span></div>';
    let payload;
    try {
      payload = await get(`/api/standards/${id}/lifecycle`);
    } catch (e) {
      data = null;
      body.innerHTML = `<div class="lc-blank"><b>无法载入该标准</b><span>${esc(e.message)}</span></div>`;
      return;
    }
    if (id !== standardId) return;
    data = payload;
    render();
  }

  const ctx = { onChanged: () => load(standardId) };

  /* ------------------------------------------------------------ 渲染 */
  function render() {
    const { standard: s, stages } = data;
    // 列宽：未来阶段与空阶段收窄；有内容的阶段按意见量适当加宽。
    // 所有阶段都没有记录时，空列平分宽度，避免右侧留白。
    const anyContent = stages.some((st) => st.state !== "future" && !isEmpty(st));
    const columns = stages.map((st) => {
      if (st.state === "future") return "var(--lane-future)";
      if (isEmpty(st)) return anyContent ? "var(--lane-empty)" : "minmax(var(--lane-empty), 1fr)";
      return `minmax(var(--lane-min), ${(1 + Math.min(st.comments.length, 30) / 15).toFixed(2)}fr)`;
    }).join(" ");

    body.innerHTML = `
      ${hero(s)}
      ${filterBar(stages)}
      <div class="lc-board">
        <div class="lc-grid" style="grid-template-columns:${columns}">
          ${stages.map((st, i) => node(st, i, stages.length)).join("")}
          ${stages.map((st, i) => lane(st, i)).join("")}
        </div>
      </div>`;
    refreshComments();
    fitBoard();
  }

  /** 看板高度铺满首屏剩余空间，使链条吸顶发生在看板内部，页面本身无需滚动。 */
  function fitBoard() {
    const board = body && body.querySelector(".lc-board");
    if (!board) return;
    // 沉浸查看时面板是钉在视口上的，位置本来就以视口为准，不能再加滚动距离
    const rect = board.getBoundingClientRect();
    const top = isImmersive() ? rect.top : rect.top + window.scrollY;
    board.style.height = Math.max(420, window.innerHeight - top - 20) + "px";
  }

  function hero(s) {
    const facts = [
      ["TC / WG", s.tc_wg], ["牵头单位", s.leading_org], ["公司负责人", s.mb_owner],
      [s.actual_release_date ? "发布" : "计划发布", s.actual_release_date || s.planned_release_date],
      ["实施", s.effective_date],
    ].filter(([, v]) => v);
    // 关键字段排在标准名称右侧：概况卡矮一截，省下的高度全给下面的泳道。
    return `
      <section class="lc-hero">
        <div class="lc-id">
          <div class="lc-badges">
            <span class="lc-code">${esc(s.std_no)}</span>
            ${s.std_type ? `<span class="lc-chip">${esc(s.std_type)}</span>` : ""}
            ${s.risk_level ? `<span class="lc-risk risk-${esc(s.risk_level)}">${esc(RISK_TEXT[s.risk_level])}</span>` : ""}
            ${(s.impact_area_list || []).map((a) => `<span class="lc-chip ghost">${esc(a)}</span>`).join("")}
          </div>
          <h2 class="lc-name">${esc(s.name_cn)}</h2>
          ${s.name_en ? `<div class="lc-en">${esc(s.name_en)}</div>` : ""}
        </div>
        <dl class="lc-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      </section>`;
  }

  function filterBar(stages) {
    const all = stages.flatMap((st) => st.comments);
    if (!all.length) return "";
    const count = (key) => all.filter((c) => GROUP_OF[c.status] === key).length;
    const chips = [{ key: "", label: "全部", n: all.length }]
      .concat(COMMENT_GROUPS.map((g) => ({ key: g.key, label: g.label, n: count(g.key), color: g.color })))
      .filter((g) => g.n)
      .map((g) => `
        <button type="button" data-group="${g.key}" class="${g.key === view.group ? "active" : ""}">
          ${g.color ? `<i style="background:${g.color}"></i>` : ""}${esc(g.label)}<span>${g.n}</span>
        </button>`).join("");
    return `
      <div class="lc-filter">
        <div class="lc-groups" role="group" aria-label="按意见结果筛选">${chips}</div>
        <label class="lc-search">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
          <input id="lc-q" type="search" placeholder="搜索意见：编号 / 条款 / 主题 / 内容" value="${esc(view.q)}">
        </label>
        <span class="lc-hit" id="lc-hit"></span>
      </div>`;
  }

  /* ------------------------------------------------ 链条节点（列头） */
  function node(st, i, total) {
    const cls = ["lc-node", `is-${st.state}`, i === 0 ? "first" : "", i === total - 1 ? "last" : "",
      isTerminal(st) ? "is-terminal" : ""].filter(Boolean).join(" ");
    const at = `style="grid-column:${i + 1}"`;
    if (st.state === "future") {
      return `
        <div class="${cls}" ${at} title="${esc(st.name)} · 尚未进入">
          <span class="dot"></span>
          <span class="name">${esc(st.name)}</span>
          <span class="date">未进入</span>
        </div>`;
    }
    const pills = [["m", "会议", st.meetings.length], ["d", "草案", st.drafts.length], ["c", "意见", st.comments.length]]
      .filter(([, , n]) => n)
      .map(([k, l, n]) => `<i class="pill-${k}" data-pill="${k}${i}" data-label="${l}">${l} ${n}</i>`).join("");
    const range = isEmpty(st) ? esc(st.start) : `${esc(st.start)} → ${st.end ? esc(st.end) : "至今"}`;
    return `
      <div class="${cls}" ${at} title="${esc(st.name)} · ${STATE_TEXT[st.state]}${st.note ? "\n" + esc(st.note) : ""}">
        <span class="dot"></span>
        <span class="name">${esc(st.name)}${st.state === "current" ? `<em class="now">${isTerminal(st) ? "已废止" : "当前"}</em>` : ""}</span>
        <span class="date">${range}</span>
        ${st.record_type === "BACKFILL" ? '<span class="lc-backfill">历史补录</span>' : ""}
        ${isEmpty(st) ? "" : `<span class="dur">${days(st.start, st.end || today())} 天</span>`}
        ${pills ? `<span class="pills">${pills}</span>` : ""}
      </div>`;
  }

  /* ------------------------------------------------ 泳道（节点下方） */
  function lane(st, i) {
    const cls = `lc-lane is-${st.state}`;
    const at = `style="grid-column:${i + 1}"`;
    if (st.state === "future") return `<div class="${cls}" ${at}></div>`;
    if (isEmpty(st)) return `<div class="${cls} is-empty" ${at}><span class="lc-void">无记录</span></div>`;
    // 阶段说明作为泳道的第一块「标签」挂在吊线顶端。
    return `
      <div class="${cls}" ${at}>
        ${st.note ? `<div class="lc-note">${esc(st.note)}</div>` : ""}
        ${st.meetings.map(meetingCard).join("")}
        ${st.drafts.map(draftCard).join("")}
        <div class="lc-comments" data-comments="${i}"></div>
      </div>`;
  }

  function meetingCard(m) {
    return `
      <button type="button" class="lc-card kind-meeting" data-open="meeting:${m.id}">
        <span class="lc-card-top"><span class="lc-kind">会议</span><span class="lc-when">${esc(m.meeting_date)}</span></span>
        <span class="lc-card-title">${esc(m.title)}</span>
        <span class="lc-card-meta">${esc(m.meeting_no)}${m.meeting_type ? " · " + esc(m.meeting_type) : ""}</span>
        ${m.overall_conclusion ? `<span class="lc-card-text"><b>结论</b>${esc(m.overall_conclusion)}</span>` : ""}
      </button>`;
  }

  function draftCard(d) {
    return `
      <button type="button" class="lc-card kind-draft" data-open="draft:${d.id}">
        <span class="lc-card-top"><span class="lc-kind">草案</span><span class="lc-when">${esc(d.draft_date)}</span></span>
        <span class="lc-card-title">${esc(d.version_name)}<span class="lc-ver">v${esc(d.sub_version_no)}</span></span>
        <span class="lc-card-meta">条款变化 ${d.clause_count} 条${d.overall_impact ? ` · 影响 ${esc(d.overall_impact)}` : ""}</span>
        ${d.main_summary ? `<span class="lc-card-text">${esc(d.main_summary)}</span>` : ""}
      </button>`;
  }

  /* ---------------------------------------------------------- 意见 */
  function matches(c) {
    if (view.group && GROUP_OF[c.status] !== view.group) return false;
    if (!view.q) return true;
    const q = view.q.toLowerCase();
    return [c.comment_no, c.clause_no, c.topic, c.comment_text, c.response, c.submitted_by]
      .some((v) => v && String(v).toLowerCase().includes(q));
  }

  function refreshComments() {
    const filtering = !!(view.q || view.group);
    let shown = 0, total = 0;
    data.stages.forEach((st, i) => {
      const host = body.querySelector(`[data-comments="${i}"]`);
      if (!host) return;
      const hits = st.comments.filter(matches);
      total += st.comments.length;
      shown += hits.length;
      host.innerHTML = commentBlock(st, hits, filtering);
      const pill = body.querySelector(`[data-pill="c${i}"]`);
      if (pill) {
        pill.textContent = filtering ? `意见 ${hits.length}/${st.comments.length}` : `意见 ${st.comments.length}`;
        pill.classList.toggle("is-miss", filtering && !hits.length);
      }
    });
    const hit = body.querySelector("#lc-hit");
    if (hit) hit.textContent = filtering ? `命中 ${shown} / ${total} 条` : "";
  }

  function commentBlock(st, hits, filtering) {
    if (!st.comments.length) return "";
    const head = `<div class="lc-sep"><span>意见 ${filtering ? `${hits.length} / ` : ""}${st.comments.length}</span></div>`;
    if (!hits.length) return head + '<div class="lc-void">无匹配意见</div>';
    // 筛选时展示全部命中；否则默认只展示前 PREVIEW 条。
    const expanded = filtering || view.showAll.has(st.name);
    const rows = expanded ? hits : hits.slice(0, PREVIEW);
    const rest = hits.length - rows.length;
    let toggle = "";
    if (rest > 0) {
      toggle = `<button type="button" class="lc-more" data-more="${esc(st.name)}">显示其余 ${rest} 条</button>`;
    } else if (!filtering && hits.length > PREVIEW) {
      toggle = `<button type="button" class="lc-more" data-less="${esc(st.name)}">收起</button>`;
    }
    return head + rows.map(commentCard).join("") + toggle;
  }

  function commentCard(c) {
    const open = view.opened.has(c.id);
    const group = GROUP_OF[c.status];
    return `
      <div class="lc-comment tone-${group}${open ? " open" : ""}" data-comment="${c.id}">
        <button type="button" class="lc-comment-face" aria-expanded="${open}">
          <span class="lc-card-top">
            <span class="no">${esc(c.comment_no)}</span>
            <span class="lc-verdict" title="${esc(c.status)}">${esc(GROUP_LABEL[group])}</span>
          </span>
          <span class="lc-comment-where">${c.clause_no ? `<em>§${esc(c.clause_no)}</em>` : ""}${esc(c.topic || "未注明主题")}</span>
          <span class="lc-comment-text">${esc(c.comment_text)}</span>
        </button>
        ${open ? `
          <div class="lc-comment-more">
            <em>起草组回复</em>
            <p>${dash(c.response)}</p>
            <div class="lc-comment-foot">
              <span>${c.version_name ? `${esc(c.version_name)} v${esc(c.sub_version_no)} · ` : ""}${esc(c.submitted_by)}${c.submission_date ? " · " + esc(c.submission_date) : ""}</span>
              <button type="button" class="lc-link" data-open="comment:${c.id}">详情 →</button>
            </div>
          </div>` : ""}
      </div>`;
  }

  /* ------------------------------------------------------------ 交互 */
  function onClick(ev) {
    const t = ev.target;
    const opener = t.closest("[data-open]");
    if (opener) {
      const [kind, id] = opener.dataset.open.split(":");
      Records.open(kind, Number(id), ctx);
      return;
    }
    const chip = t.closest("[data-group]");
    if (chip) {
      view.group = chip.dataset.group;
      body.querySelectorAll(".lc-groups [data-group]")
        .forEach((b) => b.classList.toggle("active", b === chip));
      refreshComments();
      return;
    }
    const more = t.closest("[data-more], [data-less]");
    if (more) {
      if (more.dataset.more) view.showAll.add(more.dataset.more);
      else view.showAll.delete(more.dataset.less);
      refreshComments();
      return;
    }
    const face = t.closest(".lc-comment-face");
    if (face) {
      const id = Number(face.parentElement.dataset.comment);
      if (view.opened.has(id)) view.opened.delete(id);
      else view.opened.add(id);
      refreshComments();
      return;
    }
    // 点节点：把该列滚到看板可视区域内（列多时横向定位）。
    const nodeEl = t.closest(".lc-node");
    if (nodeEl) {
      nodeEl.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
  }

  window.Lifecycle = { init, COMMENT_GROUPS };
})();
