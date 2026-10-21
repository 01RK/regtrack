/* 会议标准明细：列表与详情共用紧凑标准行，只有详情展示 Note 和编辑入口。 */
(() => {
  const { esc, dash, label, uiText } = App;

  function render(standards, meeting, { showNotes = false } = {}) {
    if (!standards.length) return `<div class="empty">${uiText('还没有挂载标准', 'No standards linked')}</div>`;
    return `<div class="meeting-standard-list">${standards.map(s => {
      const source = {meeting_id:meeting.id, meeting_no:meeting.meeting_no, meeting_title:meeting.title,
        standard_id:s.id, std_no:s.std_no, name_cn:s.name_cn};
      return `<article class="meeting-standard-row">
        <header class="meeting-standard-heading"><div><div class="meeting-standard-number"><b>${esc(s.std_no)}</b><span class="tag info meeting-standard-stage">${esc(App.stageLabel(s.stage_code))}</span></div><div class="cell-sub">${esc(s.name_cn)}</div></div>
          ${showNotes ? `<div class="meeting-standard-tools"><button class="btn-link-quiet" data-note="${s.id}">${uiText(s.note ? '编辑批注' : '添加批注', s.note ? 'Edit note' : 'Add note')}</button><button class="btn-link-quiet" data-detach="${s.id}">${uiText('移除', 'Remove')}</button></div>` : ''}
        </header>
        <dl class="meeting-standard-meta">
          <div><dt>${label('Owner', '负责人')}</dt><dd>${dash(s.mb_owner)}</dd></div>
          <div><dt>${label('Actions', '派生事项')}</dt><dd>${s.action_count}</dd></div>
        </dl>
        <div class="meeting-standard-work"><div class="meeting-work-label">${label('Derive Follow-up', '派生后续工作')}</div>
          <div class="derive-bar">${App.meta.action_types.map(type => `<button class="btn btn-sm" data-derive='${esc(JSON.stringify({...source, type}))}'>+ ${esc(type)}</button>`).join('')}</div>
        </div>
        ${showNotes && s.note ? `<div class="meeting-standard-note"><strong>${label('Note', '本会批注')}</strong><div class="link-note">${esc(s.note)}</div></div>` : ''}
      </article>`;
    }).join('')}</div>`;
  }
  window.MeetingStandards = { render };
})();
