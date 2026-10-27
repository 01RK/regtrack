// Keep the current section in the URL, including language reloads and deep links.
(() => {
  const tabs = [...document.querySelectorAll('[data-setting-tab]')];
  const sections = [...document.querySelectorAll('[data-setting-section]')];
  function select(key) {
    const selected = tabs.find(tab => tab.dataset.settingTab === key) || tabs.find(tab => tab.dataset.settingTab === 'transfer');
    const active = selected.dataset.settingTab;
    tabs.forEach(tab => {
      tab.classList.toggle('active',tab === selected);
      tab.setAttribute('aria-pressed',String(tab === selected));
    });
    sections.forEach(section => { section.classList.toggle('active',section.dataset.settingSection === active); });
    history.replaceState(history.state,'',`#${active}`);
  }
  tabs.forEach(tab => tab.addEventListener('click',() => select(tab.dataset.settingTab)));
  window.addEventListener('hashchange',() => select(location.hash.slice(1)));
  select(location.hash.slice(1));
})();
