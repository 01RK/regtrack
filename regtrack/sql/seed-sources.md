# 初始化数据与场景说明

`seed.sql` 保留 4 次工作组会议及其关联的 6 项标准、草案、意见和事项。
阶段进度、草案正文、内部会议和处理记录均为产品演示场景，不代表真实制定进度。
新增的三项标准主档也仅用于模拟展示，编号与名称未在本轮核验。

## 标准主档

| 标准编号 | 当前阶段 | 原有来源或场景 |
| --- | --- | --- |
| GB/T 38834.1-2020 | 复审 | [原有公开详情](https://www.ndls.org.cn/standard/detail/996d298d8b578c3401442c2c53be0fd8) |
| GB/T 47494-2026 | 发布 | [原有公开详情](https://www.ndls.org.cn/standard/detail/7ffca9bc56da834d795edfeeb130aba1) |
| GB/T 47495-2026 | 报批 | [原有公开详情](https://www.ndls.org.cn/standard/detail/46acaec58efe6d9600f5271e761dfbf6) |
| GB/T 45271-2026 | 征求意见 | 模拟标准主档 |
| GB/T 45288-2026 | 审查 | 模拟标准主档 |
| GB/T 45306-2026 | 报批 | 模拟标准主档 |

## 数据规模

以下数量按当前 `schema.sql` 与 `seed.sql` 初始化后的数据库统计：

- lookup_value：56 条
- standard：6 条
- standard_impact_area：12 条
- standard_stage_history：37 条
- draft：23 条
- draft_import：1 条
- draft_chapter：2 条
- draft_annotation：6 条
- meeting：4 条
- meeting_standard：7 条
- action_item：15 条
- action_status_history：29 条
- feedback_recipient：9 条
- recipient_status_history：15 条
- comment：15 条
- comment_status_history：22 条

首次启动只创建空库；需要演示数据时，显式运行 `codes/init_db.py`。
