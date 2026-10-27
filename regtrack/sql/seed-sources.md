# 初始化数据说明

`sql/seed.sql` 用于初始化数据库（`init_db.py` 不加 `--empty` 时灌入），`sql/seed-files/` 是其中草案附图的文件，建库时复制进附件文件夹。

标准编号与名称取自公开目录。各标准的当前阶段、阶段历史、草案版本与内部工作记录按团队日常业务流程编写，用于覆盖生命周期各阶段的操作，不代表这些标准的实际制定进度。

## 内容

| 标准编号 | 标准名称 |
| --- | --- |
| GB/T 38834.1-2020 | 机器人 服务机器人性能规范及其试验方法 第1部分：轮式机器人运动 |
| GB/T 47494-2026 | 物流机器人 电气安全要求 |
| GB/T 47495-2026 | 物流机器人 电气安全测试方法 |
| GB/T 45271-2026 | 人形机器人 通用安全要求 |
| GB/T 45288-2026 | 移动机器人 导航与定位性能试验方法 |
| GB/T 45306-2026 | 工业移动机器人 无线通信可靠性技术要求 |

- 草案 15（GB/T 47494-2026 发布稿 1.0）导入了两章正文；第 2 章附图 1 张，即“保护连接检查点示意”，文件为 `seed-files/drafts/15/protective-connection-checkpoints.png`。数据库只记录相对路径 `drafts/15/protective-connection-checkpoints.png`。
- 草案 122、123（GB/T 45271-2026 讨论稿 1.2、征求意见稿 2.0）各导入一份正文，并建有一组标准比对（7 条修订条目、1 条比对意见）。

## 数据规模

| 表 | 行数 |
| --- | --- |
| lookup_value | 57 |
| standard | 6 |
| standard_impact_area | 12 |
| standard_stage_history | 37 |
| draft | 23 |
| draft_import | 3 |
| draft_chapter | 17 |
| draft_chapter_image | 1 |
| draft_annotation | 6 |
| meeting | 4 |
| meeting_standard | 7 |
| action_item | 15 |
| action_status_history | 27 |
| feedback_recipient | 12 |
| recipient_status_history | 19 |
| comment | 16 |
| comment_status_history | 23 |
| draft_comparison | 1 |
| comparison_change | 7 |
| comparison_opinion | 1 |

## v23 消息中心样例

新增 1 条模拟立项候选和 1 条未读消息，计划号 `DEMO-2026-001`。名称与正文明确标注演示，不声称是网站真实立项；确认前不创建标准主档，原有 6 项标准和业务记录数量不变。
