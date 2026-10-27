App.ready(async () => {
  const {get, post, esc, t, fail, ok} = App;
  const host = document.getElementById('inbox-list');
  let page = 1, view = '', busy = false;
  const labels = {plans:t('计划下达','Project plans'), comments:t('征求意见更新','Consultation updates'), releases:t('标准公告更新','Release updates'), error:t('采集异常','Collection issue')};
  function card(row) {
    const pending = row.decision === 'pending';
    const state = pending ? t('待确认追踪','Review plan') : !row.is_read ? t('待知悉','Acknowledge') : row.decision === 'ignored' ? t('本次已忽略','Skipped') : t('已处理','Handled');
    const progress = row.target_stage ? `${esc(App.stageLabel(row.previous_stage))} <span aria-hidden="true">→</span> ${esc(App.stageLabel(row.target_stage))}` : pending ? t('确认后按立项建档','Confirm to create a Project Approval profile') : '';
    return `<article class="inbox-row${!row.is_read ? ' is-active' : ''}" data-message="${row.id}">
      <div class="inbox-row-main">
        <div class="inbox-row-heading"><span class="inbox-category kind-${esc(row.kind)}">${esc(labels[row.kind])}</span><h3>${esc(row.title)}</h3><span class="inbox-state${!row.is_read ? ' needs-review' : ''}">${state}</span></div>
        <div class="inbox-row-detail">${row.source_number ? `<span>${esc(row.source_number)}</span>` : ''}${row.published_date ? `<span>${t('通知发布','Notice published')} ${esc(row.published_date)}</span>` : ''}${progress ? `<span class="inbox-progress">${progress}</span>` : ''}${row.acknowledged_by ? `<span>${esc(row.acknowledged_by)} · ${row.decision === 'ignored' ? t('本次忽略','Skipped') : t('已处理','Handled')}</span>` : ''}</div>
        ${row.kind === 'error' ? `<details class="inbox-error"><summary>${t('查看问题','View issue')}</summary><p>${esc(row.body || '')}</p></details>` : ''}
      </div>
      <div class="inbox-row-side">
        <div class="inbox-row-actions">${pending ? `<button class="btn btn-primary btn-sm inbox-action-primary" data-decision="confirmed" data-candidate="${row.candidate_id}">${t('确认追踪','Track plan')}</button><button class="btn btn-outline-secondary btn-sm inbox-action-secondary" data-decision="ignored" data-candidate="${row.candidate_id}">${t('本次忽略','Skip this time')}</button>` : !row.is_read ? `<button class="btn btn-primary btn-sm inbox-action-primary" data-acknowledge="${row.id}">${t('我已知悉','Acknowledge')}</button>` : ''}
          ${row.standard_id ? `<a class="inbox-source inbox-action-secondary" href="/standards?id=${row.standard_id}">${t('标准档案','Profile')} ↗</a>` : ''}
          ${row.source_url ? `<a class="inbox-source inbox-action-source" target="_blank" rel="noopener noreferrer" href="${esc(row.source_url)}">${t('来源详情','Source')} ↗</a>` : ''}
        </div><time datetime="${esc(row.created_at.replace(' ','T'))}">${esc(row.created_at.slice(5,16))}</time>
      </div>
    </article>`;
  }
  async function load() {
    host.setAttribute('aria-busy','true');
    try {
      const data = await get('/api/tracking/notifications', {page, ...(view ? {view} : {})});
      view = data.view; page = data.page;
      document.querySelectorAll('[data-inbox-view]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.inboxView === view)));
      document.querySelectorAll('[data-view-count]').forEach(el => { el.textContent = data.counts[el.dataset.viewCount]; });
      host.innerHTML = data.items.map(card).join('') || `<div class="inbox-empty"><span aria-hidden="true">✓</span><h3>${t('暂无需要处理的动态','Nothing to handle here')}</h3><p>${view === 'all' ? t('发现标准变化后会保存在这里。','Standard changes will appear here.') : t('已处理事项可在全部动态中查看。','Find handled updates in All updates.')}</p></div>`;
      document.getElementById('inbox-page').textContent = `${t('共','Total')} ${data.total} · ${page} / ${Math.max(1,Math.ceil(data.total/20))}`;
      document.getElementById('inbox-prev').disabled = page === 1;
      document.getElementById('inbox-next').disabled = page*20 >= data.total;
      if (App.refreshNotifications) await App.refreshNotifications();
    } finally { host.setAttribute('aria-busy','false'); }
  }
  async function mutate(url, data, message) {
    if (busy) return;
    busy = true;
    host.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await post(url,data); ok(message); await load(); }
    catch(error) { fail(error.message); await load().catch(() => {}); }
    finally { busy = false; }
  }
  host.onclick = event => {
    const decision = event.target.closest('[data-decision]');
    const ack = event.target.closest('[data-acknowledge]');
    if (decision) mutate(`/api/tracking/candidates/${decision.dataset.candidate}/decision`,{decision:decision.dataset.decision},decision.dataset.decision === 'confirmed' ? t('已确认追踪，立项档案已就绪','Tracking confirmed; profile ready') : t('本次已忽略，下次采集发现时再次提醒','Skipped this time; the next discovery will prompt again'));
    if (ack) mutate(`/api/tracking/notifications/${ack.dataset.acknowledge}/acknowledge`,{},t('已知悉，可在全部动态中回看','Acknowledged; view in All updates'));
  };
  const refresh = () => load().catch(error => fail(error.message));
  document.querySelectorAll('[data-inbox-view]').forEach(button => button.onclick = () => { view=button.dataset.inboxView; page=1; refresh(); });
  document.getElementById('inbox-refresh').onclick = refresh;
  document.getElementById('inbox-prev').onclick = () => { page--; refresh(); };
  document.getElementById('inbox-next').onclick = () => { page++; refresh(); };
  await load();
});
