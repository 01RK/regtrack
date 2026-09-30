# 前端依赖存放目录

本目录用于存放 Bootstrap 与 Tom Select 的静态文件，系统不走 CDN，下载一次后完全离线可用。

在项目根目录执行（需联网，只需一次）：

```
python codes/fetch_vendor.py
```

如果所在网络访问不了 jsDelivr，手工下载下面 4 个文件、**按同名**放进本目录，效果完全相同：

| 文件名 | 下载地址 |
| --- | --- |
| `bootstrap.min.css` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css |
| `bootstrap.bundle.min.js` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js |
| `tom-select.bootstrap5.min.css` | https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/css/tom-select.bootstrap5.min.css |
| `tom-select.complete.min.js` | https://cdn.jsdelivr.net/npm/tom-select@2.3.1/dist/js/tom-select.complete.min.js |

缺这些文件时系统仍能启动，但页面样式和可搜索下拉框不会正常显示。
