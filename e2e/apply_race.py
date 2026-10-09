"""P0 regression (QA r1): the same previewId applied by many requests at once must import exactly once.
Run against a fresh DB:  python e2e/apply_race.py   (E2E_API=http://localhost:5083 for other ports)
For each of 3 rounds: upload a distinct 3-row xlsx, fire 10 concurrent apply calls with the same previewId.
Expect: exactly one 200, the rest 410, +3 lots, exactly one StockImportBatch for that file.
Then the 409 duplicate-file case, and finally SUM(movement) == RemainingQty over the whole DB (if --db is given)."""
import json, os, sqlite3, sys, tempfile, threading, urllib.request, uuid
import openpyxl

API = os.environ.get("E2E_API", "http://localhost:5080")
OK = []


def check(name, ok, detail=""):
    OK.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def call(method, path, token=None, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, method=method, data=data)
    if data is not None:
        req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null")


def make_xlsx(tag):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "นำเข้า"
    ws.append(["รหัสสินค้า", "จำนวน", "วันหมดอายุ (yyyy-mm-dd)"])
    for i, code in enumerate(["MILK-001", "YOG-001", "EGG-001"]):
        ws.append([code, 10 + tag + i, "2027-07-01"])
    path = os.path.join(tempfile.mkdtemp(prefix="race-"), f"race-{tag}.xlsx")
    wb.save(path)
    return path


def preview(token, path):
    b = uuid.uuid4().hex
    content = open(path, "rb").read()
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\n'
            f'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n').encode() + content + f"\r\n--{b}--\r\n".encode()
    return call("POST", "/api/stock-imports/preview", token, raw=body, ctype=f"multipart/form-data; boundary={b}")


def lots():
    _, d = call("GET", "/api/products?pageSize=100")
    return sum(p["stock"] for p in d["items"])


def main():
    _, t = call("POST", "/api/auth/login", body={"email": "staff@example.com", "password": "Test1234!"})
    tok = t["token"]
    first_file = None
    for rnd in range(1, 4):
        path_r = make_xlsx(rnd * 100)
        first_file = first_file or path_r
        st, pv = preview(tok, path_r)
        pid = pv["previewId"]
        before = lots()
        _, b0 = call("GET", "/api/stock-imports/batches", tok)
        res = []
        barrier = threading.Barrier(10)

        def go():
            barrier.wait()
            res.append(call("POST", "/api/stock-imports/apply", tok, {"previewId": pid})[0])
        ts = [threading.Thread(target=go) for _ in range(10)]
        [x.start() for x in ts]
        [x.join() for x in ts]
        _, b1 = call("GET", "/api/stock-imports/batches", tok)
        added = lots() - before
        expect = sum(10 + rnd * 100 + i for i in range(3))
        check(f"round {rnd}: exactly one 200 of 10", res.count(200) == 1 and res.count(410) == 9, str(sorted(res)))
        check(f"round {rnd}: stock +{expect} (one import)", added == expect, f"+{added}")
        check(f"round {rnd}: one new batch", len(b1) - len(b0) == 1, f"{len(b0)} -> {len(b1)}")
        st, _ = call("POST", "/api/stock-imports/apply", tok, {"previewId": pid})
        check(f"round {rnd}: apply again afterwards -> 410", st == 410, str(st))

    # duplicate-file path: 409 hands the preview back so confirmDuplicate can still be sent
    st, pv = preview(tok, first_file)  # the very same bytes as round 1 -> same SHA-256
    check("duplicate file preview flagged", pv.get("duplicateFile") is True)
    st, _ = call("POST", "/api/stock-imports/apply", tok, {"previewId": pv["previewId"]})
    check("duplicate without confirm -> 409", st == 409, str(st))
    st, d = call("POST", "/api/stock-imports/apply", tok, {"previewId": pv["previewId"], "confirmDuplicate": True})
    check("same previewId + confirmDuplicate afterwards -> 200 (preview was given back)", st == 200, str(st))

    # owner check still works and does not burn the preview
    _, t2 = call("POST", "/api/auth/login", body={"email": "staff2@example.com", "password": "Test1234!"})
    st, pv = preview(tok, make_xlsx(777))
    st2, _ = call("POST", "/api/stock-imports/apply", t2["token"], {"previewId": pv["previewId"]})
    st3, _ = call("POST", "/api/stock-imports/apply", tok, {"previewId": pv["previewId"]})
    check("other staff -> 403, then owner still gets 200", st2 == 403 and st3 == 200, f"{st2}/{st3}")

    if len(sys.argv) > 2 and sys.argv[1] == "--db":
        c = sqlite3.connect(sys.argv[2])
        bad = c.execute("select l.Id, coalesce((select sum(Qty) from StockMovements m where m.StockLotId=l.Id),0), l.RemainingQty from StockLots l").fetchall()
        bad = [r for r in bad if r[1] != r[2]]
        dup = c.execute("select count(*) from (select PreviewId from StockImportBatches where PreviewId is not null group by PreviewId having count(*)>1)").fetchone()[0]
        check("reconcile: SUM(movement)==RemainingQty for every lot", not bad, str(bad[:3]))
        check("no two batches share a PreviewId", dup == 0)
    print(f"\n{sum(OK)}/{len(OK)} PASS")
    sys.exit(0 if all(OK) else 1)


main()
