(() => {
  const root = document.documentElement;
  const key = "regtrack.sidebar-collapsed";
  const english = root.lang === "en";
  // 在页面绘制前恢复布局，避免跨页面时侧栏闪现。
  try {
    root.classList.toggle("sidebar-collapsed", localStorage.getItem(key) === "true");
  } catch { /* 浏览器禁用存储时仍可在当前页切换。 */ }

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("sidebar-toggle");
    const navigation = document.getElementById("main-navigation");
    function render() {
      const collapsed = root.classList.contains("sidebar-collapsed");
      navigation.hidden = collapsed;
      button.setAttribute("aria-expanded", String(!collapsed));
      const label = collapsed
        ? (english ? "Expand navigation" : "展开导航")
        : (english ? "Collapse navigation" : "收起导航");
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    button.addEventListener("click", () => {
      const collapsed = root.classList.toggle("sidebar-collapsed");
      try { localStorage.setItem(key, String(collapsed)); } catch { }
      render();
    });
    render();

    const detailsKey = `regtrack.details:${location.pathname}`;
    const details = [...document.querySelectorAll("details")];
    const savedDetails = JSON.parse(sessionStorage.getItem(detailsKey) || "null");
    if (savedDetails) details.forEach((panel, index) => { panel.open = savedDetails[index]; });
    details.forEach((panel) => panel.addEventListener("toggle", () => {
      sessionStorage.setItem(detailsKey, JSON.stringify(details.map((item) => item.open)));
    }));

    // 界面语言由服务端按 Cookie 渲染，切换后整页重载，页面与弹窗保持同一语言。
    // 重载前保存本页已读取的数据（core.js），重载后直接使用，不再重复读取共享数据库。
    document.querySelectorAll("[data-lang]").forEach((option) => {
      option.addEventListener("click", () => {
        if (option.getAttribute("aria-pressed") === "true") return;
        document.cookie = `regtrack_lang=${option.dataset.lang}; path=/; max-age=31536000; SameSite=Lax`;
        if (window.App) window.App.saveLanguageSnapshot();
        document.documentElement.classList.add("lang-switching");
        location.reload();
      });
    });
  });
})();
