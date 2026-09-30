/* 总览：「登记概览」与「标准生命周期回顾」两个标签页。
   当前标签与所选标准写入网址（?tab=lifecycle&std=4），刷新或分享后回到同一视图。 */
App.ready(async () => {
  const { esc, dash, get, tag, statusTag, overdue, emptyRow } = App;

  /* ------------------------------------------------------ 网址状态 */
  const params = new URLSearchParams(location.search);
  const view = {
    tab: params.get("tab") === "lifecycle" ? "lifecycle" : "overview",
    std: Number(params.get("std")) || null,
  };

  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("tab");
    url.searchParams.delete("std");
    if (view.tab === "lifecycle") {
      url.searchParams.set("tab", "lifecycle");
      if (view.std) url.searchParams.set("std", view.std);
    }
    history.replaceState(history.state, "", url);
  }

  let lifecycleReady = false;
  document.querySelectorAll('[data-bs-toggle="tab"]').forEach((btn) => {
    btn.addEventListener("shown.bs.tab", () => {
      view.tab = btn.dataset.tab;
      syncUrl();
      if (view.tab === "lifecycle" && !lifecycleReady) {
        lifecycleReady = true;
        Lifecycle.init({
          standardId: view.std,
          onSelect: (id) => { view.std = id; syncUrl(); },
        });
      }
    });
  });

  /* ------------------------------------------------------ 登记概览 */
  // 按阶段先后由浅入深；发布、实施转为绿色，废止为红色。
  const STAGE_COLORS = ["#cfe0ef", "#b7d3ea", "#8ab8dd", "#5a98cc", "#3479b3",
                        "#1f5c8b", "#4fa384", "#1c6f55", "#b3261e"];

  const countOf = (rows) => Object.fromEntries(rows.map((r) => [r.name, r.c]));

  // 两块清单各自的筛选条件。person 为空字符串表示「不限」。
  const ANY = "";
  const filters = {
    due: { person: App.user || ANY },
    meeting: { person: App.user || ANY, from: `${new Date().getFullYear()}-01-01`, to: App.today() },
  };

  function renderStats(c) {
    document.getElementById("stats").innerHTML = [
      ["标准主档", c.standards, "/standards", ""],
      ["草案版本", c.drafts, "/drafts", ""],
      ["条款变化", c.clauses, "/drafts", ""],
      ["工作组会议", c.meetings, "/meetings", ""],
      ["正式意见", c.comments, "/comments", ""],
      ["在办事项", c.open_actions, "/actions?open=1", "flagged"],
      ["已归档标准", c.archived_standards, "/standards", ""],
    ].map(([label, n, href, cls]) =>
      `<a class="stat ${cls}" href="${href}">
         <div class="n">${n}</div><div class="l">${esc(label)}</div></a>`).join("");
  }

  function renderCharts(d) {
    Charts.bars(document.getElementById("chart-stage"), d.by_stage.map((r) => {
      const i = App.stageIndex(r.code);
      return { label: r.name, value: r.c, color: i < 0 ? "#9aa6b4" : STAGE_COLORS[i % STAGE_COLORS.length] };
    }), { note: `共 ${d.counts.standards} 项在办标准，按当前阶段分布` });

    const status = countOf(d.comment_status);
    const groups = Lifecycle.COMMENT_GROUPS.map((g) => ({
      label: g.label,
      color: g.color,
      value: g.statuses.reduce((n, s) => n + (status[s] || 0), 0),
      detail: g.statuses.map((s) => `${s} ${status[s] || 0}`).join(" · "),
    }));
    const [accepted, partial, rejected] = groups;
    const decided = accepted.value + partial.value + rejected.value;
    const rate = decided ? Math.round(((accepted.value + partial.value) / decided) * 100) : null;
    Charts.donut(document.getElementById("chart-comment"), groups, {
      centerLabel: "条意见",
      note: rate === null ? "尚无已答复的意见"
        : `已答复 ${decided} 条，采纳率（含部分采纳）<b>${rate}%</b>`,
    });
  }

  function renderDue(rows) {
    document.getElementById("due-body").innerHTML = rows.length
      ? rows.map((a) => `
        <tr class="row-click" data-open="action:${a.id}">
          <td class="num">${esc(a.item_no)}</td>
          <td>${esc(a.item_type)}</td>
          <td class="cell-main">${esc(a.title)}</td>
          <td>${a.std_no ? `<div>${esc(a.std_no)}</div><div class="cell-sub">${esc(a.name_cn)}</div>` : "—"}</td>
          <td>${statusTag(a.current_status)}</td>
          <td>${tag(a.priority)}</td>
          <td class="num">${overdue(a.due_date) ? `<span class="tag high">${esc(a.due_date)} 已逾期</span>` : dash(a.due_date)}</td>
        </tr>`).join("")
      : emptyRow(7, filters.due.person ? `${filters.due.person} 名下没有带截止日期的在办事项` : "没有带截止日期的在办事项",
                 "在事项里填写截止日期后会出现在这里；也可以把登记人切到「不限」");
    bindRows("#due-body", loadDue);
  }

  /* ------------------------------------ 今年已参加的工作组会议 */
  function renderMeetings(data) {
    document.getElementById("meeting-hint").textContent = data.total > data.items.length
      ? `共 ${data.total} 场，按日期倒序显示最近 ${data.items.length} 场`
      : `共 ${data.total} 场 · 参会人员里写了这个人，或由这个人登记的会议`;
    document.getElementById("meeting-body").innerHTML = data.items.length
      ? data.items.map((m) => `
        <tr class="row-click" data-open="meeting:${m.id}">
          <td class="num">${esc(m.meeting_no)}</td>
          <td><div class="cell-main">${esc(m.title)}</div>
              ${m.participants ? `<div class="cell-sub">参会：${esc(m.participants)}</div>` : ""}</td>
          <td class="num">${esc(m.meeting_date)}</td>
          <td>${esc(m.meeting_type)}</td>
          <td>${dash(m.organizer)}</td>
          <td>${m.standard_count
                ? `<div class="cell-sub">${esc(m.standards)}</div>`
                : '<span class="cell-sub">未挂标准</span>'}</td>
          <td>${dash(m.created_by)}</td>
        </tr>`).join("")
      : emptyRow(7, "这段时间里没有相关会议", "换个参会人或把时间范围放宽试试");
    bindRows("#meeting-body", loadMeetings);
  }

  /** 行点击统一打开记录明细；改动后只刷新对应的那块清单。 */
  function bindRows(selector, refresh) {
    document.querySelectorAll(`${selector} [data-open]`).forEach((tr) => {
      const [kind, id] = tr.dataset.open.split(":");
      tr.onclick = () => Records.open(kind, Number(id), { onChanged: refresh });
    });
  }

  /* ---------------------------------------------------------- 筛选器 */
  /** 人员下拉：候选来自后端（登记过记录的人 + 人员字典），外加「不限」。 */
  function fillPeople(id, people, selected) {
    const el = document.getElementById(id);
    const options = people.includes(selected) || !selected ? people : [selected, ...people];
    el.innerHTML = [`<option value="">不限</option>`].concat(
      options.map((p) => `<option value="${esc(p)}"${p === selected ? " selected" : ""}>${esc(p)}</option>`)).join("");
  }

  async function loadDue() {
    renderDue((await get(`/api/dashboard/due-actions?person=${encodeURIComponent(filters.due.person)}`)).items);
  }

  async function loadMeetings() {
    const q = new URLSearchParams({ person: filters.meeting.person,
                                    from: filters.meeting.from, to: filters.meeting.to });
    renderMeetings(await get(`/api/dashboard/meetings?${q}`));
  }

  function bindFilters(people) {
    fillPeople("due-person", people, filters.due.person);
    fillPeople("meeting-person", people, filters.meeting.person);
    const from = document.getElementById("meeting-from");
    const to = document.getElementById("meeting-to");
    from.value = filters.meeting.from;
    to.value = filters.meeting.to;

    document.getElementById("due-person").onchange = (e) => {
      filters.due.person = e.target.value;
      loadDue();
    };
    document.getElementById("meeting-person").onchange = (e) => {
      filters.meeting.person = e.target.value;
      loadMeetings();
    };
    const applyRange = () => {
      filters.meeting.from = from.value || `${new Date().getFullYear()}-01-01`;
      filters.meeting.to = to.value || App.today();
      from.value = filters.meeting.from;
      to.value = filters.meeting.to;
      loadMeetings();
    };
    from.onchange = applyRange;
    to.onchange = applyRange;
    document.getElementById("meeting-reset").onclick = () => {
      from.value = `${new Date().getFullYear()}-01-01`;
      to.value = App.today();
      applyRange();
    };
  }

  async function loadOverview() {
    const q = new URLSearchParams({
      action_person: filters.due.person, meeting_person: filters.meeting.person,
      from: filters.meeting.from, to: filters.meeting.to,
    });
    const d = await get(`/api/dashboard?${q}`);
    renderStats(d.counts);
    renderCharts(d);
    bindFilters(d.people);
    renderDue(d.due_actions.items);
    renderMeetings(d.meetings);
  }

  await loadOverview();
  const start = document.querySelector(`[data-tab="${view.tab}"]`);
  bootstrap.Tab.getOrCreateInstance(start).show();
  // show() 对已激活的标签不触发事件，默认标签需要手动同步一次网址。
  if (view.tab === "overview") syncUrl();
});
