App.ready(async () => {
  const {get, post, put, esc, t, fail, ok} = App;
  const enabled = document.getElementById('collection-enabled');
  const days = document.getElementById('collection-days');
  const recovery = document.getElementById('collection-recovery-enabled');
  const time = document.getElementById('collection-time');
  const lookback = document.getElementById('collection-lookback');
  const rangeText = value => Number(value) === 1 ? t('当天','Today') : t(`近 ${value} 天`,`Last ${value} days`);
  const validDays = input => /^\d+$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 3650;
  const range = new TomSelect(lookback, {
    plugins: ['dropdown_input'], maxItems:1, createOnBlur:true,
    createFilter: validDays,
    create: input => ({value:String(Number(input.trim())), text:rangeText(Number(input.trim()))}),
    render: {
      option_create: (data, escape) => `<div class="create">${t('使用自定义范围：近','Use custom window: last')} <strong>${escape(String(Number(data.input)))}</strong> ${t('天','days')}</div>`,
      no_results: () => `<div class="no-results">${t('请输入 1–3650 的整数天数','Enter a whole number of days, 1–3650')}</div>`
    }
  });
  range.control_input.placeholder = t('自定义天数（1–3650），输入后按 Enter','Custom days (1–3650), then press Enter');
  range.control_input.setAttribute('aria-label',t('自定义通知范围天数','Custom publication window in days'));
  range.control_input.setAttribute('inputmode','numeric');
  const windowDays = () => Number(range.getValue());
  const warning = document.getElementById('collection-window-warning');
  function showWarning() { warning.hidden = !windowDays() || Number(days.value) <= windowDays(); }
  days.addEventListener('input',showWarning);
  range.on('change',showWarning);
  const run = document.getElementById('collection-run');
  const form = document.getElementById('collection-form');
  async function load(fill = false) {
    const data = await get('/api/tracking/settings');
    if (fill) {
      enabled.checked = !!data.enabled; recovery.checked = !!data.recovery_enabled; days.value = data.interval_days; time.value = data.run_time;
      range.addOption({value:String(data.lookback_days),text:rangeText(data.lookback_days)});
      range.setValue(String(data.lookback_days),true); showWarning();
    }
    run.disabled = data.running;
    const lastRun = data.last_run;
    const result = lastRun && ['failed','interrupted'].includes(lastRun.status) ? null : data.last_result;
    const state = data.running ? 'running' : !data.enabled ? 'disabled' : lastRun ? lastRun.status : 'new';
    const states = {
      running:[t('采集中','Collecting'),'info'], disabled:[t('定时已关闭','Schedule off'),'muted'],
      new:[t('尚未运行','Not run yet'),'muted'], succeeded:[t('成功','Succeeded'),'success'],
      partial:[t('部分失败','Partial failure'),'warning'], failed:[t('运行失败','Failed'),'danger'],
      interrupted:[t('任务中断','Interrupted'),'warning']
    };
    const [stateLabel, tone] = states[state];
    const status = document.getElementById('collection-status');
    const expanded = status.querySelector('details')?.open || false;
    const shortTime = value => value ? value.slice(0,16) : '—';
    const pending = data.recovery_enabled && data.recovery_from;
    status.innerHTML = `
      <header class="collection-status-head"><h3>${t('运行概况','Run overview')}</h3><span class="collection-state is-${tone}"><i aria-hidden="true"></i>${stateLabel}</span></header>
      <dl class="collection-metrics">
        <div><dt>${t('下次采集','Next run')}</dt><dd>${esc(data.enabled ? shortTime(data.next_run_at) : t('未安排','Not scheduled'))}</dd></div>
        <div><dt>${t('最近成功','Last success')}</dt><dd>${esc(shortTime(data.last_success_at))}</dd></div>
        <div><dt>${t('最近结果','Last result')}</dt><dd>${result ? `${t('新计划','New plans')} <b>${result.discovered}</b><span class="collection-metric-divider">·</span>${t('更新','Updated')} <b>${result.updated}</b>` : '—'}</dd></div>
      </dl>
      ${pending ? `<p class="collection-recovery-pending">${t('待补采','Recovery pending')}：${esc(data.recovery_from)} → ${t('本次运行日','next run date')}</p>` : ''}
      ${lastRun ? `<details class="collection-run-details"${expanded ? ' open' : ''}><summary>${t('运行详情','Run details')}</summary>
        <dl><div><dt>${lastRun.is_recovery ? t('补采范围','Recovery window') : t('采集范围','Collection window')}</dt><dd>${esc(lastRun.window_start)} → ${esc(lastRun.window_end)}</dd></div><div><dt>${t('开始 / 完成','Started / finished')}</dt><dd>${esc(lastRun.started_at)} / ${esc(lastRun.finished_at || '—')}</dd></div></dl>
        ${result?.errors.length ? `<p class="collection-run-error">${esc(result.errors.join('\n'))}</p>` : ''}
      </details>` : ''}`;
  }
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      await put('/api/tracking/settings', {enabled: enabled.checked, recovery_enabled: recovery.checked, interval_days: Number(days.value), run_time: time.value, lookback_days: windowDays()});
      ok(t('采集设置已保存', 'Schedule saved')); await load(true);
    } catch (error) { fail(error.message); }
  };
  run.onclick = async () => {
    run.disabled = true;
    try { await post('/api/tracking/run', {}); ok(t('采集已开始，结果将在此更新', 'Collection started; results will appear here')); await load(); }
    catch (error) { fail(error.message); run.disabled = false; }
  };
  await load(true);
  setInterval(() => { if (!document.hidden) load().catch(error => fail(error.message)); }, 10000);
});
