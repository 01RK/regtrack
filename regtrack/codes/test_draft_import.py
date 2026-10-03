"""End-to-end coverage for chapter import, annotation editing and replacement."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.drawing.image import Image
from PIL import Image as PillowImage

from app import create_app, init_db

TEMPLATE = (Path(__file__).resolve().parents[2] / "extra-req"
            / "V13_2_0_Standard_Clause_Import_Template 1.xlsx")


class DraftImportTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.db = Path(self.folder.name) / "draft.db"
        init_db(self.db, with_seed=True)
        self.client = create_app(self.db).test_client()

    def tearDown(self):
        self.folder.cleanup()

    def upload(self, target=None, filename=TEMPLATE.name, content=None):
        body = {"file": (io.BytesIO(TEMPLATE.read_bytes() if content is None else content), filename)}
        if target is not None:
            body["target"] = json.dumps(target)
        route = "/api/drafts/imports" if target is not None else "/api/drafts/imports/read"
        return self.client.post(route, data=body, content_type="multipart/form-data",
                                headers={"X-User": "Reviewer"})

    def target(self):
        return {"standard_id": 6, "version_name": "讨论稿", "sub_version_no": "1.0",
                "draft_date": "2024-05-27"}

    def test_template_read_and_current_chapters(self):
        source = self.upload()
        self.assertEqual(source.status_code, 200)
        self.assertEqual(source.json["chapter_count"], 21)
        self.assertEqual(source.json["standards"][0]["std_no"], "GB 38031-20XX")
        result = self.upload(self.target())
        self.assertEqual(result.status_code, 201, result.json)
        draft = self.client.get(f"/api/drafts/{result.json['draft_id']}").json
        self.assertEqual(self.client.get("/api/standards/6").json["name_cn"], "电动汽车用动力蓄电池安全要求")
        self.assertEqual(draft["imports"][0]["source_version"], "测试草案 2024-05-27")
        self.assertEqual(len(draft["chapters"]), 21)
        self.assertEqual(draft["chapters"][10]["clause_no"], "5.2.1")
        excel_annotation = next(a for a in draft["annotations"] if a["clause_no"] == "5.2.1")
        self.assertEqual(excel_annotation["content"], "需确认交流电路绝缘要求")
        self.assertNotIn("origin", excel_annotation)
        self.assertEqual(draft["chapters"][17]["level"], 4)
        self.assertEqual(draft["chapters"][19]["clause_type"], "Annex")
        self.assertFalse(draft["chapters"][5]["content_cn"])
        self.assertEqual(self.client.get(f"/drafts/{draft['id']}").status_code, 200)

    def test_replacement_rebinds_selected_annotation_and_deletes_unselected(self):
        first = self.upload(self.target()).json
        draft_id = first["draft_id"]
        detail = self.client.get(f"/api/drafts/{draft_id}").json
        annotated_ids = {a["chapter_id"] for a in detail["annotations"] if a["chapter_id"] is not None}
        chapter = next(c for c in detail["chapters"] if c["id"] not in annotated_ids)
        annotation = self.client.post(f"/api/drafts/{draft_id}/annotations",
                                      json={"chapter_id": chapter["id"], "content": "人工核对振动要求"})
        self.assertEqual(annotation.status_code, 201)
        annotation_id = annotation.json["id"]
        self.assertIn("created_at", annotation.json)
        self.assertIn("updated_at", annotation.json)
        self.assertEqual(self.client.post(f"/api/drafts/{draft_id}/annotations",
                                          json={"chapter_id": chapter["id"], "content": "重复批注"}).status_code, 409)
        edited = self.client.put(f"/api/drafts/{draft_id}/annotations/{annotation_id}",
                                 json={"content": "已确认振动要求"})
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json["content"], "已确认振动要求")
        blocked = self.upload({"standard_id": 6, "draft_id": draft_id})
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(len(self.client.get(f"/api/drafts/{draft_id}").json["imports"]), 1)
        second = self.upload({"standard_id": 6, "draft_id": draft_id,
                              "replace_import_id": first["import_id"],
                              "keep_annotation_ids": [annotation_id],
                              "annotation_snapshot": {str(a["id"]): a["content"] for a in self.client.get(f"/api/drafts/{draft_id}").json["annotations"] if a["chapter_id"] is not None},
                              "comment_snapshot": []})
        self.assertEqual(second.status_code, 201, second.json)
        current = self.client.get(f"/api/drafts/{draft_id}").json
        self.assertEqual(len(current["chapters"]), 21)
        self.assertEqual(len(current["imports"]), 1)
        kept = next(a for a in current["annotations"] if a["content"] == "已确认振动要求")
        current_chapter = next(c for c in current["chapters"] if c["clause_no"] == chapter["clause_no"])
        self.assertEqual(kept["chapter_id"], current_chapter["id"])
        self.assertNotEqual(kept["chapter_id"], chapter["id"])
        self.assertEqual(kept["created_at"], annotation.json["created_at"])
        removed = self.upload({"standard_id": 6, "draft_id": draft_id,
                               "replace_import_id": second.json["import_id"],
                               "keep_annotation_ids": [],
                               "annotation_snapshot": {str(a["id"]): a["content"] for a in current["annotations"] if a["chapter_id"] is not None},
                               "comment_snapshot": []})
        self.assertEqual(removed.status_code, 201, removed.json)
        self.assertFalse(any(a["content"] == "已确认振动要求"
                             for a in self.client.get(f"/api/drafts/{draft_id}").json["annotations"]))

    def test_invalid_file_and_different_standard_assignment(self):
        self.assertEqual(self.upload(filename="bad.txt", content=b"not xlsx").status_code, 400)
        before = self.client.get("/api/standards/1").json["name_cn"]
        assigned = self.upload({**self.target(), "standard_id": 1, "sub_version_no": "assigned-from-file"})
        self.assertEqual(assigned.status_code, 201, assigned.json)
        detail = self.client.get(f"/api/drafts/{assigned.json['draft_id']}").json
        self.assertEqual(detail["standard_id"], 1)
        self.assertEqual(detail["imports"][0]["source_standard_no"], "GB 38031-20XX")
        self.assertEqual(self.client.get("/api/standards/1").json["name_cn"], before)
        self.assertEqual(self.client.get("/api/drafts/clauses/search").status_code, 404)

    def test_embedded_illustration_is_saved_served_and_exchanged(self):
        book = load_workbook(TEMPLATE)
        sheet = book["Import_Data"]
        sheet.insert_cols(11)
        sheet["K1"] = "Illustration"
        sheet["K2"] = "图 1 试验装置"
        raw_image = io.BytesIO()
        PillowImage.new("RGB", (18, 18), "blue").save(raw_image, "PNG")
        raw_image.seek(0)
        sheet.add_image(Image(raw_image), "K2")
        excel = io.BytesIO()
        book.save(excel)
        book.close()
        result = self.upload(self.target(), content=excel.getvalue())
        self.assertEqual(result.status_code, 201, result.json)
        draft_id = result.json["draft_id"]
        detail = self.client.get(f"/api/drafts/{draft_id}").json
        self.assertEqual(detail["chapters"][0]["illustration"], "图 1 试验装置")
        self.assertEqual(len(detail["illustrations"]), 1)
        image = detail["illustrations"][0]
        url = f"/api/drafts/{draft_id}/chapters/{image['chapter_id']}/illustrations/{image['id']}"
        self.assertTrue(self.client.get(url).data.startswith(b"\x89PNG"))
        exported = self.client.get("/api/transfer/export?user=Reviewer")
        with tempfile.TemporaryDirectory() as folder:
            other_db = Path(folder) / "other.db"
            init_db(other_db, with_seed=True)
            other = create_app(other_db).test_client()
            imported = other.post("/api/transfer/import", data={
                "file": (io.BytesIO(exported.data), "backup.json"), "as_user": "Reviewer",
            }, content_type="multipart/form-data")
            self.assertEqual(imported.status_code, 200, imported.json)
            transferred = other.get(f"/api/drafts/{draft_id}").json
            self.assertEqual(len(transferred["illustrations"]), 1)

    def test_changed_annotation_blocks_stale_import_and_removed_clause_deletes_formal_comment(self):
        first = self.upload(self.target()).json
        draft_id = first["draft_id"]
        formal = self.client.post("/api/comments", json={
            "standard_id": 6, "draft_id": draft_id, "clause_no": "5.1.2",
            "comment_text": "Formal feedback", "rationale": "Reason", "status": "Draft",
            "submitted_by": "Reviewer",
        })
        self.assertEqual(formal.status_code, 201, formal.json)
        book = load_workbook(TEMPLATE)
        sheet = book["Import_Data"]
        headers = {cell.value: cell.column for cell in sheet[1]}
        for row in list(sheet.iter_rows(min_row=2)):
            clause = row[headers["Clause_No"] - 1].value
            if clause == "5.2.1":
                row[headers["Initial_Comment"] - 1].value = "New imported note"
            elif clause == "5.1.2":
                sheet.delete_rows(row[0].row)
        output = io.BytesIO()
        book.save(output)
        content = output.getvalue()
        detail = self.client.get(f"/api/drafts/{draft_id}").json
        old = next(a for a in detail["annotations"] if a["clause_no"] == "5.2.1")
        target = {
            "standard_id": 6, "draft_id": draft_id, "replace_import_id": first["import_id"],
            "replace_annotation_ids": [old["id"]], "keep_annotation_ids": [],
            "annotation_snapshot": {str(a["id"]): a["content"] for a in detail["annotations"] if a["chapter_id"] is not None},
            "comment_snapshot": detail["linked_comments"],
        }
        edited = self.client.put(f"/api/drafts/{draft_id}/annotations/{old['id']}",
                                 json={"content": "A later edit"})
        self.assertEqual(edited.status_code, 200)
        stale = self.upload(target, content=content)
        self.assertEqual(stale.status_code, 409, stale.json)
        self.assertEqual(len(self.client.get(f"/api/drafts/{draft_id}").json["chapters"]), 21)
        target["annotation_snapshot"][str(old["id"])] = "A later edit"
        result = self.upload(target, content=content)
        self.assertEqual(result.status_code, 201, result.json)
        current = self.client.get(f"/api/drafts/{draft_id}").json
        self.assertEqual(len(current["chapters"]), 20)
        self.assertEqual(next(a for a in current["annotations"] if a["clause_no"] == "5.2.1")["content"], "New imported note")
        self.assertEqual(current["linked_comments"], [])
        self.assertEqual(self.client.get(f"/api/comments/{formal.json['id']}").status_code, 404)

    def test_data_exchange_keeps_existing_current_chapters(self):
        first = self.upload(self.target()).json
        draft_id = first["draft_id"]
        exported = self.client.get("/api/transfer/export?user=Reviewer")
        self.assertEqual(exported.status_code, 200)
        imported = self.client.post("/api/transfer/import", data={
            "file": (io.BytesIO(exported.data), "backup.json"), "as_user": "Reviewer",
        }, content_type="multipart/form-data")
        self.assertEqual(imported.status_code, 200, imported.json)
        current = self.client.get(f"/api/drafts/{draft_id}").json
        self.assertEqual(len(current["imports"]), 1)
        self.assertEqual(len(current["chapters"]), 21)
        self.assertEqual(len([a for a in current["annotations"] if a["chapter_id"] is not None]), 5)
        self.assertGreater(imported.json["skipped"], 0)
        with tempfile.TemporaryDirectory() as folder:
            other_db = Path(folder) / "other.db"
            init_db(other_db, with_seed=True)
            other = create_app(other_db).test_client()
            fresh_import = other.post("/api/transfer/import", data={
                "file": (io.BytesIO(exported.data), "backup.json"), "as_user": "Reviewer",
            }, content_type="multipart/form-data")
            self.assertEqual(fresh_import.status_code, 200, fresh_import.json)
            fresh_draft = other.get(f"/api/drafts/{draft_id}").json
            self.assertEqual(len(fresh_draft["imports"]), 1)
            self.assertEqual(len(fresh_draft["chapters"]), 21)
            self.assertEqual(len([a for a in fresh_draft["annotations"] if a["chapter_id"] is not None]), 5)

    def test_changed_formal_comment_blocks_stale_import(self):
        first = self.upload(self.target()).json
        draft_id = first["draft_id"]
        formal = self.client.post("/api/comments", json={
            "standard_id": 6, "draft_id": draft_id, "clause_no": "5.2.1",
            "comment_text": "Initial formal feedback", "rationale": "Reason",
            "submitted_by": "Reviewer",
        })
        self.assertEqual(formal.status_code, 201, formal.json)
        detail = self.client.get(f"/api/drafts/{draft_id}").json
        target = {
            "standard_id": 6, "draft_id": draft_id, "replace_import_id": first["import_id"],
            "annotation_snapshot": {str(a["id"]): a["content"] for a in detail["annotations"] if a["chapter_id"] is not None},
            "comment_snapshot": detail["linked_comments"],
        }
        changed = self.client.put(f"/api/comments/{formal.json['id']}", json={
            "comment_text": "Later formal feedback",
        })
        self.assertEqual(changed.status_code, 200, changed.json)
        stale = self.upload(target)
        self.assertEqual(stale.status_code, 409, stale.json)
        self.assertEqual(len(self.client.get(f"/api/drafts/{draft_id}").json["imports"]), 1)


if __name__ == "__main__":
    unittest.main()
