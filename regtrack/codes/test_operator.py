from testdb import new_database
"""Operators can be added from Settings; they live in the shared person dictionary."""
import tempfile
import unittest
from pathlib import Path

from app import create_app
from testdb import initialize as init_db


class OperatorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        path = new_database()
        init_db(path, with_seed=False)
        self.client = create_app(path).test_client()

    def test_settings_page_offers_adding_an_operator(self):
        html = self.client.get("/settings").get_data(as_text=True)
        for marker in ('id="operator-add-form"', 'id="operator-new-name"', 'id="operator-new-note"'):
            self.assertIn(marker, html)

    def test_added_operator_is_listed_once_with_department(self):
        created = self.client.post("/api/lookups/person", json={"value": "王学松", "note": "标准法规部"},
                                   headers={"X-User": "Tester"})
        self.assertEqual(created.status_code, 201, created.json)
        again = self.client.post("/api/lookups/person", json={"value": "王学松"}, headers={"X-User": "Tester"})
        self.assertEqual(again.status_code, 200)
        people = [p for p in self.client.get("/api/lookups").json["person"] if p["value"] == "王学松"]
        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]["note"], "标准法规部")
        self.assertEqual(self.client.post("/api/lookups/person", json={"value": "  "}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
