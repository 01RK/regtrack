/* 基础层：请求、提示、格式化、缓存、模态外壳。 */
(function () {
  "use strict";

  const USER_KEY = "regtrack.user";

  const App = {
    meta: null,
    lookups: null,
    user: localStorage.getItem(USER_KEY) || "",
  };

  /* ------------------------------------------------------------ 请求 */
  async function api(path, options = {}) {
    const opt = Object.assign({ headers: {} }, options);
    // HTTP 头只允许 ISO-8859-1，中文姓名必须先 URL 编码，由后端解码。
    opt.headers["X-User"] = encodeURIComponent(App.user || "未署名");
    if (opt.body !== undefined && typeof opt.body !== "string" && !(opt.body instanceof FormData)) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(opt.body);
    }

    let res;
    try {
      res = await fetch(path, opt);
    } catch (e) {
      // 浏览器只会给出 "Failed to fetch"，这里换成用户能据以行动的说明。
      const err = new Error(`无法连接到本地服务（${path}），请确认 RegTrack 仍在运行后重试`);
      err.cause = e;
      throw err;
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      // 后端所有失败都回 JSON；万一拿到的是 HTML，就把原文片段带出来定位。
      const reason = (data && data.error)
        || (text ? `服务端返回了非预期内容：${text.slice(0, 160)}` : `请求失败（${res.status}）`);
      const detail = data && data.detail ? `（${data.detail}）` : "";
      const err = new Error(reason + detail);
      err.field = data && data.field;
      err.detail = data && data.detail;
      err.status = res.status;
      throw err;
    }
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
    return hit ? hit.label : (code || "");
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
      return `<div class="step ${c}"><span class="idx">${String(n + 1).padStart(2, "0")}</span>${esc(s.label)}</div>`;
    }).join("") + "</div>";
  }

  function emptyRow(cols, title, hint) {
    return `<tr><td colspan="${cols}"><div class="empty"><b>${esc(title)}</b>${esc(hint || "")}</div></td></tr>`;
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

  function clearDeepIdWhenIdle() {
    if (modalLayers.length || !canUseHistory() || !window.location) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("id")) return;
    url.searchParams.delete("id");
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
          toast("请使用弹窗内的返回、取消或点击背景关闭");
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
            <div class="modal-header modal-drag-handle" title="按住此处拖动窗口">
              ${back ? `<button type="button" class="modal-back" data-back
                          title="返回 ${esc(back)}">返回</button>` : ""}
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
        title: "确认操作",
        size: "sm",
        body: `<div style="font-size:13.5px">${esc(message)}</div>`,
        footer: `<button class="btn btn-outline-secondary btn-sm" data-bs-dismiss="modal">取消</button>
                 <button class="btn btn-danger btn-sm" data-yes>确认</button>`,
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
  async function boot() {
    const [meta, lookups] = await Promise.all([get("/api/meta"), get("/api/lookups")]);
    App.meta = meta;
    App.lookups = lookups;

    const sel = document.getElementById("current-user");
    const people = (lookups.person || []).map((p) => p.value);
    if (App.user && !people.includes(App.user)) people.unshift(App.user);
    if (!App.user && people.length) {
      App.user = people[0];
      localStorage.setItem(USER_KEY, App.user);
    }
    if (sel) sel.textContent = App.user || "未署名";
  }

  async function refreshLookups() {
    App.lookups = await get("/api/lookups");
    return App.lookups;
  }

  function ready(fn) {
    boot()
      .then(fn)
      .catch((e) => fail("初始化失败：" + e.message));
  }

  window.App = Object.assign(App, {
    REPOSITION,
    api, get, post, put, del, qs,
    toast, ok, fail, esc, dash, clip, tag, statusTag, overdue, today,
    stageMini, stageRail, stageLabel, stageIndex, stageList, isTerminalStage,
    refreshLookups, emptyRow, openModal, confirmDialog, confirmAsync, ready,
  });
})();
