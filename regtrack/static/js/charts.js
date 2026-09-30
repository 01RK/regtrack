/* 总览图表：横向细柱状图与环形图。
   项目只有 Bootstrap 与 Tom Select 两个离线依赖，没有现成的图表库，因此自己画：
   柱图用 HTML + CSS（横向细柱不需要 SVG），环形图用 SVG。
   输入统一为 [{ label, value, color, detail? }]。 */
(function () {
  "use strict";

  const { esc } = window.App;

  const total = (items) => items.reduce((sum, it) => sum + it.value, 0);
  const pct = (v, sum) => (sum ? Math.round((v / sum) * 1000) / 10 : 0);
  const fmt = (n) => Number(n.toFixed(2));

  function frame(host, svg, items, note) {
    const sum = total(items);
    if (!sum) {
      host.innerHTML = '<div class="empty">暂无数据</div>';
      return null;
    }
    host.innerHTML = `
      <div class="chart">
        <div class="chart-canvas">${svg}</div>
        <ul class="chart-legend">
          ${items.map((it, i) => `
            <li data-i="${i}" title="${esc(it.detail || it.label)}">
              <i style="background:${it.color}"></i>
              <span class="lbl">${esc(it.label)}</span>
              <span class="val">${it.value}</span>
              <span class="pct">${pct(it.value, sum)}%</span>
            </li>`).join("")}
        </ul>
        ${note ? `<div class="chart-note">${note}</div>` : ""}
      </div>`;
    const root = host.querySelector(".chart");
    // 图形与图例共用 data-i，悬停任意一侧时同步高亮。
    root.querySelectorAll("[data-i]").forEach((el) => {
      el.addEventListener("mouseenter", () => {
        root.classList.add("is-hovering");
        root.querySelectorAll(`[data-i="${el.dataset.i}"]`).forEach((x) => x.classList.add("on"));
      });
      el.addEventListener("mouseleave", () => {
        root.classList.remove("is-hovering");
        root.querySelectorAll(".on").forEach((x) => x.classList.remove("on"));
      });
    });
    return root;
  }

  const tip = (it, sum) => `<title>${esc(it.label)}：${it.value}（${pct(it.value, sum)}%）</title>`;

  /* ---------------------------------------------------- 横向细柱状图 */

  /** 一行一项：左侧名称、中间柱体、右侧数量与占比。
      阶段分布这类「名称长、条目多」的数据，横过来比饼图好认得多。

      数量贴着柱子末端走：柱子够长就压在柱体里（白字），太短就落在柱子右边，
      视线沿着柱尾一路扫下来，不必在图和右边的数字列之间来回找。 */
  function bars(host, items, { note } = {}) {
    const sum = total(items);
    if (!sum) {
      host.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    // 柱长按最大值归一，最长的那根占满轨道，彼此之间的差别才看得出来
    const max = Math.max(...items.map((it) => it.value));
    host.innerHTML = `
      <div class="bars" style="--bars-n:${items.length}">
        ${items.map((it, i) => {
          const share = it.value / max;
          // 柱内至少要放得下两位数字，放不下就把数字挪到柱子外面
          const inside = it.value > 0 && share >= 0.18;
          return `
          <div class="bar-row${it.value ? "" : " is-zero"}" style="--i:${i}"
               title="${esc(it.label)}：${it.value}（${pct(it.value, sum)}%）">
            <span class="bar-label">${esc(it.label)}</span>
            <span class="bar-track">
              <i style="width:${fmt(share * 100)}%;--bar-color:${it.color}">
                ${inside ? `<b class="bar-val in">${it.value}</b>` : ""}
              </i>
              ${inside ? "" : `<b class="bar-val out">${it.value}</b>`}
            </span>
            <span class="bar-pct">${pct(it.value, sum)}%</span>
          </div>`;
        }).join("")}
      </div>
      ${note ? `<div class="chart-note">${note}</div>` : ""}`;
  }

  /* -------------------------------------------------------- 环形图 */
  function donut(host, items, { centerLabel, note } = {}) {
    const S = 220, c = S / 2, r = 78, width = 26;
    const sum = total(items);
    const shown = items.filter((it) => it.value > 0).length;
    const gap = shown > 1 ? 0.6 : 0;   // 扇区之间留出细缝（单位：周长百分比）
    let offset = 0;
    const arcs = items.map((it, i) => {
      const len = (it.value / sum) * 100;
      const arc = it.value ? `
        <circle data-i="${i}" class="donut-arc" cx="${c}" cy="${c}" r="${r}" pathLength="100"
          stroke="${it.color}" stroke-width="${width}"
          stroke-dasharray="${fmt(Math.max(len - gap, 0.01))} ${fmt(100 - len + gap)}"
          stroke-dashoffset="${fmt(-offset)}">${tip(it, sum)}</circle>` : "";
      offset += len;
      return arc;
    }).join("");
    const svg = `
      <svg class="donut" viewBox="0 0 ${S} ${S}" role="img" aria-label="意见采纳情况">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${width}"/>
        <g transform="rotate(-90 ${c} ${c})">${arcs}</g>
        <text class="donut-total" x="${c}" y="${c + 4}">${sum}</text>
        <text class="donut-caption" x="${c}" y="${c + 24}">${esc(centerLabel || "")}</text>
      </svg>`;
    frame(host, svg, items, note);
  }

  window.Charts = { bars, donut };
})();
