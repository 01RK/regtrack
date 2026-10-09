"""接口冒烟测试：覆盖 5 个主入口、全部子表与跨 Form 跳转。

    python -m unittest discover -s tests -v
"""

import io
import json
import sqlite3
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import create_app          # noqa: E402
from app import init_db          # noqa: E402

from urllib.parse import quote     # noqa: E402

# 与浏览器一致：HTTP 头只允许 ISO-8859-1，中文姓名先做 URL 编码。
USER = "测试员"
HEADERS = {"X-User": quote(USER)}


def _positions(text: str, needle: str):
    """返回 needle 在 text 中每一次出现的位置。"""
    start, found = 0, []
    while True:
        i = text.find(needle, start)
        if i < 0:
            return found
        found.append(i)
        start = i + 1


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db = Path(cls.tmp.name) / "test.db"
        init_db(cls.db, with_seed=True)
        cls.app = create_app(cls.db)
        cls.app.config["TESTING"] = True

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.c = self.app.test_client()

    # ---------------------------------------------------------- helpers
    def get(self, url, status=200):
        r = self.c.get(url, headers=HEADERS)
        self.assertEqual(r.status_code, status, f"{url} -> {r.get_json()}")
        return r.get_json()

    def post(self, url, body, status=201):
        r = self.c.post(url, json=body, headers=HEADERS)
        self.assertEqual(r.status_code, status, f"{url} -> {r.get_json()}")
        return r.get_json()

    def put(self, url, body, status=200):
        r = self.c.put(url, json=body, headers=HEADERS)
        self.assertEqual(r.status_code, status, f"{url} -> {r.get_json()}")
        return r.get_json()

    def delete(self, url, status=200):
        r = self.c.delete(url, headers=HEADERS)
        self.assertEqual(r.status_code, status)
        return r.get_json()

    # ------------------------------------------------------------ 页面
    def test_00_pages_render(self):
        for url in ("/", "/standards", "/drafts", "/meetings",
                    "/comments", "/actions", "/settings"):
            r = self.c.get(url)
            self.assertEqual(r.status_code, 200, url)
            self.assertIn(b"<html", r.data)

    def test_01_meta_and_dashboard(self):
        meta = self.get("/api/meta")
        codes = [s["code"] for s in meta["stages"]]
        self.assertEqual(codes, [
            "PRE_RESEARCH", "PROJECT_APPROVAL", "DRAFTING", "COMMENT_DRAFT",
            "REVIEW_DRAFT", "APPROVAL_DRAFT", "RELEASED", "IMPLEMENTED", "ABOLISHED"])
        self.assertEqual(meta["stages"][0]["label"], "预研")
        self.assertEqual(meta["stage_record_types"],
                         {"ADVANCE": "正常推进", "BACKFILL": "历史补录"})
        self.assertIn("补充更早阶段信息", meta["backfill_warning"])
        # 阶段不再是可维护字典，设置页也就不会出现阶段主题
        self.assertNotIn("stage", meta["lookup_categories"])
        self.assertIn("Collect Comments", meta["action_types"])
        dash = self.get("/api/dashboard")
        self.assertEqual(dash["counts"]["standards"], 11)
        self.assertEqual(dash["counts"]["archived_standards"], 0)
        # 阶段分布按阶段编码顺序输出九项（含 0 条的），横向柱图据此画完整标尺
        self.assertEqual([r["code"] for r in dash["by_stage"]], codes)
        # 风险等级图已移除
        self.assertNotIn("by_risk", dash)
        self.assertEqual(meta["version_names"], [
            "立项草案", "讨论稿", "征求意见稿", "送审稿", "报批稿", "发布稿", "修改单"])

    def test_02_dashboard_filters_by_person_and_date(self):
        """在办事项与已参加会议两块都按人过滤，会议还能调时间范围。"""
        d = self.get("/api/dashboard")
        self.assertIn("people", d)
        # 不传参数时按当前操作人过滤；测试员名下没有记录，两块都是空的
        self.assertEqual(d["due_actions"]["person"], USER)
        self.assertEqual(d["due_actions"]["items"], [])
        self.assertEqual(d["meetings"]["person"], USER)
        self.assertEqual(d["meetings"]["total"], 0)
        # 会议默认区间：系统日期所在年份的 1 月 1 日到今天
        self.assertEqual(d["meetings"]["from"], f"{date.today().year}-01-01")
        self.assertEqual(d["meetings"]["to"], date.today().isoformat())

        # 显式传空串 = 不限；这与「没传」是两种不同的意思
        everyone = self.get("/api/dashboard/due-actions?person=")
        self.assertTrue(everyone["items"])
        owner = everyone["items"][0]["created_by"]
        mine = self.get(f"/api/dashboard/due-actions?person={quote(owner)}")
        self.assertTrue(mine["items"])
        self.assertTrue(all(a["created_by"] == owner for a in mine["items"]))
        self.assertLessEqual(len(mine["items"]), len(everyone["items"]))

        # 会议：给定区间内不限人时能看到全部
        span = "from=2024-01-01&to=2026-12-31"
        wide = self.get(f"/api/dashboard/meetings?person=&{span}")
        self.assertEqual(wide["total"], 12)
        self.assertTrue(all(m["standard_count"] >= 0 for m in wide["items"]))

        # 指定人时两条线都算：参会人员里写了他，或这场会是他登记的
        zhang = self.get(f"/api/dashboard/meetings?person={quote('张伟')}&{span}")
        nos = {m["meeting_no"] for m in zhang["items"]}
        self.assertIn("MTG-2024-001", nos)     # 参会名单里有他
        self.assertIn("MTG-2026-003", nos)     # 函审，由他登记
        self.assertNotIn("MTG-2026-001", nos)  # 与他无关
        self.assertLess(zhang["total"], wide["total"])

        # 时间范围收窄后，区间外的会议不再出现
        narrow = self.get(
            f"/api/dashboard/meetings?person={quote('张伟')}&from=2026-01-01&to=2026-12-31")
        self.assertNotIn("MTG-2024-001", {m["meeting_no"] for m in narrow["items"]})
        self.assertLess(narrow["total"], zhang["total"])

    def test_03_stage_history_schema_keeps_one_record_per_stage(self):
        conn = sqlite3.connect(self.db)
        try:
            columns = {r[1] for r in conn.execute(
                "PRAGMA table_info(standard_stage_history)")}
            self.assertIn("stage_code", columns)
            self.assertIn("record_type", columns)
            self.assertNotIn("previous_value", columns)
            # 阶段记录可修改，留痕靠这两对时间戳；旧的 recorded_* 已不再使用
            for column in ("created_at", "created_by", "updated_at", "updated_by"):
                self.assertIn(column, columns)
            self.assertNotIn("recorded_at", columns)
            self.assertNotIn("recorded_by", columns)
            # 模拟数据里没人改过阶段记录，两个时间戳应当一致
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM standard_stage_history "
                "WHERE updated_at <> created_at OR updated_by IS NOT NULL"
            ).fetchone()[0], 0)
            # 同一标准的同一阶段只能有一条记录
            unique = [r for r in conn.execute(
                "PRAGMA index_list(standard_stage_history)") if r[2]]
            columns_of = {tuple(x[2] for x in conn.execute(f"PRAGMA index_info({r[1]})"))
                          for r in unique}
            self.assertIn(("standard_id", "stage_code"), columns_of)
            # 四张历史表仍通过真实外键关联主表
            for table, parent, key in (
                ("standard_stage_history", "standard", "standard_id"),
                ("comment_status_history", "comment", "comment_id"),
                ("action_status_history", "action_item", "action_item_id"),
                ("recipient_status_history", "feedback_recipient", "feedback_recipient_id"),
            ):
                fks = list(conn.execute(f"PRAGMA foreign_key_list({table})"))
                self.assertEqual(len(fks), 1, table)
                self.assertEqual((fks[0][2], fks[0][3]), (parent, key), table)
        finally:
            conn.close()

    def test_04_pasted_symbols_never_break_saving(self):
        """从 Word 复制来的公式：落单代理项、控制字符不再 500，符号字体还原成真字符。"""
        # 浏览器 JSON.stringify 的产物：正文全是 ASCII，服务端解析后才还原成字符。
        # \ud83d 是落单的代理项，UTF-8 编不出来，以前会直接把请求打成 500。
        body = ('{"std_no":"GB/T 88892—2026","name_cn":"公式符号测试",'
                '"stage_code":"DRAFTING","stage_effective_date":"2026-01-01",'
                '"scope":"\\uf068 = (m0\\uf02dm1)/m0 \\uf0b4 100% \\uf0a3 3\\u2030'
                '\\ud83d\\u0000\\u000b \\uf0e5"}')
        r = self.c.post("/api/standards", data=body.encode("utf-8"),
                        headers={**HEADERS, "Content-Type": "application/json"})
        self.assertEqual(r.status_code, 201, r.get_json())
        created = r.get_json()
        # Symbol 字体的私用区码位还原成真字符；存不下的字符被剔除，其余原样保留
        self.assertEqual(created["scope"], "η = (m0−m1)/m0 × 100% ≤ 3‰ ∑")
        self.assertEqual(self.get(f"/api/standards/{created['id']}")["scope"],
                         created["scope"])

        # 子表数组里的文本同样清洗
        action = self.post("/api/actions", {
            "item_type": "Collect Comments", "standard_id": created["id"],
            "title": "征集意见", "description": "d", "current_status": "Open",
            "recipients": [{"respondent_team": "电池研发部\x00",
                            "response_status": "Open",
                            "response_summary": "\uf0b3 500 次"}]})
        self.assertEqual(action["recipients"][0]["respondent_team"], "电池研发部")
        self.assertEqual(action["recipients"][0]["response_summary"], "≥ 500 次")
        self.delete(f"/api/actions/{action['id']}")
        self.delete(f"/api/standards/{created['id']}")

    def test_05_history_rows_cascade_with_parent_delete(self):
        conn = sqlite3.connect(self.db)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("SAVEPOINT history_cascade_test")
        try:
            conn.execute(
                "INSERT INTO standard (id, std_no, name_cn, stage_code) "
                "VALUES (900001, 'TEST-CASCADE', '级联测试标准', 'PROJECT_APPROVAL')")
            conn.execute(
                "INSERT INTO standard_stage_history "
                "(standard_id, stage_code, record_type, effective_date, created_by) "
                "VALUES (900001, 'PROJECT_APPROVAL', 'ADVANCE', '2026-01-01', '测试员')")
            conn.execute(
                "INSERT INTO comment "
                "(id, comment_no, standard_id, comment_text, rationale, status, submitted_by) "
                "VALUES (900001, 'CM-CASCADE', 900001, '测试', '测试', 'Draft', '测试员')")
            conn.execute(
                "INSERT INTO comment_status_history "
                "(comment_id, new_value, effective_date, recorded_by) "
                "VALUES (900001, 'Draft', '2026-01-01', '测试员')")
            conn.execute("DELETE FROM standard WHERE id = 900001")
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM standard_stage_history WHERE standard_id = 900001"
            ).fetchone()[0], 0)
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM comment_status_history WHERE comment_id = 900001"
            ).fetchone()[0], 0)

            conn.execute(
                "INSERT INTO action_item "
                "(id, item_no, item_type, title, description, current_status) "
                "VALUES (900001, 'AI-CASCADE', 'Others', '测试', '测试', 'Open')")
            conn.execute(
                "INSERT INTO action_status_history "
                "(action_item_id, new_value, effective_date, recorded_by) "
                "VALUES (900001, 'Open', '2026-01-01', '测试员')")
            conn.execute(
                "INSERT INTO feedback_recipient "
                "(id, action_item_id, respondent_team, response_status) "
                "VALUES (900001, 900001, '测试团队', 'Open')")
            conn.execute(
                "INSERT INTO recipient_status_history "
                "(feedback_recipient_id, new_value, effective_date, recorded_by) "
                "VALUES (900001, 'Open', '2026-01-01', '测试员')")
            conn.execute("DELETE FROM action_item WHERE id = 900001")
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM action_status_history WHERE action_item_id = 900001"
            ).fetchone()[0], 0)
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM recipient_status_history "
                "WHERE feedback_recipient_id = 900001"
            ).fetchone()[0], 0)
        finally:
            conn.execute("ROLLBACK TO history_cascade_test")
            conn.execute("RELEASE history_cascade_test")
            conn.close()

    def test_06_grouped_lists_filter_sort_and_page_by_standard(self):
        cases = (
            ("/api/drafts?page_size=50", None),
            ("/api/comments?status=Rejected&page_size=50", ("status", "Rejected")),
            ("/api/actions?open_only=1&page_size=50", ("open", True)),
        )
        for url, expected_filter in cases:
            payload = self.get(url)
            self.assertEqual(payload["total"], sum(g["item_count"] for g in payload["groups"]))
            self.assertEqual(payload["group_total"], len(payload["groups"]))
            self.assertEqual(payload["items"], [
                item for group in payload["groups"] for item in group["items"]
            ])
            previous_group_key = None
            for group in payload["groups"]:
                self.assertTrue(group["items"])
                self.assertEqual(group["item_count"], len(group["items"]))
                self.assertEqual(group["latest_created_at"], group["items"][0]["created_at"])
                item_order = [(r["created_at"], r["id"]) for r in group["items"]]
                self.assertEqual(item_order, sorted(item_order, reverse=True))
                for item in group["items"]:
                    self.assertEqual(item["standard_id"] or 0, group["group_key"])
                    if expected_filter == ("status", "Rejected"):
                        self.assertEqual(item["status"], "Rejected")
                    if expected_filter == ("open", True):
                        self.assertNotIn(item["current_status"],
                                         ("Completed", "Closed", "Cancelled"))
                if previous_group_key is not None:
                    self.assertNotEqual(previous_group_key, group["group_key"])
                previous_group_key = group["group_key"]

        first = self.get("/api/drafts?page=1&page_size=1")
        second = self.get("/api/drafts?page=2&page_size=1")
        self.assertEqual(len(first["groups"]), 1)
        self.assertEqual(len(second["groups"]), 1)
        self.assertNotEqual(first["groups"][0]["group_key"], second["groups"][0]["group_key"])
        self.assertEqual(len(first["items"]), first["groups"][0]["item_count"])

    def test_07_grouped_list_ui_contract(self):
        for url in ("/actions", "/comments", "/drafts"):
            html = self.c.get(url).get_data(as_text=True)
            self.assertIn("全部展开", html)
            self.assertIn("全部收起", html)
            self.assertIn("grouped-list.js", html)
        grouped_js = (Path(__file__).resolve().parent.parent / "static" / "js"
                      / "grouped-list.js").read_text(encoding="utf-8")
        self.assertIn('aria-expanded="${closed ? "false" : "true"}"', grouped_js)
        self.assertIn("latest_created_at", grouped_js)
        self.assertIn("collapsed.clear()", grouped_js)

    def test_08_group_sort_tie_uses_latest_record_id(self):
        conn = sqlite3.connect(self.db)
        try:
            conn.executemany(
                "INSERT INTO standard (id, std_no, name_cn, stage_code) "
                "VALUES (?, ?, ?, 'PROJECT_APPROVAL')",
                ((910001, "SORT-A", "排序测试A"), (910002, "SORT-B", "排序测试B")),
            )
            conn.executemany(
                """INSERT INTO action_item
                   (id, item_no, item_type, standard_id, title, description,
                    current_status, coordinator, created_at)
                   VALUES (?, ?, 'Others', ?, 'SORT-TIE', 'SORT-TIE',
                           'Open', '测试员', '2026-08-27 12:00:00')""",
                ((910001, "AI-SORT-A", 910001), (910002, "AI-SORT-B", 910002)),
            )
            conn.commit()
            groups = self.get("/api/actions?q=SORT-TIE&page_size=10")["groups"]
            self.assertEqual([g["standard_id"] for g in groups], [910002, 910001])
        finally:
            conn.execute("DELETE FROM action_item WHERE id IN (910001, 910002)")
            conn.execute("DELETE FROM standard WHERE id IN (910001, 910002)")
            conn.commit()
            conn.close()

    def test_09_grouped_list_indexes_are_present(self):
        expected = {
            "ix_draft_group_created",
            "ix_draft_chapter",
            "ix_comment_group_created",
            "ix_action_group_created",
        }
        conn = sqlite3.connect(self.db)
        try:
            actual = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'")}
            self.assertTrue(expected.issubset(actual))
        finally:
            conn.close()

    def test_09_grouped_table_layout_is_stable(self):
        expected_columns = {"actions.html": 7, "comments.html": 8, "drafts.html": 7}
        template_dir = Path(__file__).resolve().parent.parent / "templates"
        for filename, count in expected_columns.items():
            html = (template_dir / filename).read_text(encoding="utf-8")
            self.assertIn("grouped-table", html)
            self.assertEqual(html.count("<col style="), count, filename)
        css = (Path(__file__).resolve().parent.parent / "static" / "css"
               / "app.css").read_text(encoding="utf-8")
        self.assertIn("overflow-y: scroll", css)
        self.assertIn("scrollbar-gutter: stable", css)
        self.assertIn("table-layout: fixed", css)
        self.assertIn("--group-bg: #f4f5f7", css)
        self.assertIn("background: var(--group-bg);", css)

    # -------------------------------------------------- 1 标准主档
    def test_10_standard_list_search_filter(self):
        self.assertEqual(self.get("/api/standards")["total"], 11)
        hit = self.get("/api/standards?q=38031")
        self.assertEqual(hit["total"], 1)
        self.assertEqual(hit["items"][0]["draft_count"], 4)
        # 过滤按阶段编码，展示用名称一并下发
        self.assertEqual(self.get("/api/standards?stage=IMPLEMENTED")["total"], 4)
        self.assertEqual(hit["items"][0]["stage"], "实施")
        self.assertEqual(self.get("/api/standards?risk=High")["total"], 5)

    def test_11_standard_options_have_redundant_info(self):
        opts = self.get("/api/standards/options?q=GB")
        self.assertTrue(opts)
        row = opts[0]
        for key in ("std_no", "name_cn", "stage_code", "stage", "tc_wg", "draft_count"):
            self.assertIn(key, row)

    def test_12_standard_detail_bundles_relations(self):
        s = self.get("/api/standards/1")
        self.assertEqual(s["std_no"], "GB 38031—2025")
        self.assertEqual(len(s["drafts"]), 4)
        # 立项 → 起草 → 征求意见稿 → 送审稿 → 报批稿 → 发布 → 实施
        self.assertEqual(len(s["stage_history"]), 7)
        self.assertEqual(s["stage_history"][0]["stage_code"], "PROJECT_APPROVAL")
        self.assertEqual(s["stage_history"][0]["record_type"], "ADVANCE")
        self.assertEqual(s["stage_code"], "IMPLEMENTED")
        # 时间轴覆盖全部九个阶段：未填写的预研标为可补录
        self.assertEqual(len(s["stage_timeline"]), 9)
        by_code = {st["code"]: st for st in s["stage_timeline"]}
        self.assertEqual(by_code["PRE_RESEARCH"]["state"], "missing")
        self.assertEqual(by_code["IMPLEMENTED"]["state"], "current")
        self.assertEqual(by_code["ABOLISHED"]["state"], "future")
        self.assertTrue(s["comments"] and s["actions"] and s["meetings"])
        self.assertIn("Battery", s["impact_area_list"])

    def test_13_standard_create_update_and_impact_areas(self):
        created = self.post("/api/standards", {
            "std_no": "GB/T 99999—2026", "name_cn": "测试标准",
            "stage_code": "PROJECT_APPROVAL", "risk_level": "Low",
            "impact_area_list": ["Battery", "E/E"],
            "stage_effective_date": "2026-01-01",
        })
        sid = created["id"]
        self.assertEqual(sorted(created["impact_area_list"]), ["Battery", "E/E"])
        self.assertEqual(created["stage"], "立项")
        # 建档即写入第一条阶段记录
        stages = self.get(f"/api/standards/{sid}/stages")["records"]
        self.assertEqual(len(stages), 1)
        self.assertEqual(stages[0]["record_type"], "ADVANCE")

        updated = self.put(f"/api/standards/{sid}", {
            "name_cn": "测试标准（改名）", "mb_owner": "张伟",
            "impact_area_list": ["Brake"],
        })
        self.assertEqual(updated["name_cn"], "测试标准（改名）")
        self.assertEqual(updated["impact_area_list"], ["Brake"])
        self.delete(f"/api/standards/{sid}")

    def test_14_standard_validation_reports_the_actual_reason(self):
        r = self.c.post("/api/standards", json={"name_cn": "缺编号"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        body = r.get_json()
        self.assertEqual(body["field"], "std_no")
        self.assertIn("std_no", body["detail"])

        # 阶段编码不合法时告知可选编码，而不是一句「网络错误」
        r = self.c.post("/api/standards", json={
            "std_no": "X-1", "name_cn": "阶段非法", "stage_code": "NO_SUCH_STAGE"},
            headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "stage_code")
        self.assertIn("PRE_RESEARCH", r.get_json()["detail"])

        # 唯一性冲突回到具体字段，且不会留下半条标准
        before = self.get("/api/standards")["total"]
        r = self.c.post("/api/standards", json={
            "std_no": "GB 38031—2025", "name_cn": "重复编号",
            "stage_code": "PROJECT_APPROVAL"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn("唯一", r.get_json()["error"])
        self.assertEqual(self.get("/api/standards")["total"], before)

        # 日期格式错误同样给出实际收到的值
        r = self.c.post("/api/standards", json={
            "std_no": "X-2", "name_cn": "日期非法", "stage_code": "PRE_RESEARCH",
            "effective_date": "2026/01/01"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "effective_date")

    def test_15_standard_dictionary_fields_are_created_on_first_use(self):
        """字典里没有的 TC/WG、责任单位、负责人不应阻断建档。"""
        created = self.post("/api/standards", {
            "std_no": "GB/T 77777—2026", "name_cn": "字典自动新增测试",
            "stage_code": "PRE_RESEARCH",
            "tc_wg": "TC900/SC1 新分标委",
            "responsible_authority": "某新主管机构",
            "leading_org": "某新牵头单位",
            "mb_owner": "首次录入的负责人",
            "impact_area_list": ["新影响领域"],
        })
        for category, value in (("tc_wg", "TC900/SC1 新分标委"),
                                ("organization", "某新主管机构"),
                                ("organization", "某新牵头单位"),
                                ("person", "首次录入的负责人"),
                                ("impact_area", "新影响领域")):
            values = [r["value"] for r in self.get(f"/api/lookups/{category}")]
            self.assertIn(value, values, category)
        self.assertEqual(created["tc_wg"], "TC900/SC1 新分标委")
        self.delete(f"/api/standards/{created['id']}")

    def test_16_stage_advance_and_backfill(self):
        s = self.post("/api/standards", {
            "std_no": "GB/T 88888—2026", "name_cn": "阶段推进测试",
            "stage_code": "DRAFTING", "stage_effective_date": "2026-01-01"})
        sid = s["id"]

        # 正常推进：目标阶段在当前阶段之后
        res = self.post(f"/api/standards/{sid}/stages", {
            "stage_code": "COMMENT_DRAFT", "effective_date": "2026-02-01",
            "note": "公开征求意见", "reference": "https://example.org/draft"})
        self.assertEqual(res["record"]["record_type"], "ADVANCE")
        self.assertEqual(res["record"]["created_by"], "测试员")
        self.assertFalse(res["record"]["modified"])
        self.assertEqual(res["standard"]["stage_code"], "COMMENT_DRAFT")

        # 历史补录：当前阶段之前尚未填写的阶段，可填真实发生时间
        res = self.post(f"/api/standards/{sid}/stages", {
            "stage_code": "PRE_RESEARCH", "effective_date": "2025-03-10",
            "note": "补录预研"})
        self.assertEqual(res["record"]["record_type"], "BACKFILL")
        self.assertTrue(res["record"]["editable"])
        # 补录不改变当前阶段
        self.assertEqual(res["standard"]["stage_code"], "COMMENT_DRAFT")

        # 补录的日期可以晚于更早阶段、早于当前阶段，均不受顺序限制
        res = self.post(f"/api/standards/{sid}/stages", {
            "stage_code": "PROJECT_APPROVAL", "effective_date": "2025-12-20"})
        self.assertEqual(res["record"]["record_type"], "BACKFILL")

        data = self.get(f"/api/standards/{sid}/stages")
        self.assertEqual(data["stage_code"], "COMMENT_DRAFT")
        states = {st["code"]: st["state"] for st in data["timeline"]}
        self.assertEqual(states["PRE_RESEARCH"], "done")
        self.assertEqual(states["COMMENT_DRAFT"], "current")
        self.assertEqual(states["REVIEW_DRAFT"], "future")

        # 已填写的阶段不能重复填写
        r = self.c.post(f"/api/standards/{sid}/stages", json={
            "stage_code": "COMMENT_DRAFT", "effective_date": "2026-03-01"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn("不可重复填写", r.get_json()["error"])

        # 正常推进的日期不能早于当前阶段
        r = self.c.post(f"/api/standards/{sid}/stages", json={
            "stage_code": "REVIEW_DRAFT", "effective_date": "2025-12-31"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "effective_date")

        # 主档编辑不能绕过阶段管理直接改当前阶段
        after = self.put(f"/api/standards/{sid}", {"stage_code": "RELEASED"})
        self.assertEqual(after["stage_code"], "COMMENT_DRAFT")
        self.delete(f"/api/standards/{sid}")

    def test_17_every_stage_record_can_be_corrected(self):
        """阶段记录不锁定：推进与补录都能改，留痕靠创建 / 最近修改两个时间戳。"""
        s = self.post("/api/standards", {
            "std_no": "GB/T 88889—2026", "name_cn": "阶段修改测试",
            "stage_code": "DRAFTING", "stage_effective_date": "2026-01-01"})
        sid = s["id"]
        seeded = self.get(f"/api/standards/{sid}/stages")["records"][0]
        advance = self.post(f"/api/standards/{sid}/stages", {
            "stage_code": "COMMENT_DRAFT", "effective_date": "2026-02-01"})["record"]
        backfill = self.post(f"/api/standards/{sid}/stages", {
            "stage_code": "PRE_RESEARCH", "effective_date": "2025-01-01"})["record"]

        # 新记录：创建时间与最近修改时间一致，标记为「未修改过」
        for record in (seeded, advance, backfill):
            self.assertTrue(record["editable"], record["stage_code"])
            self.assertFalse(record["modified"], record["stage_code"])
            self.assertEqual(record["created_at"], record["updated_at"])

        # 正常推进的记录同样可以更正，且不影响首次记录的时间戳
        edited = self.put(f"/api/standards/{sid}/stages/{advance['id']}", {
            "effective_date": "2026-03-15", "note": "更正发文日期"})["record"]
        self.assertEqual(edited["effective_date"], "2026-03-15")
        self.assertEqual(edited["record_type"], "ADVANCE")
        self.assertEqual(edited["created_at"], advance["created_at"])
        self.assertEqual(edited["created_by"], advance["created_by"])
        self.assertEqual(edited["updated_by"], USER)
        self.assertTrue(edited["modified"])

        # 建档时写入的第一条记录也不例外
        first = self.put(f"/api/standards/{sid}/stages/{seeded['id']}", {
            "effective_date": "2025-12-01", "note": "建档时填错了年份"})["record"]
        self.assertTrue(first["modified"])

        # 补录记录一如既往可改
        edited = self.put(f"/api/standards/{sid}/stages/{backfill['id']}", {
            "effective_date": "2025-02-02", "note": "更正补录日期"})["record"]
        self.assertEqual(edited["effective_date"], "2025-02-02")
        self.assertEqual(edited["record_type"], "BACKFILL")

        # 阶段本身不可改写：传进来的 stage_code 一律忽略
        same = self.put(f"/api/standards/{sid}/stages/{backfill['id']}", {
            "effective_date": "2025-02-02", "stage_code": "RELEASED"})["record"]
        self.assertEqual(same["stage_code"], "PRE_RESEARCH")
        self.assertEqual(self.get(f"/api/standards/{sid}")["stage_code"], "COMMENT_DRAFT")

        # 必填与日期格式照常校验
        r = self.c.put(f"/api/standards/{sid}/stages/{backfill['id']}",
                       json={"effective_date": ""}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "effective_date")
        self.delete(f"/api/standards/{sid}")

    def test_18_standard_profile_has_no_completeness(self):
        """档案完整度已整体移除：主档、列表与 /api/meta 都不再返回相关字段。"""
        s = self.post("/api/standards", {
            "std_no": "GB/T 88890—2026", "name_cn": "完整度移除测试",
            "stage_code": "PRE_RESEARCH", "stage_effective_date": "2026-01-01"})
        sid = s["id"]
        self.assertNotIn("completeness", s)
        self.assertNotIn("completeness", self.get(f"/api/standards/{sid}"))
        row = next(r for r in self.get("/api/standards?q=88890")["items"] if r["id"] == sid)
        self.assertNotIn("completeness", row)
        self.assertNotIn("profile_checklist", self.get("/api/meta"))
        # 信息不全照样能保存、能推进阶段
        self.post(f"/api/standards/{sid}/stages", {
            "stage_code": "PROJECT_APPROVAL", "effective_date": "2026-02-01"})
        self.assertEqual(self.get(f"/api/standards/{sid}")["stage_code"], "PROJECT_APPROVAL")
        self.delete(f"/api/standards/{sid}")

    def test_19_delete_archives_instead_of_dropping_data(self):
        s = self.post("/api/standards", {
            "std_no": "GB/T 88891—2026", "name_cn": "归档测试",
            "stage_code": "DRAFTING", "stage_effective_date": "2026-01-01"})
        sid = s["id"]
        self.post("/api/drafts", {"standard_id": sid, "version_name": "讨论稿",
                                  "sub_version_no": "1.0", "draft_date": "2026-01-10"})
        before = self.get("/api/standards")["total"]
        archived_before = self.get("/api/standards?archived=1")["total"]

        archived = self.delete(f"/api/standards/{sid}")
        self.assertTrue(archived["archived"])
        self.assertEqual(archived["archived_by"], USER)
        # 正常列表看不到，归档视图能看到，数据全在
        self.assertEqual(self.get("/api/standards")["total"], before - 1)
        self.assertEqual(self.get("/api/standards?archived=1")["total"], archived_before + 1)
        self.assertEqual(self.get(f"/api/standards/{sid}")["std_no"], "GB/T 88891—2026")
        self.assertEqual(len(self.get(f"/api/standards/{sid}/stages")["records"]), 1)
        # 归档标准不再出现在关联列表与下拉中
        self.assertNotIn(sid, [g["standard_id"] for g in self.get("/api/drafts")["groups"]])
        self.assertNotIn(sid, [o["id"] for o in self.get("/api/standards/options")])

        restored = self.post(f"/api/standards/{sid}/restore", {}, status=200)
        self.assertFalse(restored["archived"])
        self.assertEqual(self.get("/api/standards")["total"], before)
        self.delete(f"/api/standards/{sid}")

    # -------------------------------------------------- 2 草案登记
    def test_20_draft_list_and_options(self):
        self.assertEqual(self.get("/api/drafts")["total"], 25)
        self.assertEqual(self.get("/api/drafts?standard_id=1")["total"], 4)
        opts = self.get("/api/drafts/options?standard_id=1")
        self.assertEqual(len(opts), 4)
        self.assertIn("sub_version_no", opts[0])
        self.assertEqual(self.get("/api/drafts/options"), [])

    def test_21_draft_detail_and_chapters(self):
        d = self.get("/api/drafts/3")
        self.assertEqual(d["std_no"], "GB/T 4R001—2026")
        self.assertEqual(d["chapters"], [])
        self.assertEqual(d["imports"], [])
        self.assertIn("annotations", d)


    def test_22_draft_crud_and_detail(self):
        draft = self.post("/api/drafts", {"standard_id": 1, "version_name": "报批稿",
            "sub_version_no": "9.9", "draft_date": "2026-03-01", "overall_impact": "Medium"})
        did = draft["id"]
        self.assertEqual(self.get(f"/api/drafts/{did}")["chapters"], [])
        self.put(f"/api/drafts/{did}", {"main_summary": "更新后的摘要"})
        self.assertEqual(self.get(f"/api/drafts/{did}")["main_summary"], "更新后的摘要")
        self.delete(f"/api/drafts/{did}")


    def test_23_standard_compare_is_reserved(self):
        html = self.c.get("/drafts").get_data(as_text=True)
        self.assertIn("标准比对", html)
        self.assertNotIn("条款变化检索", html)
        self.assertEqual(self.c.get("/api/drafts/clauses/search").status_code, 404)


    def test_24_draft_requires_existing_standard(self):
        r = self.c.post("/api/drafts", json={
            "standard_id": 9999, "version_name": "讨论稿", "sub_version_no": "1.0",
            "draft_date": "2026-01-01"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)

    def test_25_draft_version_name_is_fixed(self):
        r = self.c.post("/api/drafts", json={
            "standard_id": 1, "version_name": "起草稿", "sub_version_no": "9.0",
            "draft_date": "2026-01-01"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "version_name")
        r = self.c.put("/api/drafts/1", json={"version_name": "随便写"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)

    # -------------------------------------------------- 生命周期回顾
    def test_26_lifecycle_groups_records_by_stage(self):
        data = self.get("/api/standards/1/lifecycle")
        self.assertEqual(data["standard"]["std_no"], "GB 38031—2025")
        stages = {s["name"]: s for s in data["stages"]}
        self.assertEqual([s["name"] for s in data["stages"]],
                         ["立项", "起草", "征求意见稿", "送审稿", "报批稿", "发布", "实施"])
        self.assertEqual(stages["实施"]["state"], "current")
        self.assertIsNone(stages["实施"]["end"])
        self.assertEqual(stages["起草"]["end"], stages["征求意见稿"]["start"])
        # 版本名映射优先：讨论稿 → 起草
        self.assertEqual([d["version_name"] for d in stages["起草"]["drafts"]], ["讨论稿"])
        # 意见跟随所属草案的阶段
        self.assertEqual({c["draft_id"] for c in stages["征求意见稿"]["comments"]}, {2})
        self.assertEqual([m["meeting_no"] for m in stages["征求意见稿"]["meetings"]],
                         ["MTG-2024-001"])
        # 页面数据不带导出专用的明细
        self.assertEqual(stages["起草"]["actions"], [])
        self.assertNotIn("clauses", stages["起草"]["drafts"][0])
        self.assertNotIn("status_history", stages["征求意见稿"]["comments"][0])

    def test_27_lifecycle_future_skipped_and_fallback(self):
        std = self.post("/api/standards", {
            "std_no": "GB/T 55555—2026", "name_cn": "生命周期测试",
            "stage_code": "PROJECT_APPROVAL", "stage_effective_date": "2026-01-01"})
        sid = std["id"]
        # 跳过「起草」直接进入征求意见稿
        self.post(f"/api/standards/{sid}/stages",
                  {"stage_code": "COMMENT_DRAFT", "effective_date": "2026-03-01"})
        # 送审稿尚未经历：按日期落入当前阶段；修改单无映射：按日期归档
        self.post("/api/drafts", {"standard_id": sid, "version_name": "送审稿",
                                  "sub_version_no": "1.0", "draft_date": "2026-04-01"})
        self.post("/api/drafts", {"standard_id": sid, "version_name": "修改单",
                                  "sub_version_no": "1.0", "draft_date": "2026-02-01"})
        early = self.post("/api/drafts", {"standard_id": sid, "version_name": "立项草案",
                                          "sub_version_no": "1.0", "draft_date": "2025-12-01"})
        self.post("/api/comments", {"standard_id": sid, "comment_text": "无草案意见",
                                    "rationale": "测试", "submitted_by": "张伟",
                                    "submission_date": "2026-03-15"})
        data = self.get(f"/api/standards/{sid}/lifecycle")
        names = [(s["name"], s["state"]) for s in data["stages"]]
        self.assertNotIn("起草", [n for n, _ in names])
        self.assertNotIn("废止", [n for n, _ in names])
        self.assertEqual(names[:2], [("立项", "done"), ("征求意见稿", "current")])
        self.assertTrue(all(state == "future" for _, state in names[2:]))
        stages = {s["name"]: s for s in data["stages"]}
        self.assertEqual({d["version_name"] for d in stages["立项"]["drafts"]},
                         {"修改单", "立项草案"})
        self.assertEqual([d["version_name"] for d in stages["征求意见稿"]["drafts"]], ["送审稿"])
        self.assertEqual(len(stages["征求意见稿"]["comments"]), 1)
        self.assertEqual(stages["送审稿"]["drafts"], [])
        self.assertEqual(early["version_name"], "立项草案")
        self.delete(f"/api/standards/{sid}")

    def test_28_lifecycle_markdown_export(self):
        r = self.c.get("/api/standards/1/lifecycle.md", headers=HEADERS)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.mimetype.startswith("text/markdown"))
        self.assertIn("attachment", r.headers["Content-Disposition"])
        self.assertIn("filename*=UTF-8''GB_38031", r.headers["Content-Disposition"])
        text = r.data.decode("utf-8")
        self.assertTrue(text.startswith("---\ntitle: "))
        for expected in ("## 1. 标准概况", "## 2. 阶段时间轴", "### 3.3 征求意见稿",
                         "#### 工作组会议", "##### MTG-2024-001", "**条款变化（2 条）**",
                         "##### CM-2024-001", "**起草组回复**", "#### 事项",
                         "##### AI-2024-001 [Collect Comments]", "**反馈对象**",
                         "| 2024-01-10 | Draft → Submitted |"):
            self.assertIn(expected, text)
        self.assertNotIn("&amp;", text)
        # 编号中的斜杠不能进入文件名
        r = self.c.get("/api/standards/10/lifecycle.md")
        self.assertIn("filename*=UTF-8''T_CSAE_267", r.headers["Content-Disposition"])
        self.assertEqual(self.c.get("/api/standards/9999/lifecycle.md").status_code, 404)

    # -------------------------------------------------- 3 工作组会议
    def test_30_meeting_list_with_standards(self):
        data = self.get("/api/meetings")
        self.assertEqual(data["total"], 12)
        self.assertIn("standards", data["items"][0])
        # GB 38031 出现在 5 场会议中：送审稿审查会、两次函审/起草会衔接、两次月度例会
        self.assertEqual(self.get("/api/meetings?standard_id=1")["total"], 5)
        by_no = {m["meeting_no"]: m for m in self.get("/api/meetings?page_size=50")["items"]}
        # 联合协调会同时挂两项标准，月度例会一次挂三项
        self.assertEqual({s["std_no"] for s in by_no["MTG-2024-002"]["standards"]},
                         {"GB 44495—2024", "GB 44496—2024"})
        self.assertEqual(by_no["MTG-2026-006"]["standard_count"], 3)
        self.assertEqual(by_no["MTG-2026-008"]["standard_count"], 0)
        # 每个标准在本会的讨论要点随关联返回
        self.assertTrue(all(s["note"] for s in by_no["MTG-2026-007"]["standards"]))
        # 标准侧也能看到全部会议
        self.assertEqual(len(self.get("/api/standards/1")["meetings"]), 5)

    def test_31_meeting_links_many_standards(self):
        m = self.post("/api/meetings", {
            "title": "临时协调会", "meeting_date": "2026-08-01",
            "meeting_type": "电话会", "standard_ids": [9, 4]})
        mid = m["id"]
        self.assertTrue(m["meeting_no"].startswith("MTG-2026-"))
        self.assertEqual(sorted(s["id"] for s in m["standards"]), [4, 9])

        # 追加标准不会把它从其它会议上挪走
        before = self.get("/api/meetings?standard_id=1")["total"]
        rows = self.post(f"/api/meetings/{mid}/standards",
                         {"standard_id": 1, "note": "顺带讨论"})
        self.assertEqual(sorted(r["id"] for r in rows), [1, 4, 9])
        self.assertEqual(self.get("/api/meetings?standard_id=1")["total"], before + 1)
        self.assertEqual(self.get("/api/meetings/1")["standards"][0]["id"], 1)

        # 同一标准不能在同一场会议上挂两次
        r = self.c.post(f"/api/meetings/{mid}/standards", json={"standard_id": 1},
                        headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn("已经挂在这场会议上", r.get_json()["error"])

        rows = self.delete(f"/api/meetings/{mid}/standards/4")
        self.assertEqual(sorted(r["id"] for r in rows), [1, 9])

        # 编辑时按列表重设：保留的关联不丢讨论要点，未提交该字段则不改动
        updated = self.put(f"/api/meetings/{mid}", {"standard_ids": [1, 6]})
        self.assertEqual(sorted(s["id"] for s in updated["standards"]), [1, 6])
        kept = next(s for s in updated["standards"] if s["id"] == 1)
        self.assertEqual(kept["note"], "顺带讨论")
        updated = self.put(f"/api/meetings/{mid}", {"organizer": "全国汽标委"})
        self.assertEqual(len(updated["standards"]), 2)

        # 取消挂载会连带删掉批注，所以要先确认；不确认就拦下来
        r = self.c.put(f"/api/meetings/{mid}", json={"standard_ids": []}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn("Note 也将丢失", r.get_json()["error"])
        self.assertIn("GB 38031", r.get_json()["detail"])
        self.assertEqual(len(self.get(f"/api/meetings/{mid}")["standards"]), 2)
        updated = self.put(f"/api/meetings/{mid}",
                           {"standard_ids": [], "drop_notes": True})
        self.assertEqual(updated["standards"], [])

        # 不存在的标准给出具体 id
        r = self.c.put(f"/api/meetings/{mid}", json={"standard_ids": [999999]},
                       headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn("999999", r.get_json()["detail"])
        self.delete(f"/api/meetings/{mid}")

    def test_31c_meeting_standard_note_is_editable(self):
        """一场会讨论多项标准时，每项标准的批注分开记、可编辑、可清空。"""
        m = self.post("/api/meetings", {
            "title": "批注测试会", "meeting_date": "2026-08-20",
            "meeting_type": "内部例会", "standard_ids": [1, 2]})
        mid = m["id"]
        self.assertTrue(all(s["note"] is None for s in m["standards"]))

        rows = self.put(f"/api/meetings/{mid}/standards/1", {"note": " 热扩散判定条件待确认 "})
        noted = next(s for s in rows if s["id"] == 1)
        self.assertEqual(noted["note"], "热扩散判定条件待确认")     # 两端空白去掉
        self.assertIsNone(next(s for s in rows if s["id"] == 2)["note"])
        # 批注只属于这条关联：同一项标准在别的会议上还是原来的批注
        other = next(s for s in self.get("/api/meetings/1")["standards"] if s["id"] == 1)
        self.assertNotEqual(other["note"], noted["note"])

        # 取消挂载带批注的标准要先确认
        r = self.c.delete(f"/api/meetings/{mid}/standards/1", headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertIn("Note 也将丢失", r.get_json()["error"])
        self.assertEqual(len(self.get(f"/api/meetings/{mid}")["standards"]), 2)
        # 没有批注的那项直接移除，不打扰用户
        rows = self.delete(f"/api/meetings/{mid}/standards/2")
        self.assertEqual([s["id"] for s in rows], [1])
        # 确认后才真的删掉
        rows = self.delete(f"/api/meetings/{mid}/standards/1?drop_notes=1")
        self.assertEqual(rows, [])

        # 批注可以清空；没挂上的标准不能写批注
        self.post(f"/api/meetings/{mid}/standards", {"standard_id": 3, "note": "先记一笔"})
        rows = self.put(f"/api/meetings/{mid}/standards/3", {"note": "   "})
        self.assertIsNone(rows[0]["note"])
        self.assertEqual(len(self.delete(f"/api/meetings/{mid}/standards/3")), 0)
        r = self.c.put(f"/api/meetings/{mid}/standards/3", json={"note": "x"},
                       headers=HEADERS)
        self.assertEqual(r.status_code, 404)
        self.delete(f"/api/meetings/{mid}")

    def test_31b_meeting_standard_schema_is_many_to_many(self):
        conn = sqlite3.connect(self.db)
        try:
            pk = [r[1] for r in sorted(conn.execute("PRAGMA table_info(meeting_standard)"),
                                       key=lambda r: r[5]) if r[5]]
            self.assertEqual(pk, ["meeting_id", "standard_id"])
            uniques = [r for r in conn.execute("PRAGMA index_list(meeting_standard)")
                       if r[2] and r[3] != "pk"]
            self.assertEqual(uniques, [])
        finally:
            conn.close()

    def test_32_meeting_no_is_sequential(self):
        a = self.post("/api/meetings", {"title": "会议A", "meeting_date": "2027-01-05"})
        b = self.post("/api/meetings", {"title": "会议B", "meeting_date": "2027-01-06"})
        self.assertEqual(a["meeting_no"], "MTG-2027-001")
        self.assertEqual(b["meeting_no"], "MTG-2027-002")
        self.delete(f"/api/meetings/{a['id']}")
        self.delete(f"/api/meetings/{b['id']}")

    def test_33_meeting_detail_lists_derived_actions(self):
        m = self.get("/api/meetings/1")
        self.assertEqual(m["meeting_no"], "MTG-2024-001")
        self.assertEqual(len(m["standards"]), 1)
        self.assertEqual([a["item_no"] for a in m["actions"]], ["AI-2024-002"])

    # -------------------------------------------------- 4 意见矩阵
    def test_40_comment_list_and_detail(self):
        self.assertEqual(self.get("/api/comments")["total"], 10)
        self.assertEqual(self.get("/api/comments?status=Rejected")["total"], 1)
        c = self.get("/api/comments/1")
        self.assertEqual(c["comment_no"], "CM-2024-001")
        self.assertEqual(len(c["status_history"]), 3)
        self.assertEqual(c["version_name"], "征求意见稿")

    def test_41_comment_crud_and_status_history(self):
        c = self.post("/api/comments", {
            "standard_id": 6, "draft_id": 18, "clause_no": "5.2.3", "topic": "测试主题",
            "comment_text": "建议放宽限值。", "rationale": "现有平台难以达标。",
            "status": "Draft", "submitted_by": "吴敏"})
        cid = c["id"]
        self.assertTrue(c["comment_no"].startswith("CM-"))
        self.assertEqual(len(c["status_history"]), 1)

        res = self.post(f"/api/comments/{cid}/status-history", {
            "new_value": "Submitted", "effective_date": "2026-08-01", "note": "已提交"})
        self.assertEqual(res["history"]["previous_value"], "Draft")
        self.assertEqual(res["comment"]["status"], "Submitted")

        after = self.put(f"/api/comments/{cid}", {"status": "Accepted", "follow_up": "跟进中"})
        self.assertEqual(after["status"], "Submitted")     # 状态不能绕过历史
        self.assertEqual(after["follow_up"], "跟进中")

        self.delete(f"/api/comments/{cid}")
        self.get(f"/api/comments/{cid}", status=404)

    def test_42_comment_draft_must_match_standard(self):
        r = self.c.post("/api/comments", json={
            "standard_id": 6, "draft_id": 1, "comment_text": "x", "rationale": "y",
            "status": "Draft", "submitted_by": "吴敏"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "draft_id")

    def test_43_comment_required_fields(self):
        r = self.c.post("/api/comments", json={"standard_id": 1}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "comment_text")

    # -------------------------------------------------- 5 事项
    def test_50_action_list_and_filters(self):
        self.assertEqual(self.get("/api/actions")["total"], 13)
        self.assertEqual(self.get("/api/actions?type=Collect%20Comments")["total"], 3)
        open_only = self.get("/api/actions?open_only=1")
        self.assertTrue(all(a["current_status"] not in ("Completed", "Closed", "Cancelled")
                            for a in open_only["items"]))
        collect = self.get("/api/actions?type=Collect%20Comments&page_size=50")
        self.assertTrue(all("recipients" in a for a in collect["items"]))

    def test_51_action_detail_has_recipients_and_history(self):
        a = self.get("/api/actions/1")
        self.assertEqual(a["item_type"], "Collect Comments")
        self.assertEqual(len(a["recipients"]), 3)
        self.assertEqual(a["responded_count"], 2)
        self.assertTrue(a["status_history"])
        # 征求意见阶段的意见征集早于审查会，不关联会议；会后派生的沟通事项才关联。
        self.assertIsNone(a["meeting_no"])
        self.assertEqual(self.get("/api/actions/2")["meeting_no"], "MTG-2024-001")

    def test_52_action_subtype_required_fields(self):
        for item_type, missing in (
            ("Survey Feedback", "requesting_body"),
            ("Lobby with Drafter", "drafter_counterpart"),
            ("Compliance Check", "check_owner"),
            ("Others", "coordinator"),
        ):
            r = self.c.post("/api/actions", json={
                "item_type": item_type, "standard_id": 1, "title": "t",
                "description": "d", "current_status": "Open"}, headers=HEADERS)
            self.assertEqual(r.status_code, 400, item_type)
            self.assertEqual(r.get_json()["field"], missing)

    def test_53_action_standard_required_except_others(self):
        r = self.c.post("/api/actions", json={
            "item_type": "Survey Feedback", "title": "t", "description": "d",
            "current_status": "Open", "requesting_body": "x",
            "submission_due_date": "2026-09-01"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "standard_id")

        a = self.post("/api/actions", {
            "item_type": "Others", "title": "无标准事项", "description": "d",
            "current_status": "Open", "coordinator": "李静"})
        self.assertIsNone(a["standard_id"])
        self.delete(f"/api/actions/{a['id']}")

    def test_54_collect_comments_needs_recipient(self):
        r = self.c.post("/api/actions", json={
            "item_type": "Collect Comments", "standard_id": 1, "title": "t",
            "description": "d", "current_status": "Open"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "recipients")

    def test_55_recipient_lifecycle_and_comment_generation(self):
        a = self.post("/api/actions", {
            "item_type": "Collect Comments", "standard_id": 1, "draft_id": 3,
            "title": "征集测试", "description": "d", "current_status": "Open",
            "related_clause": "5.2.2",
            "recipients": [{"respondent_team": "试验中心", "response_status": "Open",
                            "response_due_date": "2026-09-01"}]})
        aid = a["id"]
        self.assertEqual(len(a["recipients"]), 1)

        rows = self.post(f"/api/actions/{aid}/recipients", {
            "respondent_person": "刘芳", "response_status": "Open"})
        self.assertEqual(len(rows), 2)

        # Team / Person 都为空要被拒绝
        r = self.c.post(f"/api/actions/{aid}/recipients",
                        json={"response_status": "Open"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)

        rid = rows[1]["id"]
        rows = self.put(f"/api/actions/recipients/{rid}", {
            "response_status": "Responded", "response_actual_date": "2026-08-10",
            "response_summary": "建议延长过渡期。"})
        target = next(x for x in rows if x["id"] == rid)
        self.assertEqual(target["response_status"], "Responded")

        # 生成 Comment 的预填数据
        pre = self.get(f"/api/actions/recipients/{rid}/comment-draft")
        self.assertIsNone(pre["existing"])
        self.assertEqual(pre["prefill"]["standard_id"], 1)
        self.assertEqual(pre["prefill"]["clause_no"], "5.2.2")
        self.assertEqual(pre["prefill"]["comment_text"], "建议延长过渡期。")

        payload = dict(pre["prefill"])
        payload["rationale"] = "有实测数据支撑。"
        comment = self.post("/api/comments", payload)
        self.assertEqual(comment["source_recipient_id"], rid)

        again = self.get(f"/api/actions/recipients/{rid}/comment-draft")
        self.assertEqual(again["existing"]["comment_no"], comment["comment_no"])

        detail = self.get(f"/api/actions/{aid}")
        linked = next(x for x in detail["recipients"] if x["id"] == rid)
        self.assertEqual(linked["generated_comment_no"], comment["comment_no"])

        self.delete(f"/api/comments/{comment['id']}")
        self.delete(f"/api/actions/recipients/{rid}")
        self.delete(f"/api/actions/{aid}")

    def test_56_action_status_history_and_compliance_guard(self):
        a = self.post("/api/actions", {
            "item_type": "Compliance Check", "standard_id": 1, "title": "核查测试",
            "description": "d", "current_status": "Open",
            "check_owner": "陈晓宇", "check_due_date": "2026-09-30"})
        aid = a["id"]

        # 没有 Check Result 时不允许置为完成
        r = self.c.post(f"/api/actions/{aid}/status-history", json={
            "new_value": "Completed", "effective_date": "2026-08-12"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "check_result")

        self.put(f"/api/actions/{aid}", {"check_result": "Compliant"})
        res = self.post(f"/api/actions/{aid}/status-history", {
            "new_value": "Completed", "effective_date": "2026-08-12", "note": "核查通过"})
        self.assertEqual(res["history"]["previous_value"], "Open")
        self.assertEqual(res["action"]["current_status"], "Completed")
        self.delete(f"/api/actions/{aid}")

    def test_57_action_create_accepts_every_item_type(self):
        """五类事项都能建档；类型缺失时报出可选值，便于前端定位。"""
        payloads = {
            "Survey Feedback": {"requesting_body": "SC27 秘书处",
                                "submission_due_date": "2026-09-01"},
            "Collect Comments": {"recipients": [{"respondent_team": "电池研发部",
                                                 "response_status": "Open"}]},
            "Lobby with Drafter": {"drafter_counterpart": "中汽研 王工",
                                   "target_position": "希望放宽过渡期"},
            "Compliance Check": {"check_owner": "李静", "check_due_date": "2026-09-30"},
            "Others": {"coordinator": "李静"},
        }
        for item_type, extra in payloads.items():
            created = self.post("/api/actions", dict(
                {"item_type": item_type, "standard_id": 1, "title": f"{item_type} 建档",
                 "description": "d", "current_status": "Open"}, **extra))
            self.assertEqual(created["item_type"], item_type)
            self.assertTrue(created["item_no"].startswith("AI-"))
            self.delete(f"/api/actions/{created['id']}")

        for payload in ({"standard_id": 1, "title": "t", "description": "d"},
                        {"item_type": "", "standard_id": 1, "title": "t",
                         "description": "d"},
                        {"item_type": "问卷 / 意见上达", "standard_id": 1,
                         "title": "t", "description": "d"}):
            r = self.c.post("/api/actions", json=payload, headers=HEADERS)
            self.assertEqual(r.status_code, 400, payload)
            body = r.get_json()
            self.assertEqual(body["field"], "item_type")
            self.assertIn("Survey Feedback", body["detail"])

    def test_57b_submission_channel_is_a_fixed_value(self):
        """上达渠道是四个固定值，不走机构字典。"""
        self.assertEqual(self.get("/api/meta")["submission_channels"],
                         ["邮件", "系统平台", "会议", "函件"])
        a = self.post("/api/actions", {
            "item_type": "Survey Feedback", "standard_id": 1, "title": "上达渠道",
            "description": "d", "current_status": "Open",
            "requesting_body": "SC27 秘书处", "submission_due_date": "2026-09-01",
            "submission_channel": "邮件"})
        self.assertEqual(a["submission_channel"], "邮件")
        self.delete(f"/api/actions/{a['id']}")

        # 机构名（以前误接字典时能存进来）现在会被挡住，并报出可选值
        r = self.c.post("/api/actions", json={
            "item_type": "Survey Feedback", "standard_id": 1, "title": "上达渠道",
            "description": "d", "current_status": "Open",
            "requesting_body": "SC27 秘书处", "submission_due_date": "2026-09-01",
            "submission_channel": "全国汽标委"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "submission_channel")
        self.assertIn("系统平台", r.get_json()["detail"])

        # 意见矩阵的提交渠道同样校验
        r = self.c.post("/api/comments", json={
            "standard_id": 1, "comment_text": "t", "rationale": "r",
            "status": "Draft", "submitted_by": "测试员",
            "submission_channel": "微信"}, headers=HEADERS)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "submission_channel")

    def test_58_action_type_is_immutable(self):
        a = self.post("/api/actions", {
            "item_type": "Others", "title": "类型不可变", "description": "d",
            "current_status": "Open", "coordinator": "李静"})
        after = self.put(f"/api/actions/{a['id']}", {"item_type": "Survey Feedback"})
        self.assertEqual(after["item_type"], "Others")
        self.delete(f"/api/actions/{a['id']}")

    # -------------------------------------------------- 字典
    def test_60_lookup_crud(self):
        grouped = self.get("/api/lookups")
        self.assertIn("person", grouped)
        self.assertTrue(grouped["impact_area"])

        row = self.post("/api/lookups/person", {"value": "字典维护测试员", "note": "法规部"})
        self.assertEqual(row["category"], "person")
        # 重复新增返回已有行而不是报错（下拉框现场新增会遇到）
        again = self.post("/api/lookups/person", {"value": "字典维护测试员"}, status=200)
        self.assertEqual(again["id"], row["id"])

        self.put(f"/api/lookups/{row['id']}", {"is_active": 0})
        actives = [r["value"] for r in self.get("/api/lookups/person")]
        self.assertNotIn("字典维护测试员", actives)
        alls = [r["value"] for r in self.get("/api/lookups/person?all=1")]
        self.assertIn("字典维护测试员", alls)

        self.delete(f"/api/lookups/{row['id']}")
        self.get("/api/lookups/不存在的类别", status=404)

    def test_61_operator_name_survives_header_encoding(self):
        """HTTP 头只允许 ISO-8859-1，中文操作人必须编码传输、后端解码还原。"""
        # 浏览器实际发出的形式：全部为 ASCII，不会触发 fetch 的编码错误
        self.assertTrue(HEADERS["X-User"].isascii())

        std = self.post("/api/standards", {
            "std_no": "GB/T 77766—2026", "name_cn": "请求头编码测试",
            "stage_code": "DRAFTING", "stage_effective_date": "2026-07-01"})
        self.assertEqual(std["created_by"], USER)

        res = self.post(f"/api/standards/{std['id']}/stages",
                        {"stage_code": "COMMENT_DRAFT", "effective_date": "2026-08-01"})
        self.assertEqual(res["record"]["created_by"], USER)

        # 纯英文名不编码也应原样通过
        r = self.c.post(f"/api/standards/{std['id']}/stages",
                        json={"stage_code": "REVIEW_DRAFT", "effective_date": "2026-08-02"},
                        headers={"X-User": "plain-ascii"})
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual(r.get_json()["record"]["created_by"], "plain-ascii")

        self.delete(f"/api/standards/{std['id']}")

    # -------------------------------------------------------- 数据交换
    def _export(self, user):
        r = self.c.get(f"/api/transfer/export?user={quote(user)}", headers=HEADERS)
        self.assertEqual(r.status_code, 200)
        return r.data

    def _upload(self, url, package, **form):
        return self.c.post(
            url, headers=HEADERS, content_type="multipart/form-data",
            data={"file": (io.BytesIO(package), "package.json"), **form})

    def test_63_export_package_is_self_contained(self):
        """按登记人导出时，引用到的别人的标准、会议、草案要一并带上，否则对方导入后外键落空。"""
        package = json.loads(self._export("张伟").decode("utf-8"))
        tables = package["tables"]
        self.assertEqual(package["format"], "regtrack-user-data")
        # 张伟自己只建了一项标准，但他的事项、意见挂在别人建的标准上
        own = {r["id"] for r in tables["standard"] if r["created_by"] == "张伟"}
        self.assertEqual(len(own), 1)
        self.assertGreater(len(tables["standard"]), len(own))
        ids = {table: {r["id"] for r in rows if "id" in r} for table, rows in tables.items()}
        for row in tables["action_item"]:
            self.assertIn(row["standard_id"], ids["standard"])
        for row in tables["comment"]:
            self.assertIn(row["standard_id"], ids["standard"])
        for row in tables["draft"]:
            self.assertIn(row["standard_id"], ids["standard"])
        # 带出来的标准也带上它的阶段历史，对方看到的不是一条没有时间轴的标准
        for standard_id in ids["standard"]:
            self.assertTrue([r for r in tables["standard_stage_history"]
                             if r["standard_id"] == standard_id], standard_id)
        # 同一条关联被两条收集规则各带一次的重复已经去掉
        links = [(r["meeting_id"], r["standard_id"]) for r in tables["meeting_standard"]]
        self.assertEqual(len(links), len(set(links)))

    def test_64_import_renumbers_and_merges(self):
        """导入不再保留原 id：重新编号后记录真的看得见，唯一约束命中则合并。"""
        package = self._export("张伟")
        info = self._upload("/api/transfer/inspect", package).get_json()
        self.assertEqual(info["user"], "张伟")
        self.assertTrue(info["matched"])
        self.assertIn("张伟", info["people"])
        self.assertGreater(info["total"], 0)

        # 不确认登记人不给导
        r = self._upload("/api/transfer/import", package)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json()["field"], "as_user")

        before = self.get("/api/standards?page_size=100")["total"]
        actions_before = self.get("/api/actions?page_size=100")["total"]
        res = self._upload("/api/transfer/import", package,
                           as_user="Wang, Xuesong").get_json()
        self.assertTrue(res["ok"])
        self.assertEqual(res["skipped"], 0)
        self.assertGreater(res["inserted"], 0)

        # 标准编号已存在 → 合并，不重复建档
        self.assertEqual(self.get("/api/standards?page_size=100")["total"], before)
        merged = {r["table"]: r for r in res["tables"]}
        self.assertEqual(merged["standard"]["inserted"], 0)
        self.assertGreater(merged["standard"]["merged"], 0)

        # 事项没有可靠的自然键 → 作为新记录进来，并且真的查得到
        after = self.get("/api/actions?page_size=100")
        self.assertGreater(after["total"], actions_before)
        mine = [a for a in after["items"] if a["created_by"] == "Wang, Xuesong"]
        self.assertEqual(len(mine), merged["action_item"]["inserted"])
        # 业务编号本机已占用的，重新取号，不会顶掉原记录
        self.assertEqual(len({a["item_no"] for a in after["items"]}), after["total"])
        # 关联的标准指向本机已有的那条，不是悬空 id
        for a in mine:
            self.assertTrue(a["std_no"])
            self.get(f"/api/actions/{a['id']}")
        # 选定的操作人自动进人员字典，之后切换操作人能选到
        self.assertIn("Wang, Xuesong",
                      [x["value"] for x in self.get("/api/lookups/person")])
        for a in mine:
            self.delete(f"/api/actions/{a['id']}")

    def test_65_import_rejects_packages_from_other_tools(self):
        r = self._upload("/api/transfer/import", b'{"format":"something-else"}',
                         as_user="测试员")
        self.assertEqual(r.status_code, 400)
        self.assertIn("数据交换包", r.get_json()["error"])
        r = self._upload("/api/transfer/inspect", b"not json at all")
        self.assertEqual(r.status_code, 400)

    def test_62_modal_navigation_contract(self):
        """前端弹窗遵守关闭方式、单向跳转和层级保护约定。"""
        root = Path(__file__).resolve().parent.parent
        core = (root / "static/js/core.js").read_text(encoding="utf-8")
        records = (root / "static/js/records.js").read_text(encoding="utf-8")

        self.assertNotIn("btn-close", core)
        self.assertIn('title="返回 ${esc(back)}">返回</button>', core)
        self.assertNotIn("返回<span", core)
        self.assertIn("{ keyboard: false, backdrop: true }", core)
        self.assertIn('window.addEventListener("popstate"', core)
        self.assertIn('const MODAL_GUARD = "regtrackModalGuard"', core)
        self.assertIn("ensureModalGuard();", core)
        self.assertNotIn("{ regtrackModal: id }", core)
        self.assertIn("const MAX_RECORD_DEPTH = 4", records)
        self.assertIn("recordLayers.findIndex", records)

        # 只读展示的字段声明 submit 后必须随表单一起提交，
        # 否则从「新建 xx 事项」「会议行内派生」进来的事项会漏掉 item_type。
        forms = (root / "static/js/forms.js").read_text(encoding="utf-8")
        action_form = (root / "static/js/action-form.js").read_text(encoding="utf-8")
        self.assertIn("if (f.submit) out[f.name]", forms)
        self.assertNotIn('if (f.section || f.type === "auto" || f.readOnly) return;', forms)
        self.assertIn('name: "item_type", label: "Item Type", cn: "事项类型", '
                      'type: "auto", submit: true', action_form)
        self.assertIn("if (isNew && !payload.item_type)", action_form)

        # 左侧导航固定在视口上，弹窗的滚动锁不得改动 body 的宽度。
        css = (root / "static/css/app.css").read_text(encoding="utf-8")
        rail = css[css.index(".rail {"):css.index(".rail-brand")]
        self.assertIn("position: fixed", rail)
        self.assertNotIn("position: sticky", rail)
        self.assertIn("margin-left: var(--rail-w)", css)
        self.assertIn("padding-right: 0 !important", css)
        self.assertIn("html.modal-lock", css)
        self.assertIn('classList.toggle("modal-lock", modalLayers.length > 0)', core)

        # 上达渠道走固定值下拉，不再误接机构字典
        self.assertIn('name: "submission_channel", label: "Submission Channel", '
                      'cn: "上达渠道", type: "fixed", options: M.submission_channels',
                      action_form)
        self.assertNotIn('name: "submission_channel", label: "Submission Channel", '
                         'cn: "上达渠道", type: "lookup"', action_form)

        # 阶段分布改横向细柱，风险等级图与 3D 饼图一并移除
        charts = (root / "static/js/charts.js").read_text(encoding="utf-8")
        dashboard = (root / "static/js/pages/dashboard.js").read_text(encoding="utf-8")
        self.assertIn("window.Charts = { bars, donut };", charts)
        self.assertNotIn("pie3d", charts)
        self.assertIn("Charts.bars(document.getElementById(\"chart-stage\")", dashboard)
        self.assertNotIn("chart-risk", dashboard)

        # 沉浸查看改用铺满视口的覆盖层：浏览器全屏只绘制全屏元素，
        # 弹窗挂在 body 下会整个看不见。
        lifecycle = (root / "static/js/pages/lifecycle.js").read_text(encoding="utf-8")
        dashboard_css = (root / "static/css/dashboard.css").read_text(encoding="utf-8")
        self.assertIn("fullscreenBtn.onclick = () => setImmersive(!isImmersive())", lifecycle)
        self.assertNotIn('document.addEventListener("fullscreenchange"', lifecycle)
        self.assertNotIn("document.exitFullscreen()", lifecycle)
        self.assertIn('panel.classList.toggle("is-immersive", active)', lifecycle)
        self.assertIn(".lc-panel.is-immersive", dashboard_css)
        self.assertNotIn(".lc-panel:fullscreen", dashboard_css)

        # 下拉箭头是右侧的背景图，压缩内边距时必须给它留位置
        app_css = (root / "static/css/app.css").read_text(encoding="utf-8")
        for block, rule in ((".filters .form-select", "padding-right: 28px"),
                            (".ts-wrapper.single .ts-control", "padding-right: 32px")):
            # 规则可能出现多次（基础样式 + 专门留箭头位置的那条），只要有一条声明了就行
            self.assertTrue(any(rule in app_css[i:i + 240]
                                for i in _positions(app_css, block + " {\n")), block)
        self.assertIn("padding-right: 28px", dashboard_css)

        # 概况卡的关键字段排在标准名称右侧，纵向空间留给泳道
        self.assertIn('</div>\n        <dl class="lc-facts">', lifecycle)
        self.assertIn("justify-content: flex-end", dashboard_css)

        # 柱状图：数量贴着柱尾走，柱体带刻度
        self.assertIn('<b class="bar-val in">', charts)
        self.assertIn('<b class="bar-val out">', charts)
        self.assertIn("repeating-linear-gradient", dashboard_css)

        # 取消挂载带批注的标准要先提醒，提示语与后端一致
        self.assertIn("Note 也将丢失", records)
        self.assertIn("drop_notes", records)
        self.assertIn('data-note="${s.id}"', records)

        # 导入必须先经过确认登记人的那一步
        settings = (root / "static/js/pages/settings.js").read_text(encoding="utf-8")
        self.assertIn("/api/transfer/inspect", settings)
        self.assertIn("confirmImport(file, info)", settings)
        self.assertIn("as_user", settings)

        # 反向来源字段只展示；允许的向下入口仍然存在。
        self.assertNotIn('openBtn("standard"', records)
        self.assertIn('openBtn("draft"', records)
        self.assertIn('openBtn("meeting"', records)
        self.assertIn('openBtn("action"', records)
        self.assertIn('openBtn("comment"', records)


if __name__ == "__main__":
    unittest.main(verbosity=2)
