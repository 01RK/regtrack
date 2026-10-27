# RegTrack 云服务器应用

请阅读项目根目录 README.md，以及 docs/DEPLOYMENT_ZH.md。

唯一服务入口：`python codes/run.py`。数据库与对象存储配置从服务端环境变量读取，浏览器不接触连接凭据。资源位于 static/、templates/、sql/；业务代码位于 codes/。
