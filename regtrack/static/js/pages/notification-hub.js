App.ready(async () => {
  const board = document.getElementById('standard-message-board');
  const status = document.getElementById('standard-board-status');
  async function refresh() {
    try {
      const counts = await App.get('/api/tracking/summary');
      status.textContent = counts.attention ? App.t(`${counts.attention} 条待处理`,`${counts.attention} to handle`) : App.t('暂无待处理','All caught up');
      status.classList.toggle('has-attention',counts.attention > 0);
      board.querySelectorAll('[data-board-count]').forEach(el => { el.textContent = counts[el.dataset.boardCount]; });
    } catch (error) {
      status.textContent = App.t('数量暂时无法读取','Counts unavailable');
      App.fail(error.message);
    } finally { board.setAttribute('aria-busy','false'); }
  }
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); },30000);
});
