/* Draft comparison tab: choose a draft pair, hand the workbook to a model and import the result.
   Saved results open on their own page (comparison-detail.js). */
App.ready(async () => {
  const {esc, t, get, api} = App;
  const el = id => document.getElementById(`cmp-${id}`);
  const key = 'regtrack.comparison-view.v21-fix5';
  const state = Object.assign({standard:'', before:'', after:'', confirmed:false, tab:'#tab-drafts'}, JSON.parse(sessionStorage.getItem(key) || '{}'));
  const save = () => sessionStorage.setItem(key, JSON.stringify(state));
  // “Back” from a result page reopens this tab on that draft pair.
  const linked = new URLSearchParams(location.search);
  if (linked.has('before')) {
    Object.assign(state, {standard:linked.get('standard'), before:linked.get('before'), after:linked.get('after'), confirmed:false, tab:'#tab-compare'});
    save();
    history.replaceState(null, '', `/drafts${location.hash}`);
  }
  const classes = {Substantive:['实质修订','Substantive'], Editorial:['编辑性修订','Editorial'], Uncertain:['待核实','Uncertain'], Unchanged:['未变更','Unchanged']};
  const classTag = {Substantive:'high', Editorial:'info', Uncertain:'medium', Unchanged:'muted'};
  const language = document.documentElement.lang === 'en' ? 'en' : 'cn';
  const resultUrl = id => `/drafts/comparisons/${id}`;
  const say = pair => t(...pair);
  const run = (fn, target) => async (...args) => {
    target.textContent = '';
    try { await fn(...args); } catch (error) { target.textContent = error.message; }
  };
  let drafts = [], pair = null, preview = null;
  const version = d => `${d.version_name} v${d.sub_version_no}`;
  const pairQuery = () => new URLSearchParams({before_draft_id:state.before, after_draft_id:state.after});

  /* ---------- Step 1: standard and draft pair ---------- */
  // Selecting both drafts checks the pair at once: an existing comparison opens directly,
  // otherwise “Confirm drafts” leads to step 2.
  let checking = 0;
  async function checkPair() {
    pair = null;
    const ticket = ++checking;
    el('pair-error').textContent = '';
    el('existing').hidden = true; el('confirm').hidden = false; el('confirm').disabled = true;
    if (!(state.before && state.after)) return;
    const found = await get('/api/comparisons/pair', Object.fromEntries(pairQuery()));
    if (ticket !== checking) return;  // a newer selection replaced this one
    pair = found;
    el('existing').hidden = !pair.comparison_id;
    el('confirm').hidden = !!pair.comparison_id;
    el('confirm').disabled = false;
    if (pair.comparison_id) el('open').href = resultUrl(pair.comparison_id);
  }
  async function loadSaved() {
    const rows = state.standard ? await get('/api/comparisons', {standard_id:state.standard}) : [];
    el('saved').hidden = !rows.length;
    el('saved-list').innerHTML = rows.map(r => {
      const current = String(r.before_draft_id) === state.before && String(r.after_draft_id) === state.after;
      return `<a class="cmp-saved-item${current ? ' current' : ''}" href="${resultUrl(r.id)}">
        <strong>${esc(r.before_version)} v${esc(r.before_sub)} → ${esc(r.after_version)} v${esc(r.after_sub)}</strong>
        <small>${r.row_count} ${t('项对应','rows')} · ${esc(r.created_by)} · ${esc(r.created_at.slice(0, 10))}</small>
        <span>${t('查看 →','Open →')}</span></a>`;
    }).join('');
  }
  async function loadDrafts() {
    drafts = state.standard ? await get('/api/comparisons/options', {standard_id:state.standard}) : [];
    const options = `<option value="">${t('选择草案','Select draft')}</option>` + drafts.map(d =>
      `<option value="${d.id}" ${d.chapter_count ? '' : 'disabled'}>${esc(version(d))} · ${esc(d.draft_date)} · ${d.chapter_count ? `${d.chapter_count} ${t('条原文','chapters')}` : t('未导入原文','no source text')}</option>`).join('');
    el('before').innerHTML = el('after').innerHTML = options;
    el('before').value = state.before; el('after').value = state.after;
    el('before').disabled = el('after').disabled = !state.standard;
    await Promise.all([checkPair(), loadSaved()]);
  }
  function showForm() {
    state.confirmed = false; save();
    el('pair-form').hidden = false; el('pair-summary').hidden = true;
    el('step-generate').hidden = true;
  }
  function confirmPair() {
    state.confirmed = true; save();
    const s = pair.standard;
    el('summary-standard').textContent = `${s.std_no || ''} ${App.lang === 'en' ? (s.name_en || s.name_cn) : s.name_cn}`;
    const side = d => `${version(d)}${t(`（${d.chapter_count} 条）`, ` (${d.chapter_count} chapters)`)}`;
    el('summary-drafts').textContent = `${side(pair.before)} → ${side(pair.after)}`;
    el('pair-form').hidden = true; el('pair-summary').hidden = false;
    el('workbook-link').href = `/api/comparisons/workbook?${pairQuery()}`;
    el('workbook-link').textContent = pair.workbook_name;
    resetUpload();
    el('step-generate').hidden = false;
  }
  Fields.standard(el('standard'), {
    quickCreate: false,
    value: state.standard,
    placeholder: t('按编号或名称搜索标准…', 'Search standards by number or name…'),
    onChange: run(async value => {
      if (value === state.standard) return;
      Object.assign(state, {standard:value, before:'', after:''});
      showForm(); await loadDrafts();
    }, el('pair-error')),
  });
  for (const side of ['before','after']) el(side).onchange = run(async () => {
    state[side] = el(side).value; save();
    await Promise.all([checkPair(), loadSaved()]);
  }, el('pair-error'));
  el('pair-form').onsubmit = event => { event.preventDefault(); confirmPair(); };
  el('change-pair').onclick = showForm;
  /* ---------- Step 2: workbook, prompt, upload ---------- */
  el('auto').onclick = () => {
    el('auto').classList.add('active'); el('manual').classList.remove('active');
    el('manual').setAttribute('aria-expanded', 'false'); el('manual-import').hidden = true;
    el('auto-message').textContent = t('自动比对接口暂未接通，不会发送任何原文。请使用手动比对。', 'Automatic comparison is not connected and sends nothing. Use manual comparison.');
  };
  el('manual').onclick = () => {
    el('manual').classList.add('active'); el('auto').classList.remove('active');
    el('manual').setAttribute('aria-expanded', 'true'); el('manual-import').hidden = false;
    el('auto-message').textContent = '';
  };
  fetch(`/static/draft-comparison-prompt.txt?v=${App.version}`).then(response => {
    if (!response.ok) throw new Error(t('提示词读取失败', 'Failed to load the prompt'));
    return response.text();
  }).then(text => { el('prompt').value = text.trim(); }).catch(error => { el('prompt').value = ''; el('prompt-message').textContent = error.message; });
  el('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(el('prompt').value); el('prompt-message').textContent = t('提示词已复制，可以粘贴到 Web 端大模型。', 'Prompt copied. Paste it into the web LLM.'); }
    catch { el('prompt').select(); el('prompt-message').textContent = t('浏览器未允许自动复制，已选中提示词，请按 Ctrl+C。', 'The browser blocked copying. The prompt is selected; press Ctrl+C.'); }
  };
  function resetUpload() {
    preview = null; el('file').value = ''; el('preview').hidden = true; el('upload-message').textContent = '';
  }
  function uploadForm(file) {
    const data = new FormData();
    data.append('file', file); data.append('before_draft_id', state.before); data.append('after_draft_id', state.after);
    return data;
  }
  function stats(rows) {
    const stat = (k, count, label) => `<span class="cmp-stat${k ? ` cls-${k}` : ''}"><b>${count}</b><span>${label}</span></span>`;
    return stat('', rows.length, t('全部对应','All rows')) +
      Object.keys(classes).map(k => stat(k, rows.filter(r => r.revision_class === k).length, say(classes[k]))).join('');
  }
  el('file').onchange = run(async () => {
    preview = null; el('preview').hidden = true;
    const file = el('file').files[0];
    if (!file) return;
    el('file').disabled = true;
    el('upload-message').textContent = t('正在检查文件…', 'Checking the file…');
    try {
      const data = await api('/api/comparisons/preview', {method:'POST', body:uploadForm(file)});
      if (file !== el('file').files[0]) return;
      preview = file;
      el('preview-counts').innerHTML = stats(data.rows);
      el('preview-rows').innerHTML = data.rows.map(r => `<tr><td>${esc(r.row_key)}</td>
        <td>${esc(JSON.parse(r.before_nos).join('; ') || '∅')} → ${esc(JSON.parse(r.after_nos).join('; ') || '∅')}</td>
        <td><span class="tag ${classTag[r.revision_class]}">${esc(say(classes[r.revision_class]))}</span></td>
        <td>${esc(r[`summary_${language}`])}</td></tr>`).join('');
      el('preview').hidden = false;
      el('upload-message').textContent = t(`检查通过：${data.row_count} 项对应，两版条款均已完整覆盖。请核对后确认导入。`, `Checks passed: ${data.row_count} rows cover every clause of both drafts. Review, then confirm.`);
    } finally { el('file').disabled = false; }
  }, el('upload-message'));
  el('import').onclick = run(async () => {
    el('import').disabled = true;
    try {
      const saved = await api('/api/comparisons/import', {method:'POST', body:uploadForm(preview)});
      location.href = resultUrl(saved.id);
    } catch (error) { el('import').disabled = false; throw error; }
  }, el('upload-message'));

  /* ---------- Startup ---------- */
  document.querySelectorAll('[data-bs-target="#tab-drafts"], [data-bs-target="#tab-compare"]').forEach(button => {
    button.addEventListener('shown.bs.tab', () => { state.tab = button.dataset.bsTarget; save(); });
  });
  if (state.tab === '#tab-compare' || location.hash === '#compare') bootstrap.Tab.getOrCreateInstance(document.querySelector('[data-bs-target="#tab-compare"]')).show();
  await run(async () => {
    await loadDrafts();
    if (state.confirmed && pair && !pair.comparison_id) confirmPair(); else showForm();
  }, el('pair-error'))();
});
