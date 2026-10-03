# 前端依赖存放目录

本目录存放 Bootstrap、Tom Select、Marked、DOMPurify、SortableJS 与 KaTeX 的静态文件，系统运行时不走 CDN。

在项目根目录执行（需联网，只需一次）：

```
python codes/fetch_vendor.py
```

如果所在网络访问不了 jsDelivr，可按 `codes/fetch_vendor.py` 中的地址手工下载并按相同路径放入本目录。

| 文件名 | 下载地址 |
| --- | --- |
| `bootstrap.min.css` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css |
| `bootstrap.bundle.min.js` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js |
| `tom-select.bootstrap5.min.css` | https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/css/tom-select.bootstrap5.min.css |
| `tom-select.complete.min.js` | https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/js/tom-select.complete.min.js |
| `marked.umd.js` | https://cdn.jsdelivr.net/npm/marked@15.0.12/lib/marked.umd.js |
| `purify.min.js` | https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js |
| `sortable.min.js` | https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js |
| `katex/katex.min.js`、`katex/katex.min.css`、`katex/fonts/*.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/ |

新增库的许可证原文保存在 [licenses](./licenses/) 中。

缺这些文件时系统仍能启动，但页面样式和可搜索下拉框不会正常显示。
