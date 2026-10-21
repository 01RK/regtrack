App.ready(async () => {
  const { esc, dash, get, emptyRow, t } = App;
  const M = App.meta;
  const state = { page: 1, size: 10 };
  const expansionKey = `regtrack.meetings-expanded:${location.pathname}`;
  const expanded = new Set(JSON.parse(sessionStorage.getItem(expansionKey) || "[]").map(Number));

  function saveExpansion() {
    sessionStorage.setItem(expansionKey, JSON.stringify([...expanded]));
  }


  const typeSel = document.getElementById("f-type");
  typeSel.innerHTML = `<option value="">${t("全部类型", "All types")}</option>` +
    M.meeting_types.map((v) => `<option>${esc(v)}</option>`).join("");
  typeSel.onchange = () => { state.page = 1; load(); };

  let timer;
  document.getElementById("f-q").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.page = 1; load(); }, 260);
  };
  document.getElementById("f-reset").onclick = () => {
    document.getElementById("f-q").value = "";
    typeSel.value = "";
    state.page = 1;
    load();
  };

  /* ----------------------------------------------------------- 列表 */
  async function load() {
    const data = await get("/api/meetings", {
      q: document.getElementById("f-q").value,
      type: typeSel.value,
      page: state.page, page_size: state.size,
    });
    const host = document.getElementById("list");
    host.innerHTML = data.items.length
      ? data.items.map(meetingRow).join("")
      : emptyRow(5, ["没有匹配的会议", "No matching meetings"], ["点右上角「登记会议」记下开过的会", "Use Register Meeting to record a meeting"]);

    function toggle(id, open) {
      if (open) expanded.add(id);
      else expanded.delete(id);
      saveExpansion();
      const button = host.querySelector(`[data-toggle="${id}"]`);
      button.setAttribute("aria-expanded", String(open));
      button.querySelector(".group-chevron").textContent = open ? "▾" : "▸";
      document.getElementById(`meeting-standards-${id}`).hidden = !open;
    }
    host.querySelectorAll("[data-toggle]").forEach(button => {
      const activate = () => {
        const id = Number(button.dataset.toggle);
        toggle(id, !expanded.has(id));
      };
      button.onclick = activate;
      button.onkeydown = event => {
        if (event.target === button && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          activate();
        }
      };
    });
    document.getElementById("groups-expand").onclick = () => data.items.forEach(m => toggle(m.id, true));
    document.getElementById("groups-collapse").onclick = () => data.items.forEach(m => toggle(m.id, false));

    host.querySelectorAll("[data-open]").forEach((b) => {
      b.onclick = event => { event.stopPropagation(); openDetail(Number(b.dataset.open)); };
    });
    host.querySelectorAll("[data-derive]").forEach((b) => {
      b.onclick = () => Records.derive(JSON.parse(b.dataset.derive), ctx);
    });

    const pages = Math.max(1, Math.ceil(data.total / state.size));
    const pager = document.getElementById("pager");
    pager.innerHTML = `<span>${window.App.uiText(`共 ${data.total} 场 · 第 ${state.page}/${pages} 页`, `${data.total} meetings · Page ${state.page}/${pages}`)}</span>
      <button class="btn btn-outline-secondary btn-sm" ${state.page <= 1 ? "disabled" : ""} data-prev>${window.App.uiText("上一页", "Previous")}</button>
      <button class="btn btn-outline-secondary btn-sm" ${state.page >= pages ? "disabled" : ""} data-next>${window.App.uiText("下一页", "Next")}</button>`;
    const prev = pager.querySelector("[data-prev]");
    const next = pager.querySelector("[data-next]");
    if (prev) prev.onclick = () => { state.page--; load(); };
    if (next) next.onclick = () => { state.page++; load(); };
  }

  function meetingRow(m) {
    const open = expanded.has(m.id);
    return `<tr class="meeting-summary-row" data-toggle="${m.id}" tabindex="0" role="button" aria-expanded="${open}" aria-controls="meeting-standards-${m.id}" aria-label="${esc(t('展开或收起会议标准：', 'Toggle meeting standards: ')+m.title)}">
      <td><div class="meeting-identity"><span class="meeting-toggle group-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
        <div><div class="cell-main">${esc(m.title)}</div><div class="cell-sub num">${esc(m.meeting_no)}</div></div></div></td>
      <td><div class="num">${dash(m.meeting_date)}</div><div class="cell-sub">${dash(m.meeting_type)}</div></td>
      <td>${dash(m.organizer)}</td>
      <td><div class="meeting-counts"><span>${App.uiText(`${m.standard_count} 个标准`, `${m.standard_count} standards`)}</span><span>${App.uiText(`${m.action_count} 个事项`, `${m.action_count} actions`)}</span></div></td>
      <td><button class="btn btn-outline-secondary btn-sm" data-open="${m.id}">${App.uiText("打开", "Open")}</button></td>
    </tr>
    <tr id="meeting-standards-${m.id}" class="meeting-standards-row"${open ? "" : " hidden"}><td colspan="5">
      <section class="meeting-expanded" aria-label="${esc(t('涉及标准', 'Related Standards'))}">
        <div class="meeting-expanded-heading"><h3>${App.uiText('涉及标准', 'Related Standards')}</h3><span class="hint">${m.standard_count}</span></div>
        ${MeetingStandards.render(m.standards, m)}
      </section>
    </td></tr>`;
  }

  /* ------------------------------- 明细与表单统一走 Records（全站共用） */
  const ctx = { onChanged: load };
  const openDetail = (id) => Records.open("meeting", id, ctx);

  document.getElementById("btn-new").onclick = () => Records.meetingForm(null, ctx);

  await load();
  const deep = new URLSearchParams(location.search).get("id");
  if (deep) openDetail(Number(deep));
});
