App.ready(() => {
  const {esc, post} = App, el = id => document.getElementById(id);
  let data, generation = 0, meetingChoice = '', busy = false, actionReview, reviewedMeeting = '';
  const actionKeep = new Map();
  const target = new URLSearchParams(location.search).get('meeting_id');
  el('source-upload').onclick = () => {
    el('manual-import-content').hidden = true;
    el('source-upload').classList.add('selected');
    el('manual-import-button').classList.remove('selected');
    el('source-upload-message').textContent = '接口暂未接通，请使用手动导入。';
  };
  el('manual-import-button').onclick = () => {
    el('manual-import-content').hidden = false;
    el('source-upload').classList.remove('selected');
    el('manual-import-button').classList.add('selected');
    el('source-upload-message').textContent = '';
    el('manual-import-guide').open = true;
    el('minutes-file').focus({preventScroll:true});
  };
  fetch('/static/meeting-import-prompt.txt?v=action-review').then(r => {if (!r.ok) throw Error('提示词加载失败，请刷新页面重试'); return r.text();}).then(t => el('minutes-prompt').value = t).catch(e => el('copy-status').textContent = e.message);
  el('copy-prompt').onclick = async () => {
    if (!el('minutes-prompt').value) return;
    try {await navigator.clipboard.writeText(el('minutes-prompt').value); el('copy-status').textContent = '已复制提示词';}
    catch {el('minutes-prompt').select(); el('copy-status').textContent = '请按 Ctrl+C 复制';}
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
    el('action-preview').innerHTML = ''; el('upload-status').textContent = '上传后继续确认会议';
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 2*1024*1024) throw Error('请选择 2 MB 以内的 .xlsx 会议数据包');
      el('upload-status').textContent = '正在读取 Excel…';
      const form = new FormData(); form.append('file',file);
      const result = await post('/api/meetings/imports/preview',form);
      if(run !== generation) return;
      data = result; renderMeeting(); renderStandards();
      el('file-context').textContent = file.name + ' · ' + data.package.meeting.meeting_date;
      el('upload-status').textContent = `已读取 1 场会议、${data.package.standards.length} 项标准，尚未写入数据库`;
      el('start-review').disabled = false;
    } catch(e) {if(run === generation) {el('read-error').textContent = e.message; el('upload-status').textContent = '请修正 Excel 后重新上传';}}
  };
  el('start-review').onclick = () => showStep(1);
  function renderMeeting() {
    const m = data.package.meeting;
    el('meeting-source').innerHTML = `<div class="minutes-source"><h3>${esc(m.title)}</h3><div>${esc(m.meeting_date)}${m.organizer ? ' · '+esc(m.organizer) : ''}</div><details><summary>查看整体议题与结论</summary><div class="minutes-note">${esc(m.key_discussions)}${m.overall_conclusion ? '\n\n整体结论：'+esc(m.overall_conclusion) : ''}</div></details></div>`;
    el('meeting-options').innerHTML = data.meetings.map(m => `<label class="minutes-option"><input type="radio" name="meeting" value="${m.id}" required><span><strong>${esc(m.title)}</strong><small>${esc(m.meeting_date)} · ${m.same_day?'同日会议':''}${m.same_day && m.similar_title?' · ':''}${m.similar_title?(m.exact?'标题完全一致':m.similarity+'% 标题相似'):''}${String(m.id) === target ? ' · 当前打开的会议' : ''}</small></span></label>`).join('') + (data.meetings.some(m=>m.exact && m.same_day) ? '' : '<label class="minutes-option"><input type="radio" name="meeting" value="new" required><span><strong>新建这场会议</strong><small>使用 Excel 中的标题和日期建档</small></span></label>');
    el('meeting-existing').textContent = target && !data.meetings.some(m=>String(m.id)===target) ? '当前打开的会议不符合日期或标题条件，请选择其他候选或新建。' : '';
    el('meeting-options').onchange = e => {
      meetingChoice = e.target.value;
      const m = data.meetings.find(m=>String(m.id)===meetingChoice);
      el('meeting-existing').textContent = m ? `${m.meeting_date!==data.package.meeting.meeting_date?`所选会议日期 ${m.meeting_date} 与 Excel 日期 ${data.package.meeting.meeting_date} 不同。关联后保留现有会议的标题和日期，请核对是否为同一场会议。\n\n`:''}现有讨论：${m.key_discussions || '未填写'}\n\n新内容将追加，相同内容不重复添加。` : '';
    };
  }
  el('meeting-step').onsubmit = e => {e.preventDefault(); if (el('meeting-step').reportValidity()) showStep(2);};
  function renderStandards() {
    el('standard-choices').innerHTML = data.package.standards.map((s,i) => `<article class="minutes-standard">
      <div class="minutes-standard-row"><div class="minutes-standard-identity"><span class="minutes-standard-index">${i+1}</span><div><h3>${esc(s.name_cn)}</h3><span class="minutes-standard-number">${esc(s.std_no || '尚未编号')}</span></div></div>
      <div class="minutes-standard-choice"><label for="standard-${i}" class="form-label">追踪选择</label><select id="standard-${i}" class="form-select form-select-sm" required><option value="">请选择处理方式…</option>${data.standards[i].candidates.map(c=>`<option value="${c.id}" ${c.archived_at ? 'disabled' : ''}>匹配已有 · ${esc(c.std_no || '尚未编号')} · ${esc(c.name_cn)}（${c.exact?'名称一致':c.similarity+'% 相似'}${c.archived_at?'，已归档，需先恢复':''}）</option>`).join('')}<option value="create">新建主档并追踪</option><option value="skip">不追踪，不入库</option></select></div></div>
      <fieldset id="profile-${i}" class="minutes-profile" hidden disabled><div><label class="form-label" for="name-${i}">标准名称</label><input id="name-${i}" class="form-control form-control-sm" value="${esc(s.name_cn)}" required></div><div><label class="form-label" for="number-${i}">标准号 <span class="text-muted">（可留空）</span></label><input id="number-${i}" class="form-control form-control-sm" value="${esc(s.std_no)}" placeholder="如 GB/T XXXX，可留空"></div></fieldset>
      <details><summary>查看会议纪要</summary><div class="minutes-note">${esc(s.note)}</div></details></article>`).join('') || '<div class="minutes-empty">本次没有分标准纪要，可直接进入下一步。</div>';
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
    el('standards-count').textContent = `已确认 ${values.filter(v=>v.mode).length} / ${values.length} 项 · 追踪 ${values.filter(v=>['existing','create'].includes(v.mode)).length} 项 · 不追踪 ${values.filter(v=>v.mode==='skip').length} 项`;
  }
  el('standards-step').onsubmit = async e => {
    e.preventDefault(); if (busy || !el('standards-step').reportValidity()) return;
    const invalid = data.package.standards.findIndex((s,i)=>el(`standard-${i}`).value==='create' && !el(`name-${i}`).value.trim());
    if(invalid>=0) {el(`name-${invalid}`).focus(); App.fail('请补全标准名称'); return;}
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
    el('import-summary').innerHTML = `<strong>${meetingChoice==='new'?'新建会议':'补全会议'}：${esc(m ? m.title : data.package.meeting.title)}</strong><br>${esc(m ? m.meeting_date : data.package.meeting.meeting_date)} · 追踪 ${tracked.size} 项标准（新建 ${values.filter(v=>v.mode==='create').length} 项） · 不追踪 ${values.filter(v=>v.mode==='skip').length} 项`;
    el('selected-standards').innerHTML = data.package.standards.map(s=>`<div class="minutes-selected"><span>${esc(selection[s.key].mode==='create' ? selection[s.key].profile.name_cn : s.name_cn)}</span><small>${selection[s.key].mode==='skip'?'不入库':selection[s.key].mode==='create'?'新建并追踪':'匹配已有主档'}</small></div>`).join('');
    const rows=[...actionReview.rows].sort((a,b)=>a.title.localeCompare(b.title,'zh') || a.origin.localeCompare(b.origin));
    el('action-preview').innerHTML = rows.map(a=>`<article class="minutes-action" data-action-key="${a.key}"><div class="minutes-action-head"><div class="minutes-action-content"><div class="minutes-action-meta"><span class="minutes-origin ${a.origin}">${a.origin==='existing'?'已有事项':'本次新增'}</span><span>${esc(a.item_no)}${a.origin==='existing'?' · '+esc(a.current_status):''}</span>${a.duplicates.length?'<span class="minutes-duplicate">可能重复</span>':''}</div><strong>${esc(a.title)}</strong></div><button type="button" class="btn btn-outline-secondary btn-sm" data-toggle-action="${a.key}"></button></div><div class="minutes-action-content"><p>${esc(a.description)}</p><small>关联：${esc(a.standard_names)} · 负责人：${esc(a.owner || '待明确')} · 截止：${esc(a.due_date || '待明确')}</small>${a.recipient_count?`<div class="form-text">已有 ${a.recipient_count} 条反馈记录，删除事项时将一并删除。</div>`:''}</div></article>`).join('') || '<div class="minutes-empty">没有需要核对的事项。</div>';
    el('excluded-message').textContent = actionReview.excluded_actions ? `已排除 ${actionReview.excluded_actions} 条仅关联不追踪标准的事项。相应标准及纪要也不入库。` : '';
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
    rows.forEach(r=>{const card=el('action-preview').querySelector(`[data-action-key="${r.key}"]`), keep=actionKeep.get(r.key), button=card.querySelector('button'); card.classList.toggle('is-removed',!keep); button.textContent=keep?'删除':'恢复'; button.setAttribute('aria-pressed',String(!keep)); button.setAttribute('aria-label',(keep?'删除':'恢复')+'：'+r.title);});
    const unresolved=rows.reduce((n,r)=>n+(actionKeep.get(r.key)?r.duplicates.filter(k=>actionKeep.get(k)).length:0),0)/2;
    el('action-count').textContent=`保留已有 ${old.length-deleted} 条 · 新增 ${fresh.length-omitted} 条 · 删除已有 ${deleted} 条 · 不导入新事项 ${omitted} 条`;
    const warning=el('action-warning'); warning.hidden=!rows.some(r=>r.duplicates.length);
    warning.textContent=unresolved?`仍保留 ${unresolved} 对可能重复的事项，请对照内容并删除多余项，也可确认同时保留。`:'已标记同标题的新事项为不导入，可点击“恢复”调整；最终以当前保留范围为准。';
    const notice=el('action-delete-notice'); notice.hidden=!deleted && !omitted;
    notice.textContent=`确认后将删除 ${deleted} 条已有事项（含其状态历史和反馈记录），${omitted} 条新事项不入库。标记删除尚未写入数据库，可随时恢复。`;
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
      el('import-success').firstElementChild.innerHTML=`<h2 class="h5">会议纪要已导入</h2><p>新建 ${r.created_standards} 项标准主档；${r.skipped_standards} 项不追踪标准及纪要未入库。</p><p>新增 ${r.created_actions} 条事项，删除 ${r.deleted_actions} 条已有事项；${r.omitted_actions} 条新事项未导入，${r.excluded_actions} 条不追踪标准事项已排除。</p><a class="btn btn-primary" href="/meetings?id=${r.meeting_id}">查看会议</a>`;
      window.scrollTo({top:0,behavior:'smooth'});
    } catch(err) {el('commit-error').textContent=err.message;}
    finally {busy=false; el('review-step').querySelectorAll('button').forEach(b=>b.disabled=false);}
  };
});
