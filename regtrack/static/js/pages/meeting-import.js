App.ready(() => {
  const {esc, post, t} = App, el = id => document.getElementById(id);
  let data, generation = 0, meetingChoice = '', busy = false, actionReview, reviewedMeeting = '';
  const actionKeep = new Map();
  const target = new URLSearchParams(location.search).get('meeting_id');
  el('source-upload').onclick = () => {
    el('manual-import-content').hidden = true;
    el('source-upload').classList.add('selected');
    el('manual-import-button').classList.remove('selected');
    el('source-upload-message').textContent = t('接口暂未接通，请使用手动导入。', 'Not connected yet. Please use manual import.');
  };
  el('manual-import-button').onclick = () => {
    el('manual-import-content').hidden = false;
    el('source-upload').classList.remove('selected');
    el('manual-import-button').classList.add('selected');
    el('source-upload-message').textContent = '';
    el('manual-import-guide').open = true;
    el('minutes-file').focus({preventScroll:true});
  };
  fetch('/static/meeting-import-prompt.txt?v=v20-fix2.8c').then(r => {if (!r.ok) throw Error(t('提示词加载失败，请刷新页面重试', 'Failed to load the prompt. Refresh and try again.')); return r.text();}).then(t => el('minutes-prompt').value = t).catch(e => el('copy-status').textContent = e.message);
  el('copy-prompt').onclick = async () => {
    if (!el('minutes-prompt').value) return;
    try {await navigator.clipboard.writeText(el('minutes-prompt').value); el('copy-status').textContent = t('已复制提示词', 'Prompt copied');}
    catch {el('minutes-prompt').select(); el('copy-status').textContent = t('请按 Ctrl+C 复制', 'Press Ctrl+C to copy');}
  };
  function showStep(step) {
    document.querySelectorAll('[data-step]').forEach(p => p.hidden = Number(p.dataset.step) !== step);
    document.querySelectorAll('[data-progress]').forEach(p => {p.removeAttribute('aria-current'); if(Number(p.dataset.progress) === step) p.setAttribute('aria-current','step');});
    el('file-context').hidden = step === 0;
    el('confirm-import').checked = false;
    el('commit-error').textContent = '';
    document.querySelector(`[data-step="${step}"] h2`).focus({preventScroll:true});
    window.scrollTo({top:0,behavior:'smooth'});
  }
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => {if (!busy) showStep(Number(b.dataset.back));});
  el('minutes-file').onchange = async () => {
    const run = ++generation, file = el('minutes-file').files[0];
    data = null; meetingChoice = ''; actionReview = null; actionKeep.clear(); reviewedMeeting = ''; el('start-review').disabled = true;
    el('read-error').textContent = ''; el('import-success').hidden = true;
    el('action-preview').innerHTML = ''; el('upload-status').textContent = t('上传后继续确认会议', 'Upload to continue');
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 2*1024*1024) throw Error(t('请选择 2 MB 以内的 .xlsx 会议数据包', 'Choose an .xlsx meeting file up to 2 MB'));
      el('upload-status').textContent = t('正在读取 Excel…', 'Reading Excel…');
      const form = new FormData(); form.append('file',file);
      const result = await post('/api/meetings/imports/preview',form);
      if(run !== generation) return;
      data = result; renderMeeting(); renderStandards();
      el('file-context').textContent = file.name + ' · ' + data.package.meeting.meeting_date;
      el('upload-status').textContent = t(`已读取 1 场会议、${data.package.standards.length} 项标准，尚未写入数据库`, `Read 1 meeting and ${data.package.standards.length} standard(s); nothing saved yet`);
      el('start-review').disabled = false;
    } catch(e) {if(run === generation) {el('read-error').textContent = e.message; el('upload-status').textContent = t('请修正 Excel 后重新上传', 'Fix the Excel and upload again');}}
  };
  el('start-review').onclick = () => showStep(1);
  function renderMeeting() {
    const m = data.package.meeting;
    el('meeting-source').innerHTML = `<div class="minutes-source"><h3>${esc(m.title)}</h3><div>${esc(m.meeting_date)}${m.organizer ? ' · '+esc(m.organizer) : ''}</div><details><summary>${t('查看整体议题与结论', 'View discussion and conclusion')}</summary><div class="minutes-note">${esc(m.key_discussions)}${m.overall_conclusion ? '\n\n'+t('整体结论：', 'Conclusion: ')+esc(m.overall_conclusion) : ''}</div></details></div>`;
    el('meeting-options').innerHTML = data.meetings.map(m => `<label class="minutes-option"><input type="radio" name="meeting" value="${m.id}" required><span><strong>${esc(m.title)}</strong><small>${esc(m.meeting_date)} · ${m.same_day?t('同日会议', 'Same day'):''}${m.same_day && m.similar_title?' · ':''}${m.similar_title?(m.exact?t('标题完全一致', 'Identical title'):m.similarity+t('% 标题相似，请注意是否为系列会议', '% similar title; check whether it is a series meeting')):''}${String(m.id) === target ? t(' · 当前打开的会议', ' · Currently open meeting') : ''}</small></span></label>`).join('') + (data.meetings.some(m=>m.exact && m.same_day) ? '' : `<label class="minutes-option"><input type="radio" name="meeting" value="new" required><span><strong>${window.App.uiText('新建这场会议', 'Create this meeting')}</strong><small>${t('使用 Excel 中的标题和日期建档', 'Use the title and date from the Excel')}</small></span></label>`);
    el('meeting-existing').textContent = target && !data.meetings.some(m=>String(m.id)===target) ? t('当前打开的会议不符合日期或标题条件，请选择其他候选或新建。', 'The meeting you opened does not match the date or title. Choose another candidate or create a new one.') : '';
    el('meeting-options').onchange = e => {
      meetingChoice = e.target.value;
      const m = data.meetings.find(m=>String(m.id)===meetingChoice);
      const differentDate = m && m.meeting_date !== data.package.meeting.meeting_date;
      el('meeting-source').querySelector('details').hidden = !!differentDate;
      el('meeting-existing').textContent = m ? (differentDate
        ? t(`所选会议日期 ${m.meeting_date} 与 Excel 日期 ${data.package.meeting.meeting_date} 不同。关联后保留现有会议的标题和日期，请核对是否为同一场会议。`,
            `The selected meeting date ${m.meeting_date} differs from the Excel date ${data.package.meeting.meeting_date}. The existing title and date are kept; check that it is the same meeting.`)
        : t(`现有讨论：${m.key_discussions || '未填写'}\n\n新内容将追加，相同内容不重复添加。`, `Existing discussion: ${m.key_discussions || 'none'}\n\nNew content is appended; duplicates are not added.`)) : '';
    };
  }
  el('meeting-step').onsubmit = e => {e.preventDefault(); if (el('meeting-step').reportValidity()) showStep(2);};
  function renderStandards() {
    el('standard-choices').innerHTML = data.package.standards.map((s,i) => `<article class="minutes-standard">
      <div class="minutes-standard-row"><div class="minutes-standard-identity"><span class="minutes-standard-index">${i+1}</span><div><h3>${esc(s.name_cn)}</h3>${data.package.meeting.title.includes('系列标准') ? `<p class="minutes-series-warning" role="note">${t('请注意，系列标准是否要建档', 'Check whether each standard of the series needs a profile')}</p>` : ''}<span class="minutes-standard-number">${esc(s.std_no || t('尚未编号', 'No number yet'))} · ${t('本次会议阶段：', 'Stage at this meeting: ')}${esc(s.current_stage)}</span></div></div>
      <div class="minutes-standard-choice"><label for="standard-${i}" class="form-label">${App.label('Tracking', '追踪选择')}</label><select id="standard-${i}" class="form-select form-select-sm" required><option value="">${t('请选择处理方式…', 'Choose…')}</option>${data.standards[i].candidates.map(c=>`<option value="${c.id}" ${c.archived_at ? 'disabled' : ''}>${t('匹配已有', 'Existing')} · ${esc(c.std_no || t('尚未编号', 'No number yet'))} · ${esc(c.name_cn)}（${c.exact?t('名称一致', 'same name'):c.similarity+t('% 相似', '% similar')}${c.archived_at?t('，已归档，需先恢复', ', archived; restore it first'):''}）</option>`).join('')}<option value="create">${t('新建主档并追踪', 'Create profile and track')}</option><option value="skip">${t('不追踪，不入库', 'Do not track or import')}</option></select></div></div>
      <fieldset id="profile-${i}" class="minutes-profile" hidden disabled><div><label class="form-label" for="name-${i}">${App.label('Standard Name CN', '标准名称')}</label><input id="name-${i}" class="form-control form-control-sm" value="${esc(s.name_cn)}" required></div><div><label class="form-label" for="number-${i}">${App.label('Standard No.', '标准号')} <span class="text-muted">${window.App.uiText('（可留空）', '(optional)')}</span></label><input id="number-${i}" class="form-control form-control-sm" value="${esc(s.std_no)}" placeholder="${t('如 GB/T XXXX，可留空', 'e.g. GB/T XXXX; optional')}"></div></fieldset>
      <details><summary>${t('查看会议纪要', 'View minutes')}</summary><div class="minutes-note">${esc(s.note)}</div></details></article>`).join('') || `<div class="minutes-empty">${t('本次没有分标准纪要，可直接进入下一步。', 'No per-standard minutes this time; continue to the next step.')}</div>`;
    data.package.standards.forEach((s,i) => el(`standard-${i}`).onchange = () => {
      const create = el(`standard-${i}`).value === 'create';
      el(`profile-${i}`).hidden = !create; el(`profile-${i}`).disabled = !create; updateCount();
    });
    updateCount();
  }
  function choices() {
    return Object.fromEntries(data.package.standards.map((s,i)=>{
      const v = el(`standard-${i}`).value;
      return [s.key, v==='create' ? {mode:'create',profile:{name_cn:el(`name-${i}`).value.trim(),std_no:el(`number-${i}`).value.trim()}} : v==='skip' ? {mode:'skip'} : v ? {mode:'existing',id:Number(v)} : {mode:''}];
    }));
  }
  function updateCount() {
    const values = Object.values(choices());
    const confirmed = values.filter(v=>v.mode).length, tracked = values.filter(v=>['existing','create'].includes(v.mode)).length, skipped = values.filter(v=>v.mode==='skip').length;
    el('standards-count').textContent = t(`已确认 ${confirmed} / ${values.length} 项 · 追踪 ${tracked} 项 · 不追踪 ${skipped} 项`, `${confirmed} / ${values.length} decided · ${tracked} tracked · ${skipped} not tracked`);
  }
  el('standards-step').onsubmit = async e => {
    e.preventDefault(); if (busy || !el('standards-step').reportValidity()) return;
    const invalid = data.package.standards.findIndex((s,i)=>el(`standard-${i}`).value==='create' && !el(`name-${i}`).value.trim());
    if(invalid>=0) {el(`name-${invalid}`).focus(); App.fail(t('请补全标准名称', 'Enter the standard name')); return;}
    busy=true; const button=el('standards-step').querySelector('button[type=submit]'); button.disabled=true;
    try {await renderReview(); showStep(3);} catch(err) {App.fail(err.message);}
    finally {busy=false; button.disabled=false;}
  };
  async function renderReview() {
    const selection=choices(), values=Object.values(selection);
    actionReview=await post('/api/meetings/imports/review',{package:data.package,decision:{meeting_id:meetingChoice==='new'?'new':Number(meetingChoice),standards:selection}});
    if(reviewedMeeting!==meetingChoice) actionKeep.clear(); reviewedMeeting=meetingChoice;
    actionReview.rows.forEach(r=>{if(!actionKeep.has(r.key)) actionKeep.set(r.key,r.keep);});
    const tracked = new Set(Object.keys(selection).filter(k=>selection[k].mode!=='skip'));
    const m=data.meetings.find(m=>String(m.id)===meetingChoice);
    const created = values.filter(v=>v.mode==='create').length, skipped = values.filter(v=>v.mode==='skip').length;
    el('import-summary').innerHTML = `<strong>${meetingChoice==='new'?t('新建会议', 'New meeting'):t('补全会议', 'Update meeting')}：${esc(m ? m.title : data.package.meeting.title)}</strong><br>${esc(m ? m.meeting_date : data.package.meeting.meeting_date)} · ${t(`追踪 ${tracked.size} 项标准（新建 ${created} 项） · 不追踪 ${skipped} 项`, `${tracked.size} standard(s) tracked (${created} new) · ${skipped} not tracked`)}`;
    el('selected-standards').innerHTML = data.package.standards.map(s=>`<div class="minutes-selected"><span>${esc(selection[s.key].mode==='create' ? selection[s.key].profile.name_cn : s.name_cn)}</span><small>${selection[s.key].mode==='skip'?t('不入库', 'Not imported'):selection[s.key].mode==='create'?t('新建并追踪', 'New and tracked'):t('匹配已有主档', 'Existing profile')}${selection[s.key].mode==='skip'?'':t(' · 会议阶段：', ' · Meeting stage: ')+esc(s.current_stage)}</small></div>`).join('');
    const rows=[...actionReview.rows].sort((a,b)=>a.title.localeCompare(b.title,'zh') || a.origin.localeCompare(b.origin));
    el('action-preview').innerHTML = rows.map(a=>`<article class="minutes-action" data-action-key="${a.key}"><div class="minutes-action-head"><div class="minutes-action-content"><div class="minutes-action-meta"><span class="minutes-origin ${a.origin}">${a.origin==='existing'?t('已有事项', 'Existing'):t('本次新增', 'New')}</span><span>${esc(a.item_no)}${a.origin==='existing'?' · '+esc(a.current_status):''}</span>${a.duplicates.length?`<span class="minutes-duplicate">${window.App.uiText('可能重复', 'Possible duplicate')}</span>`:''}</div><strong>${esc(a.title)}</strong></div><button type="button" class="btn btn-outline-secondary btn-sm" data-toggle-action="${a.key}"></button></div><div class="minutes-action-content"><p>${esc(a.description)}</p><small>${t('关联：', 'Standards: ')}${esc(a.standard_names)} · ${t('响应单位：', 'Stakeholder: ')}${esc(a.stakeholder || t('待明确', 'TBD'))} · ${t('截止：', 'Due: ')}${esc(a.due_date || t('待明确', 'TBD'))}</small>${a.recipient_count?`<div class="form-text">${t(`已有 ${a.recipient_count} 条反馈记录，删除事项时将一并删除。`, `${a.recipient_count} feedback record(s) will be deleted with this action.`)}</div>`:''}</div></article>`).join('') || `<div class="minutes-empty">${t('没有需要核对的事项。', 'No actions to review.')}</div>`;
    el('excluded-message').textContent = actionReview.excluded_actions ? t(`已排除 ${actionReview.excluded_actions} 条仅关联不追踪标准的事项。相应标准及纪要也不入库。`, `${actionReview.excluded_actions} action(s) linked only to untracked standards were excluded, together with those standards and minutes.`) : '';
    updateActionReview();
  }
  el('action-preview').onclick = e => {
    const button=e.target.closest('[data-toggle-action]'); if(!button || busy) return;
    const key=button.dataset.toggleAction; actionKeep.set(key,!actionKeep.get(key));
    el('confirm-import').checked=false; updateActionReview();
  };
  function updateActionReview() {
    const rows=actionReview.rows, old=rows.filter(r=>r.origin==='existing'), fresh=rows.filter(r=>r.origin==='new');
    const deleted=old.filter(r=>!actionKeep.get(r.key)).length, omitted=fresh.filter(r=>!actionKeep.get(r.key)).length;
    rows.forEach(r=>{const card=el('action-preview').querySelector(`[data-action-key="${r.key}"]`), keep=actionKeep.get(r.key), button=card.querySelector('button'); card.classList.toggle('is-removed',!keep); button.textContent=keep?t('删除', 'Remove'):t('恢复', 'Restore'); button.setAttribute('aria-pressed',String(!keep)); button.setAttribute('aria-label',button.textContent+': '+r.title);});
    const unresolved=rows.reduce((n,r)=>n+(actionKeep.get(r.key)?r.duplicates.filter(k=>actionKeep.get(k)).length:0),0)/2;
    el('action-count').textContent=t(`保留已有 ${old.length-deleted} 条 · 新增 ${fresh.length-omitted} 条 · 删除已有 ${deleted} 条 · 不导入新事项 ${omitted} 条`, `${old.length-deleted} existing kept · ${fresh.length-omitted} new · ${deleted} existing removed · ${omitted} new not imported`);
    const warning=el('action-warning'); warning.hidden=!rows.some(r=>r.duplicates.length);
    warning.textContent=unresolved?t(`仍保留 ${unresolved} 对可能重复的事项，请对照内容并删除多余项，也可确认同时保留。`, `${unresolved} possible duplicate pair(s) are still kept. Compare and remove extras, or keep both.`):t('已标记同标题的新事项为不导入，可点击“恢复”调整；最终以当前保留范围为准。', 'New actions with an existing title are marked as not imported; click Restore to change this.');
    const notice=el('action-delete-notice'); notice.hidden=!deleted && !omitted;
    notice.textContent=t(`确认后将删除 ${deleted} 条已有事项（含其状态历史和反馈记录），${omitted} 条新事项不入库。标记删除尚未写入数据库，可随时恢复。`, `On confirm, ${deleted} existing action(s) (with status history and feedback) will be deleted and ${omitted} new action(s) skipped. Nothing is saved yet; you can still restore them.`);
  }
  function actionDecision() {
    return {existing_snapshot:actionReview.existing_snapshot,keep_existing:actionReview.rows.filter(r=>r.origin==='existing' && actionKeep.get(r.key)).map(r=>Number(r.key.split(':')[1])),keep_new:actionReview.rows.filter(r=>r.origin==='new' && actionKeep.get(r.key)).map(r=>Number(r.key.split(':')[1]))};
  }
  el('review-step').onsubmit = async e => {
    e.preventDefault(); if(busy || !el('review-step').reportValidity()) return;
    busy=true; el('commit-error').textContent=''; el('review-step').querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const r=await post('/api/meetings/imports',{package:data.package,decision:{meeting_id:meetingChoice==='new'?'new':Number(meetingChoice),standards:choices(),actions:actionDecision(),confirmed:true}});
      document.querySelectorAll('[data-step]').forEach(p=>p.hidden=true); el('import-success').hidden=false;
      el('import-success').firstElementChild.innerHTML=t(`<h2 class="h5">会议纪要已导入</h2><p>新建 ${r.created_standards} 项标准主档；${r.skipped_standards} 项不追踪标准及纪要未入库。主档阶段已按最新会议与手动记录校准（推进 ${r.advanced_standards} 项）。</p><p>新增 ${r.created_actions} 条事项，删除 ${r.deleted_actions} 条已有事项；${r.omitted_actions} 条新事项未导入，${r.excluded_actions} 条不追踪标准事项已排除。</p>`,
        `<h2 class="h5">Meeting minutes imported</h2><p>${r.created_standards} standard profile(s) created; ${r.skipped_standards} untracked standard(s) and their minutes skipped. Stages were aligned with the latest meeting and manual records (${r.advanced_standards} advanced).</p><p>${r.created_actions} action(s) added and ${r.deleted_actions} removed; ${r.omitted_actions} new action(s) not imported and ${r.excluded_actions} excluded for untracked standards.</p>`)
        + `<a class="btn btn-primary" href="/meetings?id=${r.meeting_id}">${window.App.uiText('查看会议', 'View meeting')}</a>`;
      window.scrollTo({top:0,behavior:'smooth'});
    } catch(err) {el('commit-error').textContent=err.message;}
    finally {busy=false; el('review-step').querySelectorAll('button').forEach(b=>b.disabled=false);}
  };
});
