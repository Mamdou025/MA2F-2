import unittest
from export_firestore_snapshot import Exporter


class SnapshotTest(unittest.TestCase):
    def test_pagination_missing_parent_and_nested_collection(self):
        exporter = Exporter("fixture", "unused", "2026-09-09T00:00:00.000000Z")
        root = exporter.root
        calls = []

        def request(path, body=None, query=None):
            options = body if body is not None else query
            calls.append((path, options.copy()))
            self.assertEqual(options["readTime"], exporter.read_time)
            if path == root + ":listCollectionIds":
                return {"collectionIds": ["records"], "nextPageToken": "collections2"} if "pageToken" not in options else {"collectionIds": ["empty"]}
            if path == root + "/records":
                self.assertEqual(options["showMissing"], "true")
                return {"documents": [{"name": root + "/records/missing"}], "nextPageToken": "docs2"} if "pageToken" not in options else {"documents": [{"name": root + "/records/existing", "createTime": "time", "fields": {"exact": {"integerValue": "9007199254740993"}}}]}
            if path == root + "/records/missing:listCollectionIds":
                return {"collectionIds": ["children"]}
            if path == root + "/records/missing/children":
                return {"documents": [{"name": root + "/records/missing/children/child", "createTime": "time", "fields": {}}]}
            return {}

        exporter.request = request
        result = exporter.export()
        self.assertEqual(len(result["documents"]), 2)
        self.assertEqual(result["missingParents"], [root + "/records/missing"])
        self.assertEqual(len(result["collections"]), 3)
        self.assertEqual(result["documents"][0]["fields"]["exact"]["integerValue"], "9007199254740993")
        self.assertTrue(any(options.get("pageToken") == "docs2" for _, options in calls))

    def test_duplicate_path_stops_archive(self):
        exporter = Exporter("fixture", "unused", "fixed")
        item = {"name": exporter.root + "/items/id", "createTime": "time"}
        exporter.children = lambda parent: ([], [item, item])
        with self.assertRaisesRegex(RuntimeError, "Duplicate"):
            exporter.export()


if __name__ == "__main__":
    unittest.main()
