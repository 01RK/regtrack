/* 桌面保留表格/标准行，手机显示字段标签；滚动控件与原生滚动条共用位置。 */
(() => {
  function scrollView(content) {
    if (!content.classList.contains('responsive-content')) {
      const shell = document.createElement('div');
      shell.className = 'record-table-shell';
      const tools = document.createElement('div');
      tools.className = 'record-scroll-tools';
      tools.hidden = true;
      tools.innerHTML = `<span>${App.uiText('左右滚动可查看全部内容', 'Scroll horizontally to view all content')}</span>
        <button type="button" class="record-scroll-button" data-scroll-left aria-label="${App.t('向左滚动', 'Scroll left')}">←</button>
        <button type="button" class="record-scroll-button" data-scroll-right aria-label="${App.t('向右滚动', 'Scroll right')}">→</button>`;
      const viewport = document.createElement('div');
      viewport.className = 'record-table-viewport';
      viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', App.t('数据内容，可左右滚动', 'Data content, scroll horizontally'));
      content.before(shell);
      shell.append(tools, viewport);
      viewport.appendChild(content);
      content.classList.add('responsive-content');
      if (content.matches('.table')) {
        content.classList.add('responsive-table');
        content.setAttribute('role', 'table');
      }
      tools.querySelector('[data-scroll-left]').onclick = () => viewport.scrollBy({left:-viewport.clientWidth * .7, behavior:'smooth'});
      tools.querySelector('[data-scroll-right]').onclick = () => viewport.scrollBy({left:viewport.clientWidth * .7, behavior:'smooth'});
      viewport.addEventListener('scroll', () => updateScroll(viewport), {passive:true});
    }
    return content.parentElement;
  }

  function updateScroll(viewport) {
    const tools = viewport.previousElementSibling;
    const overflow = viewport.scrollWidth > viewport.clientWidth + 1;
    if (tools.hidden !== !overflow) tools.hidden = !overflow;
    viewport.tabIndex = overflow ? 0 : -1;
    tools.querySelector('[data-scroll-left]').disabled = viewport.scrollLeft <= 0;
    tools.querySelector('[data-scroll-right]').disabled = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
  }

  function prepare() {
    document.querySelectorAll('.table, .meeting-standard-list').forEach(content => {
      if (content.matches('.table') && !content.tHead) return;
      const viewport = scrollView(content);
      if (content.matches('.table')) {
        const headers = [...content.tHead.rows[0].cells].map(th => {
          const clone = th.cloneNode(true);
          clone.querySelectorAll('.cn-sub, [aria-hidden="true"]').forEach(node => node.remove());
          return {text:clone.textContent.trim(), markup:th.innerHTML.trim() || App.label('Operations', '操作')};
        });
        [...content.tBodies].forEach(body => [...body.rows].forEach(row => {
          [...row.cells].forEach((cell, index) => {
            if (cell.colSpan !== 1) return;
            const header = headers[index];
            cell.dataset.label = header.text;
            if (!cell.querySelector(':scope > .responsive-field-label')) {
              const label = document.createElement('div');
              label.className = 'responsive-field-label';
              label.setAttribute('aria-hidden', 'true');
              label.innerHTML = header.markup;
              cell.prepend(label);
            }
          });
        }));
      }
      updateScroll(viewport);
    });
  }
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; prepare(); });
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.querySelector('.content'), {childList:true, subtree:true, attributes:true, attributeFilter:['class', 'hidden']});
  observer.observe(document.getElementById('modal-host'), {childList:true, subtree:true, attributes:true, attributeFilter:['class', 'hidden']});
  observer.observe(document.documentElement, {attributes:true, attributeFilter:['class']});
  window.addEventListener('resize', schedule);
  document.addEventListener('shown.bs.modal', schedule);
  document.addEventListener('shown.bs.tab', schedule);
  prepare();
})();
