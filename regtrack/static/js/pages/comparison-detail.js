/* Comparison result page, laid out like the single-draft reader: revision-class tabs, contents on the left,
   one comparison row at a time on the right (analysis, marked source text, annotations). */
App.ready(async () => {
  const {esc, t, get, put, post, del, openModal, confirmAsync, ok} = App;
  const el = id => document.getElementById(`cmp-${id}`);
  const id = Number(el('page').dataset.id);
  const key = `regtrack.comparison-detail.v21-fix5:${id}`;
  const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
  const state = Object.assign({language:localStorage.getItem('regtrack.reader.language') === 'en' ? 'en' : 'cn',
    filter:null, query:'', toc:'after', active:null}, saved);
  const save = () => sessionStorage.setItem(key, JSON.stringify(state));
  const classes = {Substantive:['实质修订','Substantive'], Editorial:['编辑性修订','Editorial'], Uncertain:['待核实','Uncertain'], Unchanged:['未变更','Unchanged']};
  const kinds = {Unchanged:['未变更','Unchanged'], Added:['新增','Added'], Deleted:['删除','Deleted'], Modified:['修改','Modified'], Moved:['移位 / 编号调整','Moved / renumbered'], Split:['拆分','Split'], Merged:['合并','Merged'], Reorganized:['多对多重组','Reorganized']};
  const say = pair => t(...pair);
  const version = d => `${d.version_name} v${d.sub_version_no}`;
  let result, editing = false, backUrl = '/drafts#compare';

  /* ---------- Source text with revision marks ---------- */
  function pick(c, field) {
    const other = state.language === 'cn' ? 'en' : 'cn';
    return c[`${field}_${state.language}`] || c[`${field}_${other}`] || '';
  }
  function revisionMarks(change) {
    const both = (name, options) => RevisionDiff.mark(change.before_chapters.map(c => name(c)), change.after_chapters.map(c => name(c)), options);
    return {
      titles: both(c => pick(c, 'title'), {markdown:false, escape:esc}),
      content: both(c => pick(c, 'content'), {markdown:true}),
      illustrations: both(c => c.illustration || '', {markdown:true}),
    };
  }
  const formulas = [];
  function rich(markdown) {
    const rendered = RichText.render(markdown, {breaks: false});
    return `<div class="rich-content cmp-rich" data-formulas="${formulas.push(rendered.formulas) - 1}">${rendered.html}</div>`;
  }
  function source(change, side, marks) {
    const draft = result[side], chapters = change[`${side}_chapters`];
    const head = `<header><b>${side === 'before' ? t('前版','Before') : t('后版','After')}</b>${esc(version(draft))} · ${esc(draft.draft_date)}</header>`;
    if (!chapters.length) return `<section class="cmp-source is-empty">${head}<p>${side === 'before' ? t('前版无对应条款（新增）','No clause in the before draft (added)') : t('后版无对应条款（删除）','No clause in the after draft (deleted)')}</p></section>`;
    return `<section class="cmp-source">${head}` + chapters.map((c, i) => {
      const missing = !c[`content_${state.language}`] && c[`content_${state.language === 'cn' ? 'en' : 'cn'}`];
      return `<div class="cmp-clause">
        <h3><b>${esc(c.clause_no)}</b> ${marks.titles[side][i]}${c.source_page ? `<small>${t('来源页','Page')} ${esc(c.source_page)}</small>` : ''}</h3>
        ${missing ? `<p class="cmp-fallback">${state.language === 'cn' ? t('未提供中文原文，以下为英文原文。','No Chinese text; English shown.') : t('未提供英文原文，以下为中文原文。','No English text; Chinese shown.')}</p>` : ''}
        ${marks.content[side][i] ? rich(marks.content[side][i]) : `<p class="cmp-muted">${t('（本节无正文）','(No body text)')}</p>`}
        ${c.illustration ? `<div class="cmp-illustration">${rich(marks.illustrations[side][i])}</div>` : ''}
        ${c.images.length ? `<div class="illustration-grid">${c.images.map((image, n) => `<button type="button" class="illustration-thumb" data-image="${esc(image.url)}" data-caption="${esc(`${c.clause_no} ${c.illustration || ''}`.trim())}" aria-label="${t('放大查看附图','Enlarge illustration')} ${n + 1}"><img src="${esc(image.url)}" alt="${esc(c.clause_no)} ${t('附图','figure')} ${n + 1}" loading="lazy"><span>${t('点击放大','Click to enlarge')}</span></button>`).join('')}</div>` : ''}
      </div>`;
    }).join('') + '</section>';
  }

  /* ---------- Analysis: view and manual review ---------- */
  function analysis(c) {
    const lang = state.language;
    return `<section class="cmp-analysis">
      <div class="cmp-section-head"><h3>${t('修订分析','Analysis')}</h3><button type="button" class="btn btn-outline-secondary btn-sm" data-edit>${t('编辑','Edit')}</button></div>
      <div class="cmp-analysis-grid">
        <div><h4>${t('修订说明','Change summary')}</h4><p>${esc(c[`summary_${lang}`])}</p></div>
        <div><h4>${t('判定依据','Rationale')}</h4><p>${esc(c[`reason_${lang}`])}</p></div>
      </div>
      ${c.review_note ? `<div class="cmp-review"><h4>${t('人工核实','To verify')}</h4><p>${esc(c.review_note)}</p></div>` : ''}
    </section>`;
  }
  function editor(c) {
    const option = k => `<label class="cmp-class-option cls-${k}">
      <input type="radio" name="revision_class" value="${k}" ${c.revision_class === k ? 'checked' : ''}><span>${esc(say(classes[k]))}</span></label>`;
    const area = (name, label) => `<label class="cmp-field"><span>${label}</span><textarea class="form-control" name="${name}" rows="3">${esc(c[name])}</textarea></label>`;
    return `<form class="cmp-analysis cmp-edit" data-form>
      <div class="cmp-section-head"><h3>${t('编辑修订分析','Edit analysis')}</h3></div>
      <fieldset class="cmp-class-pick"><legend>${t('修订性质','Revision class')}</legend>${Object.keys(classes).map(option).join('')}</fieldset>
      <p class="cmp-edit-hint" data-hint></p>
      <div class="cmp-edit-grid">
        ${area('summary_cn','修订说明（中文）')}${area('summary_en','Change summary (English)')}
        ${area('reason_cn','判定依据（中文）')}${area('reason_en','Rationale (English)')}
      </div>
      <label class="cmp-field cmp-edit-review" data-review><span>${t('人工核实事项（可选）','Items to verify (optional)')}</span><textarea class="form-control" name="review_note" rows="2">${esc(c.review_note)}</textarea></label>
      <div class="cmp-edit-actions"><span class="text-danger" data-error role="alert"></span>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-cancel>${t('取消','Cancel')}</button><button type="submit" class="btn btn-primary btn-sm">${t('保存','Save')}</button></div>
    </form>`;
  }
  function syncEditor(form, c) {
    form.querySelector('[data-review]').hidden = false;
    form.review_note.required = false;
    form.querySelector('[data-hint]').textContent = '';
  }
  async function submitEdit(form, c) {
    const cls = form.revision_class.value;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const body = Object.fromEntries(['summary_cn','summary_en','reason_cn','reason_en','review_note'].map(k => [k, form[k].value]));
      Object.assign(c, await put(`/api/comparisons/changes/${c.id}`, {...body, revision_class:cls}));
      editing = false;
      render({keepScroll:true});
      ok(t('修订分析已保存','Analysis saved'));
    } catch (error) { form.querySelector('[data-error]').textContent = error.message; }
    finally { button.disabled = false; }
  }

  /* ---------- Annotations ---------- */
  function opinions(c) {
    return `<section class="cmp-opinions">
      <div class="cmp-section-head"><h3>${t('比对批注','Annotations')} <small>${c.opinions.length || ''}</small></h3>
        <button type="button" class="btn btn-outline-primary btn-sm" data-annotate>${t('添加批注','Add annotation')}</button></div>
      ${c.opinions.map(o => `<div class="cmp-opinion"><div class="cmp-opinion-meta"><span class="tag">${esc(o.comment_type)}</span><span>${esc(o.status)} · ${esc(o.submitted_by)} · ${esc(o.submission_date)}</span>
        <button type="button" class="btn btn-link btn-sm" data-opinion="${o.id}">${t('查看 / 编辑','View / edit')}</button></div><p>${esc(o.comment_text)}</p></div>`).join('')
        || `<p class="cmp-muted">${t('此条目还没有批注。','No annotations on this row yet.')}</p>`}
    </section>`;
  }
  function annotate(changeId) {
    const m = openModal({title:t('添加比对批注','Add comparison annotation'), size:'lg',
      body:`<label class="form-label">${t('批注类型','Annotation type')}</label><select class="form-select" data-type>${App.meta.annotation_types.map(v => `<option>${esc(v)}</option>`).join('')}</select>
        <label class="form-label mt-3">${t('批注内容','Annotation content')}</label><textarea class="form-control" rows="5" data-content></textarea>
        <span class="follow-up-field mt-3"><label class="follow-up-toggle"><input class="form-check-input" type="checkbox" data-follow checked><span>${t('需要跟进（进入已提交状态）','Follow-up required (Submitted status)')}</span></label>${App.followUpInfo()}</span>
        <p class="text-danger mt-2" data-error role="alert"></p>`,
      footer:`<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${t('取消','Cancel')}</button><button type="button" class="btn btn-primary" data-save>${t('保存并进入意见矩阵','Save to Comment Matrix')}</button>`});
    m.el.querySelector('[data-type]').value = 'Proposed Change';
    m.el.querySelector('[data-save]').onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        await post(`/api/comparisons/changes/${changeId}/opinions`, {annotation_type:m.el.querySelector('[data-type]').value,
          content:m.el.querySelector('[data-content]').value, needs_follow_up:m.el.querySelector('[data-follow]').checked});
        await m.close(); await load({keepScroll:true});
      } catch (error) { m.el.querySelector('[data-error]').textContent = error.message; }
      finally { button.disabled = false; }
    };
  }

  /* ---------- Rows shown under the current class tab and search ---------- */
  function visibleRows() {
    const query = state.query.trim().toLowerCase();
    return result.changes.filter(c => (!state.filter || c.revision_class === state.filter) &&
      (!query || JSON.stringify([c.before_nos, c.after_nos, c.before_chapters, c.after_chapters, c.summary_cn, c.summary_en, c.reason_cn, c.reason_en, c.review_note, c.opinions]).toLowerCase().includes(query)));
  }
  // One entry per row, placed at its first clause in the chosen version. Rows without a clause in that
  // version (added / deleted) sit right after the preceding row.
  function contents(rows) {
    const side = state.toc, other = side === 'before' ? 'after' : 'before';
    const shown = new Set(rows.map(c => c.id));
    let anchor = 0;
    return result.changes.map(c => {
      const own = c[`${side}_chapters`][0];
      if (own) anchor = own.sequence;
      return {c, own, sort:own ? own.sequence : anchor + 0.5, first:own || c[`${other}_chapters`][0]};
    }).sort((x, y) => x.sort - y.sort || x.c.sequence - y.c.sequence).filter(e => shown.has(e.c.id));
  }
  const active = () => result.changes.find(c => c.id === state.active);
  const rowTitle = (c, first) => `${first.clause_no} ${pick(first, 'title')}`.trim();

  /* ---------- Render ---------- */
  function renderTabs() {
    const tab = (k, count, text) => `<button type="button" role="tab" class="${state.filter === k ? 'active' : ''}" aria-selected="${state.filter === k}" data-filter="${k}">${k ? `<i class="cmp-dot cls-${k}"></i>` : ''}${text}<span>${count}</span></button>`;
    el('classes').innerHTML = Object.keys(classes).map(k => tab(k, result.changes.filter(r => r.revision_class === k).length, say(classes[k]))).join('')
      + tab('', result.changes.length, t('全部对应','All rows'));
  }
  function renderToc(entries) {
    el('toc').innerHTML = entries.map(({c, own, first}) => {
      const extra = c[`${state.toc}_chapters`].length - 1;
      return `<button type="button" class="cmp-entry cls-${c.revision_class}${own ? '' : ' absent'}${c.id === state.active ? ' active' : ''}" data-goto="${c.id}" aria-current="${c.id === state.active}" style="padding-left:${8 + Math.min(first.level - 1, 6) * 14}px">
        <i class="cmp-dot" aria-hidden="true"></i><span>${own ? '' : `<em>${state.toc === 'before' ? t('新增','Added') : t('删除','Deleted')}</em> `}${esc(rowTitle(c, first))}${extra > 0 ? ` <small>+${extra}</small>` : ''}</span></button>`;
    }).join('') || `<p class="cmp-muted p-3">${t('没有符合条件的条目','No matching rows')}</p>`;
  }
  function renderPaper(entries, keepScroll) {
    const paper = el('paper'), scroll = paper.scrollTop;
    const index = entries.findIndex(e => e.c.id === state.active);
    el('position').textContent = entries.length ? `${index + 1} / ${entries.length}` : '0 / 0';
    document.querySelector('[data-step="-1"]').disabled = index <= 0;
    document.querySelector('[data-step="1"]').disabled = index < 0 || index >= entries.length - 1;
    if (index < 0) { paper.innerHTML = `<p class="cmp-empty">${t('当前分类下没有条目。','No rows in this view.')}</p>`; return; }
    const {c, first} = entries[index];
    const marks = revisionMarks(c);
    formulas.length = 0;
    paper.innerHTML = `<div class="cmp-row-meta">${esc(c.row_key)} · ${esc(say(kinds[c.change_type]))}</div>
      <h2>${esc(rowTitle(c, first))}</h2>
      <div class="cmp-row-tags"><span class="cmp-badge cls-${c.revision_class}">${esc(say(classes[c.revision_class]))}</span>
        <span class="cmp-map">${t('前版','Before')} <b>${esc(c.before_nos.join('; ') || '—')}</b> → ${t('后版','After')} <b>${esc(c.after_nos.join('; ') || '—')}</b></span></div>
      ${editing ? editor(c) : analysis(c)}
      <div class="cmp-source-pair">${source(c, 'before', marks)}${source(c, 'after', marks)}</div>
      ${opinions(c)}`;
    paper.querySelectorAll('[data-formulas]').forEach(node => RichText.mount(node, formulas[Number(node.dataset.formulas)]));
    const form = paper.querySelector('[data-form]');
    if (form) {
      syncEditor(form, c);
      form.onchange = () => syncEditor(form, c);
      form.onsubmit = event => { event.preventDefault(); submitEdit(form, c); };
      form.querySelector('[data-cancel]').onclick = () => { editing = false; render({keepScroll:true}); };
    }
    paper.scrollTop = keepScroll ? scroll : 0;
  }
  function render({keepScroll = false} = {}) {
    document.querySelectorAll('[data-language]').forEach(b => { b.classList.toggle('active', b.dataset.language === state.language); b.setAttribute('aria-pressed', String(b.dataset.language === state.language)); });
    document.querySelectorAll('[data-toc]').forEach(b => b.classList.toggle('active', b.dataset.toc === state.toc));
    el('search').value = state.query;
    const entries = contents(visibleRows());
    if (!entries.some(e => e.c.id === state.active)) { state.active = entries[0]?.c.id ?? null; editing = false; keepScroll = false; }
    save();
    renderTabs();
    renderToc(entries);
    renderPaper(entries, keepScroll);
    el('toc').querySelector('.active')?.scrollIntoView({block:'nearest'});
  }
  function select(changeId) {
    if (changeId === state.active) return;
    state.active = changeId; editing = false;
    render();
  }
  async function load({keepScroll = false} = {}) {
    result = await get(`/api/comparisons/${id}`);
    // “Back” reopens the comparison tab on this draft pair.
    backUrl = `/drafts?${new URLSearchParams({standard:result.standard_id, before:result.before_draft_id, after:result.after_draft_id})}#compare`;
    document.querySelector('.draft-back').href = backUrl;
    el('heading').textContent = `${version(result.before)} → ${version(result.after)}`;
    document.title = `${result.standard.std_no || ''} ${t('比对结果','Comparison')} · ${t('法规跟踪系统','Regulation Tracking')}`;
    el('context').innerHTML = `<b>${esc(result.standard.std_no || '')}</b> ${esc(App.lang === 'en' ? (result.standard.name_en || result.standard.name_cn) : result.standard.name_cn)}
      <span>${t('前版','Before')} ${esc(version(result.before))} · ${esc(result.before.draft_date)}</span><span>${t('后版','After')} ${esc(version(result.after))} · ${esc(result.after.draft_date)}</span>
      <span>${t('导入','Imported')} ${esc(result.created_by)} · ${esc(result.created_at.slice(0, 10))}</span>`;
    // First visit opens on substantive revisions.
    if (state.filter === null) state.filter = 'Substantive';
    render({keepScroll});
  }

  /* ---------- Events ---------- */
  el('paper').addEventListener('click', event => {
    const target = event.target;
    if (target.closest('[data-edit]')) { editing = true; render({keepScroll:true}); el('paper').querySelector('[data-form] input:checked')?.focus(); return; }
    if (target.closest('[data-annotate]')) { annotate(state.active); return; }
    const opinion = target.closest('[data-opinion]');
    if (opinion) { Records.open('comment', Number(opinion.dataset.opinion), {onChanged:() => load({keepScroll:true})}); return; }
    const image = target.closest('[data-image]');
    if (image) {
      const large = document.getElementById('illustration-large');
      large.src = image.dataset.image;
      large.alt = image.dataset.caption;
      document.getElementById('illustration-caption').textContent = image.dataset.caption;
      viewer.showModal();
    }
  });
  const viewer = document.getElementById('illustration-viewer');
  document.getElementById('close-illustration').onclick = () => viewer.close();
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
  el('toc').addEventListener('click', event => {
    const entry = event.target.closest('[data-goto]');
    if (entry) select(Number(entry.dataset.goto));
  });
  document.querySelectorAll('[data-step]').forEach(button => button.onclick = () => {
    const entries = contents(visibleRows());
    select(entries[entries.findIndex(e => e.c.id === state.active) + Number(button.dataset.step)].c.id);
  });
  el('classes').addEventListener('click', event => {
    const tab = event.target.closest('[data-filter]');
    if (tab) { state.filter = tab.dataset.filter; render(); }
  });
  document.querySelectorAll('[data-toc]').forEach(b => b.onclick = () => { state.toc = b.dataset.toc; render({keepScroll:true}); });
  document.querySelectorAll('[data-language]').forEach(b => b.onclick = () => {
    state.language = b.dataset.language;
    localStorage.setItem('regtrack.reader.language', state.language);
    render({keepScroll:true});
  });
  el('search').addEventListener('input', () => { state.query = el('search').value; render({keepScroll:true}); });
  el('delete').onclick = async () => {
    if (!await confirmAsync(t('删除此比对结果？原文章节不会删除；存在批注时会阻止删除。','Delete this comparison? Source chapters remain. Linked annotations prevent deletion.'))) return;
    try {
      await del(`/api/comparisons/${id}`);
      sessionStorage.removeItem(key);
      location.replace(backUrl);
    } catch (error) { App.fail(error.message); }
  };

  try {
    // Links from the Comment Matrix open one row: show it under its own class tab.
    const linked = Number(new URLSearchParams(location.search).get('change'));
    await load();
    const c = result.changes.find(x => x.id === linked);
    if (c) { Object.assign(state, {filter:c.revision_class, query:'', active:c.id}); render(); }
    await Records.restore({onChanged:() => load({keepScroll:true})});
  } catch (error) { el('error').textContent = error.message; el('delete').disabled = true; }
});
