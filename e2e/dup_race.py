"""N1 regression (QA r2): several previews of the SAME file applied at the same instant must import once.
Rule implemented: a preview remembers how many batches of that file existed when it was made (KnownBatches).
Inside the per-hash lock + transaction, apply compares with the current count; if somebody imported in between -> 409
(restoring the preview), so even with confirmDuplicate=true only ONE of N concurrent confirms can win; the others must
re-check (re-preview) and confirm again on purpose.   Run on a fresh DB:  python e2e/dup_race.py  (E2E_API=http://localhost:5087)"""
import json, os, sys, tempfile, threading, urllib.request, uuid
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
    for i, code in enumerate(["MILK-001", "YOG-001"]):
        ws.append([code, 5 + tag + i, "2027-08-01"])
    path = os.path.join(tempfile.mkdtemp(prefix="dup-"), f"dup-{tag}.xlsx")
    wb.save(path)
    return path


def preview(token, path):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + open(path, "rb").read() + f"\r\n--{b}--\r\n".encode()
    return call("POST", "/api/stock-imports/preview", token, raw=body, ctype=f"multipart/form-data; boundary={b}")[1]["previewId"]


def batches(tok):
    return len(call("GET", "/api/stock-imports/batches", tok)[1])


def burst(tok, pids, confirm=False):
    res, barrier = [], threading.Barrier(len(pids))

    def go(pid):
        barrier.wait()
        res.append(call("POST", "/api/stock-imports/apply", tok, {"previewId": pid, "confirmDuplicate": confirm})[0])
    ts = [threading.Thread(target=go, args=(p,)) for p in pids]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return sorted(res)


tok = call("POST", "/api/auth/login", body={"email": "staff@example.com", "password": "Test1234!"})[1]["token"]
for n in (2, 5):
    for rnd in range(1, 6):
        path = make_xlsx(n * 100 + rnd)
        pids = [preview(tok, path) for _ in range(n)]  # n previews of identical bytes, all made before any apply
        b0 = batches(tok)
        res = burst(tok, pids)
        check(f"{n} previews of one new file applied at once, round {rnd}: one 200, rest 409", res.count(200) == 1 and res.count(409) == n - 1, str(res))
        check(f"{n} previews round {rnd}: exactly one new batch", batches(tok) - b0 == 1)

# confirmDuplicate: the file exists once. 5 previews (all see 1 known batch) confirm at once.
path = make_xlsx(900)
first = preview(tok, path)
call("POST", "/api/stock-imports/apply", tok, {"previewId": first})
pids = [preview(tok, path) for _ in range(5)]
b0 = batches(tok)
res = burst(tok, pids, confirm=True)
check("5 concurrent confirmDuplicate=true: exactly one wins, the others get 409 (must re-check)", res.count(200) == 1 and res.count(409) == 4, str(res))
check("...and only one extra batch was created", batches(tok) - b0 == 1)
pid = preview(tok, path)  # fresh preview now knows the new batch count
st, _ = call("POST", "/api/stock-imports/apply", tok, {"previewId": pid, "confirmDuplicate": True})
check("a fresh preview + confirmDuplicate afterwards still works (deliberate re-import)", st == 200, str(st))
pid = preview(tok, path)
st, d = call("POST", "/api/stock-imports/apply", tok, {"previewId": pid})
check("without confirmDuplicate -> 409 duplicate", st == 409 and d.get("duplicateFile"), str(st))
print(f"\n{sum(OK)}/{len(OK)} PASS")
sys.exit(0 if all(OK) else 1)
