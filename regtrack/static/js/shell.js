(() => {
  const root = document.documentElement;
  const key = "regtrack.sidebar-collapsed";
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
      const label = collapsed ? "展开导航" : "收起导航";
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    button.addEventListener("click", () => {
      const collapsed = root.classList.toggle("sidebar-collapsed");
      try { localStorage.setItem(key, String(collapsed)); } catch { }
      render();
    });
    render();
  });
})();
