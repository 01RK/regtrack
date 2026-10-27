App.ready(async () => {
  const button = document.getElementById('notification-badge');
  const badge = button.querySelector('[data-count]');
  async function refresh() {
    try {
      const data = await App.get('/api/tracking/summary');
      badge.hidden = data.attention === 0;
      badge.textContent = data.attention;
      button.classList.remove('notification-unavailable');
      const label = App.t(`消息中心，${data.attention} 条需要关注，${data.pending} 条待确认`, `Notifications, ${data.attention} need attention, ${data.pending} need review`);
      button.title = label;
      button.setAttribute('aria-label', label);
    } catch (error) {
      badge.hidden = true;
      button.classList.add('notification-unavailable');
      button.title = App.t('消息暂时无法读取：', 'Notifications unavailable: ') + error.message;
    }
  }
  App.refreshNotifications = refresh;
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
});
