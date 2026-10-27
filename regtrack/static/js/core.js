/* 基础层：请求、提示、格式化、缓存、模态外壳。 */
(function () {
  "use strict";

  const USER_KEY = "regtrack.user";

  /* ------------------------------------------------------------ 语言
     中文界面：字段以英文为主、中文小字；按钮与说明文字用中文。
     英文界面：全部界面文字用英文。业务数据保持原文。 */
  const LANG = document.documentElement.lang === "en" ? "en" : "zh";
  const t = (zh, en) => (LANG === "en" ? en : zh);

  const App = {
    version: document.documentElement.dataset.version || "",
    meta: null,
    lookups: null,
    user: localStorage.getItem(USER_KEY) || "",
  };

  /* ------------------------------------------------------------ 加载状态
     数据库在共享盘上，个别请求可能要等一两秒。任何请求进行中都在顶部显示细进度条；
     超过 0.9 秒再显示“正在读取 / 正在保存”提示，让人知道系统在处理，不必反复点击。 */
  const Activity = (() => {
    let reads = 0;
    let writes = 0;
    let showTimer = 0;
    let slowTimer = 0;
    function render() {
      const el = document.getElementById("app-activity");
      if (!el) return;
      clearTimeout(showTimer);
      clearTimeout(slowTimer);
      document.body.classList.toggle("app-saving", writes > 0);
      if (reads + writes === 0) {
        el.classList.remove("show", "slow");
        return;
      }
      el.querySelector(".app-activity-text").textContent =
        writes ? t("正在保存，请稍候…", "Saving, please wait…") : t("正在读取数据…", "Loading data…");
      if (!el.classList.contains("show")) showTimer = setTimeout(() => el.classList.add("show"), 150);
      if (!el.classList.contains("slow")) slowTimer = setTimeout(() => el.classList.add("slow"), 900);
    }
    return {
      start(write) { if (write) writes += 1; else reads += 1; render(); },
      end(write) { if (write) writes -= 1; else reads -= 1; render(); },
    };
  })();

  /** 写入期间把触发它的按钮置为忙碌：禁用并显示转圈，防止重复提交。返回恢复函数。 */
  function busyTrigger() {
    const el = document.activeElement;
    if (!el || !el.matches || !el.matches("button, .btn") || el.disabled) return () => {};
    el.disabled = true;
    el.classList.add("is-busy");
    el.setAttribute("aria-busy", "true");
    return () => {
      el.disabled = false;
      el.classList.remove("is-busy");
      el.removeAttribute("aria-busy");
    };
  }

  /* ------------------------------------------------------- 语言切换快照
     界面语言由服务端渲染，切换语言需要重新载入页面；业务数据与语言无关。
     切换前把本页已读取的数据暂存到 sessionStorage，重新载入后同一请求直接取用一次，
     不必再到共享数据库读一遍。快照只在 1 分钟内、同一页面、同一操作人时有效。 */
  const SNAPSHOT_KEY = "regtrack.lang-snapshot";
  const pageReads = new Map();
  const snapshot = (() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || "null");
      sessionStorage.removeItem(SNAPSHOT_KEY);
      if (saved && saved.page === location.pathname + location.search && saved.user === App.user
          && Date.now() - saved.at < 60000) return new Map(saved.reads);
    } catch (e) { /* 存储不可用或内容损坏：照常读取 */ }
    return new Map();
  })();

  function saveLanguageSnapshot() {
    try {
      sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        page: location.pathname + location.search, user: App.user, at: Date.now(), reads: [...pageReads],
      }));
    } catch (e) { /* 超出浏览器存储上限时放弃快照，切换后重新读取 */ }
  }

  /* ------------------------------------------------------------ 请求 */
  const pending = new Map();
  const clone = (data) => (data === null || data === undefined ? data : structuredClone(data));

  /** 同一请求（方法、地址与内容都相同）尚未返回时不再重复发出，共用同一结果。 */
  function api(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const key = options.body instanceof FormData ? null
      : `${method} ${path} ${typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? null)}`;
    if (key && pending.has(key)) return pending.get(key).then(clone);
    const request = send(path, options, method);
    if (!key) return request;
    pending.set(key, request);
    return request.finally(() => pending.delete(key));
  }

  async function send(path, options, method) {
    const write = method !== "GET";
    if (!write && snapshot.has(path)) {
      const text = snapshot.get(path);
      snapshot.delete(path);
      pageReads.set(path, text);
      return JSON.parse(text);
    }
    const opt = Object.assign({ headers: {} }, options);
    // HTTP 头只允许 ISO-8859-1，中文姓名必须先 URL 编码，由后端解码。
    opt.headers["X-User"] = encodeURIComponent(App.user || "未署名");
    if (opt.body !== undefined && typeof opt.body !== "string" && !(opt.body instanceof FormData)) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(opt.body);
    }

    const restore = write ? busyTrigger() : () => {};
    Activity.start(write);
    let res;
    let text;
    try {
      res = await fetch(path, opt);
      text = await res.text();
    } catch (e) {
      // 浏览器只会给出 "Failed to fetch"，这里换成用户能据以行动的说明。
      const err = new Error(t(`无法连接到本地服务（${path}），请确认 RegTrack 窗口仍在运行后重试`,
        `Cannot reach the local service (${path}). Make sure the RegTrack window is still running and try again.`));
      err.cause = e;
      throw err;
    } finally {
      Activity.end(write);
      restore();
    }

    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      // 后端所有失败都回 JSON；万一拿到的是 HTML，就把原文片段带出来定位。
      const reason = (data && data.error)
        || (text ? t(`服务端返回了非预期内容：${text.slice(0, 160)}`, `Unexpected server response: ${text.slice(0, 160)}`)
                 : t(`请求失败（${res.status}）`, `Request failed (${res.status})`));
      const detail = data && data.detail ? `（${data.detail}）` : "";
      const err = new Error(reason + detail);
      err.reason = reason;
      err.field = data && data.field;
      err.detail = data && data.detail;
      err.status = res.status;
      throw err;
    }
    if (!write && path.startsWith("/api/")) pageReads.set(path, text);
    if (write) forgetLookups();
    return data;
  }

  const get = (p, params) => api(p + qs(params));
  const post = (p, body) => api(p, { method: "POST", body });
  const put = (p, body) => api(p, { method: "PUT", body });
  const del = (p) => api(p, { method: "DELETE" });

  function qs(params) {
    if (!params) return "";
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") u.append(k, v);
    });
    const s = u.toString();
    return s ? "?" + s : "";
  }

  /* ------------------------------------------------------------ 提示 */
  function toast(message, kind = "") {
    const stack = document.getElementById("toast-stack");
    const el = document.createElement("div");
    el.className = "toast-item " + kind;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), kind === "err" ? 6000 : 3200);
  }

  const ok = (m) => toast(m, "ok");
  const fail = (m) => toast(m, "err");

  /* -------------------------------------------------------- 格式化 */
  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /** 字段名：英文为主；中文界面在其后附中文小字，英文界面只显示英文。 */
  function label(en, zh) {
    return esc(en) + (zh && LANG !== "en" ? `<small class="cn-sub">${esc(zh)}</small>` : "");
  }

  function uiText(zh, en) {
    return `<span class="ui-text"><span${LANG === "en" ? ' aria-hidden="true"' : ""}>${esc(zh)}</span><span${LANG === "zh" ? ' aria-hidden="true"' : ""}>${esc(en)}</span></span>`;
  }

  /** Light grey (i) with a hover / focus tooltip. Same markup as i18n.info_tip on the server. */
  const infoTip = (text) =>
    `<span class="info-tip" tabindex="0" role="img" data-bs-toggle="tooltip" data-bs-title="${esc(text)}" aria-label="${esc(text)}">i</span>`;
  /** Note shown after every "Follow-up required" checkbox. */
  const followUpInfo = () => infoTip(App.meta.follow_up_hint[LANG]);
  // One delegated instance serves every tooltip, including those rendered later in modals and lists.
  new bootstrap.Tooltip(document.body, { selector: '[data-bs-toggle="tooltip"]' });

  const dash = (v) => (v === null || v === undefined || v === "" ? "—" : esc(v));

  function clip(v, n = 90) {
    if (!v) return "—";
    const s = String(v);
    return esc(s.length > n ? s.slice(0, n) + "…" : s);
  }

  const RANK = { High: "high", Medium: "medium", Low: "low", TBD: "muted" };

  function tag(value, cls) {
    if (!value) return '<span class="tag muted">—</span>';
    const k = cls !== undefined ? cls : (RANK[value] || "");
    return `<span class="tag ${k}">${esc(value)}</span>`;
  }

  const STATUS_CLASS = {
    Open: "", "In Progress": "info", "Waiting for Response": "medium",
    "Ready for Review": "info", Completed: "ok", Closed: "ok",
    "On Hold": "medium", Cancelled: "muted",
    Draft: "", Submitted: "info", Accepted: "ok", "Partially Accepted": "medium",
    Rejected: "high", Pending: "medium", Withdrawn: "muted",
    Responded: "ok", "No Comment": "muted", "N-A": "muted",
    Compliant: "ok", "Non-compliant": "high", Partial: "medium",
    Yes: "medium", No: "ok",
  };

  const statusTag = (v) => tag(v, STATUS_CLASS[v] !== undefined ? STATUS_CLASS[v] : "");

  /** 系统当天，YYYY-MM-DD。日期筛选、默认值等处统一用它，避免各处自己拼。 */
  const today = () => new Date().toISOString().slice(0, 10);

  function overdue(dateStr) {
    if (!dateStr) return false;
    return dateStr < today();
  }

  const stageList = () => (App.meta ? App.meta.stages : []);
  const stageLabel = (code) => {
    const hit = stageList().find((s) => s.code === code);
    return hit ? t(hit.label, hit.en) : (code || "");
  };
  const stageIndex = (code) => stageList().findIndex((s) => s.code === code);
  const isTerminalStage = (code) => !!App.meta && code === App.meta.terminal_stage;

  function stageMini(code) {
    const stages = stageList();
    const i = stageIndex(code);
    return '<span class="stage-mini" title="' + esc(stageLabel(code)) + '">' +
      stages.map((s, n) => {
        let c = "";
        if (isTerminalStage(code) && n === stages.length - 1) c = "dead";
        else if (n < i) c = "done";
        else if (n === i) c = "current";
        return `<i class="${c}"></i>`;
      }).join("") + "</span>";
  }

  function stageRail(code) {
    const i = stageIndex(code);
    return '<div class="stage-rail">' + stageList().map((s, n) => {
      let c = "";
      if (isTerminalStage(s.code)) c = isTerminalStage(code) ? "dead" : "";
      else if (n < i) c = "done";
      else if (n === i) c = "current";
      return `<div class="step ${c}"><span class="idx">${String(n + 1).padStart(2, "0")}</span>${esc(stageLabel(s.code))}</div>`;
    }).join("") + "</div>";
  }

  function emptyRow(cols, title, hint = ["", ""]) {
    return `<tr><td colspan="${cols}"><div class="empty"><b>${uiText(...title)}</b>${uiText(...hint)}</div></td></tr>`;
  }

  /* ------------------------------------------------------- 文字选择
     1. 拖动选中文字后松开鼠标，浏览器会在共同的父元素上补发一次 click。整行可点的列表、
        目录、分组标题会因此打开详情或切换内容，选中的文字随之被重绘掉。选区非空时，
        这次 click 不再交给页面处理；按钮、链接和表单控件不受影响。
     2. 在已选中的文字上按下鼠标并移动，浏览器会开始“拖放文字”。拖放期间页面不响应
        点击和滚动；若拖动的文字在拖放途中被重绘移除，Windows 上的浏览器可能停在拖放
        状态，表现为整页卡死、只能刷新。系统没有拖放文字的功能，只放行明确声明可拖动
        的元素（如字典排序的拖动手柄），其余拖放一律取消。 */
  const INTERACTIVE = "a, button, input, select, textarea, label, summary, [contenteditable], [role='button'], .ts-control, .ts-dropdown";
  function selectedText() {
    const selection = window.getSelection ? window.getSelection() : null;
    return selection && !selection.isCollapsed && selection.toString().trim() ? selection : null;
  }
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(INTERACTIVE) || event.detail === 0) return;
    const selection = selectedText();
    if (!selection) return;
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer) && !range.intersectsNode(target)) return;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  document.addEventListener("dragstart", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('[draggable="true"]')) return;
    event.preventDefault();
  }, true);

  /* ------------------------------------------------------- 工作区高度
     草案阅读与比对结果的工作区内部各自滚动，高度应正好到窗口底部。上方的标题、
     说明与页签高度随内容和语言变化，这里量出工作区顶部位置写入 --fill-top，
     由 CSS 计算高度；上方内容或窗口尺寸变化时重新测量。 */
  function fitWorkspaces() {
    document.querySelectorAll(".cmp-workspace, .draft-workspace").forEach((workspace) => {
      if (!workspace.getClientRects().length) return;  // 所在页签未显示，显示后再量
      const top = Math.round(workspace.getBoundingClientRect().top + window.scrollY);
      if (workspace.style.getPropertyValue("--fill-top") !== `${top}px`) workspace.style.setProperty("--fill-top", `${top}px`);
    });
  }
  function watchWorkspaces() {
    const workspaces = document.querySelectorAll(".cmp-workspace, .draft-workspace");
    if (!workspaces.length) return;
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fitWorkspaces(); });
    };
    // 只观察工作区上方的元素与父容器：工作区自身的高度由这里决定，观察它会形成循环。
    const observer = new ResizeObserver(schedule);
    const topbar = document.querySelector(".topbar");
    if (topbar) observer.observe(topbar);
    workspaces.forEach((workspace) => {
      observer.observe(workspace.parentElement);
      for (let node = workspace.previousElementSibling; node; node = node.previousElementSibling) observer.observe(node);
    });
    window.addEventListener("resize", schedule);
    fitWorkspaces();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchWorkspaces);
  else watchWorkspaces();

  /* ------------------------------------------------------- 返回上一页
     草案详情、比对结果、导入页等整页视图常从某个弹窗进入（如标准主档 › 草案）。
     弹窗层级记录在来源页地址的 records 参数里（records.js），返回时退回浏览器历史即可回到
     原页面并重新打开原来的弹窗；直接打开的页面没有来源，才使用链接上写的默认页。 */
  function cameFromApp() {
    if (window.history.length < 2 || !document.referrer) return false;
    try { return new URL(document.referrer).origin === location.origin; } catch (e) { return false; }
  }
  function goBack(fallback) {
    if (cameFromApp()) window.history.back();
    else location.href = fallback;
  }
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a.draft-back") : null;
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    goBack(link.getAttribute("href"));
  });
  // 从浏览器缓存恢复的页面可能是旧数据（例如刚在草案页改过、删过）：重新载入，弹窗层级由地址恢复。
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });

  /* ------------------------------------------------------- 未保存提示
     返回 "save" | "discard" | "stay"。 */
  function unsavedPrompt(message) {
    return new Promise((resolve) => {
      let chosen = "stay";
      const m = openModal({
        title: t("有未保存的修改", "Unsaved changes"),
        size: "sm",
        body: `<div style="font-size:13.5px">${esc(message)}</div>`,
        footer: `<button class="btn btn-outline-secondary btn-sm" data-choice="stay">${uiText("继续编辑", "Keep editing")}</button>
                 <button class="btn btn-outline-danger btn-sm" data-choice="discard">${uiText("放弃修改", "Discard")}</button>
                 <button class="btn btn-primary btn-sm" data-choice="save">${uiText("保存", "Save")}</button>`,
        onHidden: () => resolve(chosen),
      });
      m.footer.querySelectorAll("[data-choice]").forEach((button) => {
        button.onclick = () => { chosen = button.dataset.choice; m.close(); };
      });
    });
  }

  /* ------------------------------------------------------------ 模态 */
  let seq = 0;

  // 弹窗期间只保留一个同页历史保护项。浏览器「后退」不会参与弹窗层级，
  // 也不会把用户带离系统；返回、取消和点击背景是弹窗唯一的退出方式。
  const modalLayers = [];
  const MODAL_GUARD = "regtrackModalGuard";
  let guardSync = null;
  let lastBackHint = 0;
  const canUseHistory = () => !!(window.history && window.history.pushState && window.addEventListener);

  /* 背景滚动锁。
     Bootstrap 自己那套锁会改 body 的 overflow 与 padding-right，导致内容区
     宽度跳一下（详见 app.css 里 body.modal-open 的说明），CSS 已经把它还原。
     这里改成给 html 挂一个类：滚动条槽位由 scrollbar-gutter 保留，页面宽度
     不变，左侧导航是 fixed 的也不会受影响。关掉上层弹窗时 Bootstrap 会顺手
     解锁，所以每次开合都按当前层数重算一遍。 */
  function lockBackgroundScroll() {
    document.documentElement.classList.toggle("modal-lock", modalLayers.length > 0);
  }

  function ensureModalGuard() {
    if (!canUseHistory() || (window.history.state && window.history.state[MODAL_GUARD])) return;
    const state = Object.assign({}, window.history.state || {}, { [MODAL_GUARD]: true });
    window.history.pushState(state, "", window.location.href);
  }

  /** 全部弹窗关闭后，去掉地址里记录弹窗层级的 records 参数（由 records.js 维护）。 */
  function clearDeepIdWhenIdle() {
    if (modalLayers.length || !canUseHistory() || !window.location) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("records")) return;
    url.searchParams.delete("records");
    window.history.replaceState(window.history.state, "", url);
  }

  if (canUseHistory()) {
    window.addEventListener("popstate", () => {
      // 最后一层由界面关闭后，退掉唯一的保护项并放行等待者。
      if (guardSync) {
        const done = guardSync;
        guardSync = null;
        clearDeepIdWhenIdle();
        done();
        return;
      }

      // 弹窗打开期间拦住浏览器后退并恢复保护项，弹窗和层级保持不变。
      if (modalLayers.length) {
        ensureModalGuard();
        const now = Date.now();
        if (now - lastBackHint > 1800) {
          toast(t("请使用弹窗内的返回、取消或点击背景关闭", "Use Back, Cancel or click outside the dialog to close it"));
          lastBackHint = now;
        }
        return;
      }
      clearDeepIdWhenIdle();
    });
  }

  // 弹窗位置变化时广播，浮动下拉面板据此跟随（见 fields.js）。
  const REPOSITION = "regtrack:reposition";
  const announceMove = () => window.dispatchEvent(new Event(REPOSITION));

  /**
   * 标题栏拖动。用 transform 平移整个对话框，而不是改成 position:fixed —
   * 后者会让对话框失去 Bootstrap 的宽度约束、退化成内容自适应，
   * 于是拖动过程和下拉展开时窗口都会忽大忽小。平移只改位置不改布局，
   * 尺寸、滚动行为、内部定位全部保持不变。
   */
  function makeDraggable(dialog, handle, depth = 0) {
    const content = dialog.querySelector(".modal-content");
    const KEEP = 120;             // 拖到边缘时横向至少留在视口内的宽度
    const STEP = 18;              // 每叠一层错开的距离
    let dx = depth * STEP, dy = depth * STEP, drag = null;

    const apply = () => {
      dialog.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
      announceMove();
    };

    // 以标题栏为准约束：整窗可在视口范围内自由移动，但标题栏始终可见可抓。
    function clamp(nx, ny) {
      const box = content.getBoundingClientRect();
      const left = box.left - dx;
      const top = box.top - dy;
      const head = handle.offsetHeight || 44;
      return [
        Math.min(window.innerWidth - KEEP - left, Math.max(KEEP - box.width - left, nx)),
        Math.min(window.innerHeight - head - top, Math.max(-top, ny)),
      ];
    }

    if (depth) dialog.style.transform = `translate(${dx}px, ${dy}px)`;

    handle.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button, input, select, textarea, a")) return;
      drag = { x: ev.clientX, y: ev.clientY, dx, dy };
      dialog.classList.add("is-dragging");
      handle.setPointerCapture(ev.pointerId);
    });
    handle.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      [dx, dy] = clamp(drag.dx + ev.clientX - drag.x, drag.dy + ev.clientY - drag.y);
      apply();
    });
    const stop = (ev) => {
      if (!drag) return;
      drag = null;
      dialog.classList.remove("is-dragging");
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("dblclick", () => { dx = depth * STEP; dy = depth * STEP; apply(); });

    // 窗口尺寸变化后把弹窗拉回可见区域。
    const onResize = () => { [dx, dy] = clamp(dx, dy); apply(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }

  function openModal({ title, subtitle, body, footer, size = "lg", back, onShown, onHidden }) {
    const id = "m" + ++seq;
    const host = document.getElementById("modal-host");
    // 叠了几层就错开几格，让下面那层露出边缘，一眼看得出还有上一级。
    const stack = document.querySelectorAll(".modal.show");
    const depth = stack.length;
    // 没指定返回落点时，就用下面那层的标题：任何叠上来的弹窗都能原路退回。
    // 确认框（sm）本身就只有两个按钮，不需要再多一个返回。
    if (back === undefined && depth && size !== "sm") {
      const under = stack[stack.length - 1].querySelector(".modal-title");
      back = under ? under.lastChild.textContent.trim().slice(0, 28) : null;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal fade" id="${id}" tabindex="-1">
        <div class="modal-dialog modal-${size} modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header modal-drag-handle" title="${t("按住此处拖动窗口", "Drag here to move the window")}">
              ${back ? `<button type="button" class="modal-back" data-back
                          title="${t("返回", "Back to")} ${esc(back)}">${window.App.uiText("返回", "Back")}</button>` : ""}
              <div class="modal-title">
                ${subtitle ? `<span class="sub">${esc(subtitle)}</span>` : ""}${esc(title)}
              </div>
            </div>
            <div class="modal-body"></div>
            <div class="modal-footer"></div>
          </div>
        </div>
      </div>`;
    const el = wrap.firstElementChild;
    host.appendChild(el);
    const bodyEl = el.querySelector(".modal-body");
    const footEl = el.querySelector(".modal-footer");
    if (typeof body === "string") bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    if (typeof footer === "string") footEl.innerHTML = footer;
    else if (footer) footEl.appendChild(footer);
    else footEl.remove();

    // Esc 不承担返回职责；返回、取消和点击背景都只关闭当前层。
    const modal = new bootstrap.Modal(el, { keyboard: false, backdrop: true });
    let resolveClosed;
    const closed = new Promise((resolve) => { resolveClosed = resolve; });
    const entry = { modal, el, resolveClosed };
    modalLayers.push(entry);
    lockBackgroundScroll();
    if (modalLayers.length === 1) ensureModalGuard();
    const releaseDrag = makeDraggable(el.querySelector(".modal-dialog"),
                                     el.querySelector(".modal-drag-handle"), depth);
    const backBtn = el.querySelector("[data-back]");
    if (backBtn) backBtn.onclick = () => modal.hide();
    el.addEventListener("shown.bs.modal", () => onShown && onShown(el));
    el.addEventListener("hidden.bs.modal", () => {
      releaseDrag();
      // 下拉面板挂在弹窗上，随弹窗一起销毁，顺带解掉它注册的文档级监听。
      if (window.Fields) window.Fields.destroyIn(el);
      if (onHidden) onHidden();
      el.remove();
      const index = modalLayers.indexOf(entry);
      if (index >= 0) modalLayers.splice(index, 1);
      lockBackgroundScroll();
      const previous = modalLayers[modalLayers.length - 1];
      if (previous) {
        previous.modal._focustrap.activate();
      }

      if (!canUseHistory() || modalLayers.length
          || !window.history.state || !window.history.state[MODAL_GUARD]) {
        resolveClosed();
        clearDeepIdWhenIdle();
      } else {
        // 最后一层关闭时退掉唯一保护项。close() 等同步完成，避免随后开详情产生竞态。
        guardSync = () => resolveClosed();
        window.history.back();
      }
    });
    // Bootstrap 默认只支持单层弹窗。新层动画开始前暂停下层焦点捕获，
    // 避免它把焦点抢到第一个可搜索下拉框；新层沿用库自身的焦点管理。
    const previous = modalLayers[modalLayers.length - 2];
    if (previous) previous.modal._focustrap.deactivate();
    modal.show();
    return { el, modal, body: bodyEl, footer: footEl,
             close: () => { modal.hide(); return closed; }, closed };
  }

  /** 确认框的 Promise 版：取消返回 false，确认返回 true。
      需要「先问一句、再决定要不要继续提交」的地方用它（如会议取消挂载
      带批注的标准），回调版的 confirmDialog 在取消时不会有任何回音。 */
  function confirmAsync(message) {
    return new Promise((resolve) => {
      let decided = false;
      const m = openModal({
        title: t("确认操作", "Confirm"),
        size: "sm",
        body: `<div style="font-size:13.5px">${esc(message)}</div>`,
        footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">${window.App.uiText("取消", "Cancel")}</button>
                 <button class="btn btn-danger btn-sm" data-yes>${window.App.uiText("确认", "Confirm")}</button>`,
        onHidden: () => { if (!decided) resolve(false); },
      });
      m.footer.querySelector("[data-yes]").onclick = async () => {
        decided = true;
        await m.close();
        resolve(true);
      };
    });
  }

  function confirmDialog(message, onYes) {
    confirmAsync(message).then(async (yes) => {
      if (yes) await onYes();
    });
  }

  /* ------------------------------------------------------- 启动装配 */
  /** 固定取值只随程序版本变化，按版本缓存在本机，换页时不再重复请求。 */
  async function loadMeta() {
    const key = `regtrack.meta:${App.version}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) return JSON.parse(cached);
    } catch (e) { /* 存储不可用时直接读取 */ }
    const meta = await get("/api/meta");
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("regtrack.meta:")).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(key, JSON.stringify(meta));
    } catch (e) { /* 存储不可用时下次再读 */ }
    return meta;
  }

  /* 字典（人员、团队、机构等下拉选项）每次换页都要用。读取后在本标签页缓存 1 分钟，
     换页不必每次访问共享盘；本机任何保存操作都会清掉缓存（保存可能顺带新增字典值）。 */
  const LOOKUPS_KEY = "regtrack.lookups";
  const LOOKUPS_TTL = 60000;
  function forgetLookups() {
    try { sessionStorage.removeItem(LOOKUPS_KEY); } catch (e) { /* 存储不可用 */ }
  }
  async function loadLookups() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(LOOKUPS_KEY) || "null");
      if (cached && cached.version === App.version && Date.now() - cached.at < LOOKUPS_TTL) return cached.data;
    } catch (e) { /* 存储不可用或内容损坏：直接读取 */ }
    const data = await get("/api/lookups");
    try { sessionStorage.setItem(LOOKUPS_KEY, JSON.stringify({ version: App.version, at: Date.now(), data })); } catch (e) { /* 存储不可用 */ }
    return data;
  }

  async function boot() {
    const [meta, lookups] = await Promise.all([loadMeta(), loadLookups()]);
    App.meta = meta;
    App.lookups = lookups;

    const sel = document.getElementById("current-user");
    const people = (lookups.person || []).map((p) => p.value);
    if (App.user && !people.includes(App.user)) people.unshift(App.user);
    if (!App.user && people.length) {
      App.user = people[0];
      localStorage.setItem(USER_KEY, App.user);
    }
    if (sel) sel.textContent = App.user || t("未署名", "Unsigned");
  }

  async function refreshLookups() {
    forgetLookups();
    App.lookups = await loadLookups();
    return App.lookups;
  }

  let bootPromise;
  function ready(fn) {
    if (!bootPromise) bootPromise = boot();
    bootPromise
      .then(fn)
      .catch((e) => fail(t("初始化失败：", "Initialization failed: ") + e.message));
  }

  window.App = Object.assign(App, {
    lang: LANG, t, label,
    REPOSITION,
    api, get, post, put, del, qs,
    toast, ok, fail, esc, dash, clip, tag, statusTag, overdue, today, uiText, infoTip, followUpInfo,
    stageMini, stageRail, stageLabel, stageIndex, stageList, isTerminalStage,
    refreshLookups, emptyRow, openModal, confirmDialog, confirmAsync, ready, saveLanguageSnapshot,
    goBack, unsavedPrompt,
  });
})();
