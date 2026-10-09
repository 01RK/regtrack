{#- 标准生命周期回顾 · 知识库导出模板。非 HTML 模板，Flask 不做转义。 -#}
{%- macro kv(label, value) -%}
{%- if value not in (None, "") %}
- **{{ label }}**：{{ value | md_inline }}
{%- endif -%}
{%- endmacro -%}
{%- macro block(label, value) -%}
{%- if value %}

**{{ label }}**

{{ value | md_block }}
{%- endif -%}
{%- endmacro -%}
{%- macro history(rows) -%}
{%- if rows %}

**状态历史**

| 生效日期 | 变更 | 说明 | 记录人 |
| --- | --- | --- | --- |
{%- for h in rows | reverse %}
| {{ h.effective_date }} | {{ h.previous_value or "（建档）" }} → {{ h.new_value }} | {{ (h.note or "") | md_inline }} | {{ h.recorded_by }} |
{%- endfor %}
{%- endif -%}
{%- endmacro -%}
{%- macro annotations(label, rows) -%}
{%- if rows %}

**{{ label }}（{{ rows | length }} 条）**
{%- for a in rows %}

**批注 #{{ a.id }} · {{ a.annotation_type }}**
{{ kv("创建时间", a.created_at) }}
{{- kv("创建人", a.created_by) }}
{{- kv("修改时间", a.updated_at) }}
{{- kv("修改人", a.updated_by) }}
{{- block("批注内容", a.content) }}
{%- endfor %}
{%- endif -%}
{%- endmacro -%}
{%- set s = standard -%}
---
title: {{ (s.std_no ~ " " ~ s.name_cn ~ " 生命周期回顾") | tojson }}
std_no: {{ s.std_no | tojson }}
name_cn: {{ s.name_cn | tojson }}
name_en: {{ (s.name_en or "") | tojson }}
stage_code: {{ s.stage_code | tojson }}
current_stage: {{ s.stage | tojson }}
risk_level: {{ (s.risk_level or "") | tojson }}
tc_wg: {{ (s.tc_wg or "") | tojson }}
impact_areas: {{ s.impact_area_list | tojson }}
exported_at: {{ exported_at | tojson }}
source: "RegTrack 法规跟踪系统"
---

# {{ s.std_no }} {{ s.name_cn }}
{%- if s.name_en %}

*{{ s.name_en }}*
{%- endif %}

> 本文件由法规跟踪系统于 {{ exported_at }} 导出，汇总该标准在各制定阶段的工作组会议、草案章节、意见与事项，供留存与知识库检索使用。

## 1. 标准概况
{{ kv("标准编号", s.std_no) }}
{{- kv("中文名称", s.name_cn) }}
{{- kv("英文名称", s.name_en) }}
{{- kv("标准类型", s.std_type) }}
{{- kv("当前阶段", s.stage) }}
{{- kv("风险等级", s.risk_level) }}
{{- kv("TC / WG", s.tc_wg) }}
{{- kv("主管部门", s.responsible_authority) }}
{{- kv("牵头单位", s.leading_org) }}
{{- kv("公司负责人", s.mb_owner) }}
{{- kv("影响领域", s.impact_area_list | join("、")) }}
{{- kv("计划发布日期", s.planned_release_date) }}
{{- kv("实际发布日期", s.actual_release_date) }}
{{- kv("实施日期", s.effective_date) }}
{{- block("适用范围", s.scope) }}

## 2. 阶段时间轴

| # | 阶段 | 阶段编码 | 状态 | 记录来源 | 开始 | 结束 | 会议 | 草案 | 意见 | 事项 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
{%- for st in stages %}
| {{ loop.index }} | {{ st.name }} | {{ st.code }} | {{ {"done": "已完成", "current": "当前", "future": "未进入", "unrecorded": "未登记"}[st.state] }} | {{ st.record_type_label or "—" }} | {{ st.start or "—" }} | {{ st.end or ("至今" if st.state == "current" else "—") }} | {{ st.meetings | length }} | {{ st.drafts | length }} | {{ st.comments | length }} | {{ st.actions | length }} |
{%- endfor %}

## 3. 分阶段记录
{%- for st in stages %}

### 3.{{ loop.index }} {{ st.name }}
{%- if st.state == "future" %}

尚未进入该阶段。
{%- elif st.state == "unrecorded" %}

尚未登记该阶段，日期及记录来源未填写。
{%- else %}

{{ st.start }} ～ {{ st.end or "至今" }} · 记录来源：{{ st.record_type_label }}{% if st.note %} · 阶段说明：{{ st.note | md_inline }}{% endif %}

记录于 {{ st.created_at }}（{{ st.created_by }}）{% if st.modified %} · 最近修改 {{ st.updated_at }}（{{ st.updated_by }}）{% else %} · 未修改过{% endif %}
{%- if not (st.meetings or st.drafts or st.comments or st.actions) %}

本阶段未登记会议、草案、意见或事项。
{%- endif %}
{%- if st.meetings %}

#### 工作组会议
{%- for m in st.meetings %}

##### {{ m.meeting_no }} {{ m.title }}
{{ kv("会议日期", m.meeting_date) }}
{{- kv("会议类型", m.meeting_type) }}
{{- kv("组织方", m.organizer) }}
{{- kv("参会人员", m.participants) }}
{{- kv("与本标准的关系", m.standard_note) }}
{{- kv("会议材料", m.material_link) }}
{{- kv("下次会议", m.next_meeting_date) }}
{{- block("关键讨论", m.key_discussions) }}
{{- block("总体结论", m.overall_conclusion) }}
{%- endfor %}
{%- endif %}
{%- if st.drafts %}

#### 草案
{%- for d in st.drafts %}

##### {{ d.version_name }} v{{ d.sub_version_no }}（{{ d.draft_date }}）
{{ kv("发布 / 提供方", d.issued_by) }}
{{- kv("总体影响", d.overall_impact) }}
{{- kv("原文位置", d.file_link) }}
{{- block("主要内容", d.main_summary) }}
{{- block("补充说明", d.notes) }}
{{- annotations("整份草案批注", d.annotations) }}
{%- if d.clauses %}

**当前草案章节（{{ d.clauses | length }} 项）**
{%- for c in d.clauses %}

###### {{ c.clause_no }} · {{ c.title_cn | md_inline }}
{{ kv("英文标题", c.title_en) }}
{{- kv("来源页", c.source_page) }}
{{- kv("复核状态", c.review_status) }}
{{- block("中文正文", c.content_cn) }}
{{- block("英文正文", c.content_en) }}
{{- annotations("章节批注", c.annotations) }}
{%- endfor %}
{%- endif %}
{%- endfor %}
{%- endif %}
{%- if st.comments %}

#### 意见
{%- for c in st.comments %}

##### {{ c.comment_no }}{% if c.clause_no %} · 条款 {{ c.clause_no }}{% endif %}{% if c.topic %} · {{ c.topic | md_inline }}{% endif %} — {{ c.status }}
{{ kv("针对草案", (c.version_name ~ " v" ~ c.sub_version_no) if c.version_name else "") }}
{{- kv("提交人", c.submitted_by) }}
{{- kv("提交渠道", c.submission_channel) }}
{{- kv("提交日期", c.submission_date) }}
{{- block("意见 / 建议", c.comment_text) }}
{{- block("理由", c.rationale) }}
{{- block("起草组回复", c.response) }}
{{- block("后续跟进", c.follow_up) }}
{{- history(c.status_history) }}
{%- endfor %}
{%- endif %}
{%- if st.actions %}

#### 事项
{%- for a in st.actions %}

##### {{ a.item_no }} [{{ a.item_type }}] {{ a.title | md_inline }} — {{ a.current_status }}
{{ kv("优先级", a.priority) }}
{{- kv("截止日期", a.due_date) }}
{{- kv("来源会议", (a.meeting_no ~ " " ~ a.meeting_title) if a.meeting_no else "") }}
{{- kv("关联草案", (a.version_name ~ " v" ~ a.sub_version_no) if a.version_name else "") }}
{{- kv("相关条款", a.related_clause) }}
{{- kv("提出方", a.requesting_body) }}
{{- kv("提交渠道", a.submission_channel) }}
{{- kv("起草方对接人", a.drafter_counterpart) }}
{{- kv("沟通方式", a.lobby_method) }}
{{- kv("实际沟通时间", a.actual_lobby_time) }}
{{- kv("核查负责人", a.check_owner) }}
{{- kv("实际核查时间", a.actual_check_time) }}
{{- kv("核查结论", a.check_result) }}
{{- kv("协调人", a.coordinator) }}
{{- kv("支撑材料", a.supporting_ref) }}
{{- block("描述", a.description) }}
{{- block("目标立场", a.target_position) }}
{{- block("沟通结果", a.outcome) }}
{{- block("差距说明", a.gap_description) }}
{{- block("最终总结", a.final_summary) }}
{%- if a.recipients %}

**反馈对象**

| 团队 | 人员 | 回复状态 | 截止 | 实际回复 | 回复摘要 | 生成意见 |
| --- | --- | --- | --- | --- | --- | --- |
{%- for r in a.recipients %}
| {{ r.respondent_team or "—" }} | {{ r.respondent_person or "—" }} | {{ r.response_status }} | {{ r.response_due_date or "—" }} | {{ r.response_actual_date or "—" }} | {{ (r.response_summary or "—") | md_inline }} | {{ r.generated_comment_no or "—" }} |
{%- endfor %}
{%- endif %}
{{- history(a.status_history) }}
{%- endfor %}
{%- endif %}
{%- endif %}
{%- endfor %}
