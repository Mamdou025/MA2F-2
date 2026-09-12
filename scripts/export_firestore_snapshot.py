"""Read-only, fixed-read-time Firestore archive, including nested collections."""
import argparse
import concurrent.futures
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


class Exporter:
    def __init__(self, project, token, read_time):
        self.root = f"projects/{project}/databases/(default)/documents"
        self.token = token
        self.read_time = read_time

    def request(self, path, body=None, query=None):
        url = "https://firestore.googleapis.com/v1/" + urllib.parse.quote(path, safe="/():")
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(6):
            req = urllib.request.Request(url, data=data, headers={
                "Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=45) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 5:
                    raise RuntimeError(f"Firestore export failed: HTTP {error.code}") from None
                time.sleep(2 ** attempt)
            except (urllib.error.URLError, TimeoutError):
                if attempt == 5:
                    raise RuntimeError("Firestore export network retries exhausted") from None
                time.sleep(2 ** attempt)
        raise RuntimeError("Firestore export retries exhausted")

    def children(self, parent):
        collections, documents = [], []
        page = None
        tokens = set()
        while True:
            body = {"pageSize": 1000, "readTime": self.read_time}
            if page:
                body["pageToken"] = page
            result = self.request(parent + ":listCollectionIds", body=body)
            collections.extend(result.get("collectionIds", []))
            page = result.get("nextPageToken")
            if not page:
                break
            if page in tokens:
                raise RuntimeError("Repeated collection page token")
            tokens.add(page)
        print(json.dumps({"collectionsDiscovered": len(collections)}), flush=True) if parent == self.root else None
        for collection in sorted(collections):
            page = None
            tokens = set()
            while True:
                query = {"pageSize": 100, "readTime": self.read_time, "showMissing": "true"}
                if page:
                    query["pageToken"] = page
                result = self.request(parent + "/" + collection, query=query)
                documents.extend(result.get("documents", []))
                page = result.get("nextPageToken")
                if not page:
                    break
                if page in tokens:
                    raise RuntimeError("Repeated document page token")
                tokens.add(page)
            print(json.dumps({"rootDocumentsRead": len(documents)}), flush=True) if parent == self.root else None
        return [parent + "/" + c for c in collections], documents

    def export(self):
        documents, missing, collections, seen = [], [], [], set()
        pending = [self.root]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            while pending:
                following = []
                for paths, children in pool.map(self.children, pending):
                    collections.extend(paths)
                    for document in children:
                        name = document["name"]
                        if name in seen or not name.startswith(self.root + "/"):
                            raise RuntimeError("Duplicate or foreign document path")
                        seen.add(name)
                        following.append(name)
                        if "createTime" not in document and "updateTime" not in document:
                            missing.append(name)
                        else:
                            documents.append(document)
                pending = following
                print(json.dumps({"documents": len(documents), "missingParents": len(missing),
                                  "collections": len(collections), "parentsToInspect": len(pending)}), flush=True)
        return {"project": self.root.split("/")[1], "readTime": self.read_time,
                "documents": sorted(documents, key=lambda d: d["name"]),
                "missingParents": sorted(missing), "collections": sorted(collections)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    token = subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    read_time = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=10)).isoformat(timespec="microseconds").replace("+00:00", "Z")
    result = Exporter(args.project, token, read_time).export()
    raw = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()
    compressed = gzip.compress(raw, mtime=0)
    output = Path(args.output_dir)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = read_time.replace(":", "").replace(".", "")
    archive = output / f"business-source-{stamp}.json.gz"
    with os.fdopen(os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(compressed)
    manifest = {"archive": archive.name, "project": args.project, "readTime": read_time,
                "sha256": hashlib.sha256(compressed).hexdigest(), "bytes": len(compressed),
                "documents": len(result["documents"]), "collections": len(result["collections"]),
                "missingParents": len(result["missingParents"]), "firestoreComplete": True,
                "storageFilesIncluded": False}
    with os.fdopen(os.open(str(archive) + ".manifest.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
        json.dump(manifest, stream, indent=2)
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()
