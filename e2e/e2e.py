"""End-to-end check of shop-cart (API :5080 + Next :3000). Run: python e2e/e2e.py  (other ports: E2E_WEB=http://localhost:3001 E2E_API=http://localhost:5081; needs `pip install playwright`).
Starts from a fresh DB (delete backend/ShopCart.Api/shopcart.db* and restart the API) because the rate limiter and stock are stateful.
Screenshots go to e2e/shots/ (git-ignored)."""
import json, os, re, sys, tempfile, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright, expect

WEB = os.environ.get("E2E_WEB", "http://localhost:3000")
API = os.environ.get("E2E_API", "http://localhost:5080")
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
DATA = os.path.join(HERE, "..", "backend", "testdata", "import")
os.makedirs(SHOTS, exist_ok=True)
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def jreq(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null")


def stocks():
    _, d = jreq("GET", "/api/products?pageSize=100")
    return {p["code"]: p["stock"] for p in d["items"]}


def seed_bulk():
    _, t = jreq("POST", "/api/auth/login", body={"email": "staff@example.com", "password": "Test1234!"})
    tok = t["token"]
    for i in range(1, 31):
        code = f"BULK-{i:03d}"
        s, p = jreq("POST", "/api/products", tok, {"code": code, "name": f"สินค้าทดสอบ {i:02d}", "type": "Bulk", "price": 10 + i})
        if s == 201:
            jreq("POST", "/api/stock-imports", tok, {"productCode": code, "qty": 10, "expDate": "2027-06-01"})


def lower_code_xlsx(qty):
    """xlsx with a lower-case product code (QA r1 P3: codes are case-insensitive)."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "นำเข้า"
    ws.append(["รหัสสินค้า", "จำนวน", "วันหมดอายุ (yyyy-mm-dd)"])
    ws.append(["milk-001", qty, "2027-05-01"])
    path = os.path.join(tempfile.mkdtemp(prefix="e2e-"), f"lower-code-{qty}.xlsx")
    wb.save(path)
    return path


def no_hscroll(page, name):
    w = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check(f"no horizontal overflow: {name}", w[0] <= w[1], f"scrollWidth={w[0]} innerWidth={w[1]}")


def login(page, who):
    page.goto(WEB + "/login")
    page.get_by_role("button", name="ใช้บัญชีนี้").nth(0 if who == "customer" else 1).click()
    page.get_by_role("button", name="เข้าสู่ระบบ").click()
    page.wait_for_url(re.compile(r"/(shop|admin/products)"))


def logout(page):
    page.get_by_role("button", name="ออกจากระบบ").click()
    page.wait_for_function("!document.body.innerText.includes('ออกจากระบบ')")


def shot(page, vp, name):
    page.screenshot(path=os.path.join(SHOTS, f"{vp}-{name}.png"), full_page=False)


def add_to_cart(page, code, extra=0):
    # 35 products / 24 per page: find the card the way a user would (server-side search by code)
    page.locator("#q").fill(code)
    page.wait_for_function("document.querySelectorAll('article').length === 1")
    card = page.locator(f'article[data-code="{code}"]')
    card.wait_for(state="visible")
    page.wait_for_timeout(600)
    for _ in range(extra):
        card.get_by_role("button", name="เพิ่มจำนวน").click()
    card.get_by_role("button", name="เพิ่มลงตะกร้า").click()


def run(pw, vp_name, size):
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport=size)
    ctx.set_default_timeout(30000)
    page = ctx.new_page()
    errors = []
    # 403/409/429 "Failed to load resource" lines are the browser logging the negative-path responses this test provokes on purpose
    expected = re.compile(r"Failed to load resource: the server responded with a status of (403|409|429)")
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not expected.search(m.text) else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    bad_resp = []
    page.on("response", lambda r: bad_resp.append(f"{r.status} {r.url}") if r.status >= 500 else None)
    tag = lambda s: f"[{vp_name}] {s}"

    # ---------- customer: login -> shop -> 3 pcs -> cart -> order -> /orders ----------
    login(page, "customer")
    ck = {c["name"]: c for c in ctx.cookies()}
    check(tag("cookie token is httpOnly"), "token" in ck and ck["token"]["httpOnly"] and ck["token"]["sameSite"] == "Lax", json.dumps({k: ck["token"][k] for k in ("httpOnly", "sameSite", "secure")}) if "token" in ck else "no cookie")
    check(tag("token not readable from JS"), page.evaluate("!document.cookie.includes('token') && !JSON.stringify(localStorage).includes('eyJ')"))
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    stock_before = stocks()
    add_to_cart(page, "MILK-001", extra=2)
    page.wait_for_timeout(1200)
    badge = page.locator(".cart-badge:visible").first
    check(tag("badge shows 3 after adding 3"), badge.inner_text().strip() == "3", badge.inner_text().strip())
    shot(page, vp_name, "shop-after-add")
    no_hscroll(page, "/shop")
    page.locator("a:visible", has_text="ตะกร้า").first.click()
    page.wait_for_url("**/cart")
    check(tag("cart row present"), page.locator('[data-row="MILK-001"]').count() == 1)
    shot(page, vp_name, "cart")
    no_hscroll(page, "/cart")
    page.get_by_role("button", name="สั่งซื้อ", exact=True).click()
    page.wait_for_url(re.compile(r"/orders\?open="))
    page.locator("[data-order]").first.wait_for()
    txt = page.locator("[data-order]").first.inner_text()
    check(tag("order visible in /orders"), "ORD-" in txt and "135" in txt.replace(",", ""), txt.replace("\n", " | ")[:80])
    shot(page, vp_name, "orders")
    no_hscroll(page, "/orders")
    sb = stocks()
    check(tag("stock cut FEFO (milk -3)"), sb["MILK-001"] == stock_before["MILK-001"] - 3, f"{stock_before['MILK-001']} -> {sb['MILK-001']}")

    # ---------- customer is 403 on /admin ----------
    r = page.goto(WEB + "/admin/products")
    check(tag("customer /admin/products -> HTTP 403 page"), r.status == 403 and "403" in page.inner_text("body"), f"status={r.status}")
    shot(page, vp_name, "customer-403")

    # ---------- over-stock -> 409 box ----------
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    page.evaluate("""() => localStorage.setItem('cart:customer@example.com', JSON.stringify([{productId:2,code:'YOG-001',name:'โยเกิร์ตรสธรรมชาติ',price:18,qty:999}]))""")
    page.goto(WEB + "/cart")
    page.get_by_role("button", name="สั่งซื้อ", exact=True).click()
    page.get_by_text("สั่งซื้อยังไม่สำเร็จ").wait_for()
    body = page.inner_text("body")
    check(tag("409 box shows shortage + fit button"), "ขายได้ " in body and "ปรับเป็น" in body and "ตะกร้าของคุณยังอยู่ครบ" in body)
    check(tag("stock unchanged after 409"), stocks()["YOG-001"] == sb["YOG-001"])
    shot(page, vp_name, "cart-409")
    no_hscroll(page, "/cart 409")
    page.get_by_role("button", name="ปรับเป็น").first.click()
    page.wait_for_function("!document.body.innerText.includes('สั่งซื้อยังไม่สำเร็จ')")
    check(tag("fit clears error"), True)
    page.evaluate("localStorage.removeItem('cart:customer@example.com')")
    logout(page)

    # ---------- staff: can shop + admin ----------
    login(page, "staff")
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    add_to_cart(page, "BRD-001")
    page.wait_for_timeout(800)
    page.locator("a:visible", has_text="ตะกร้า").first.click()
    page.wait_for_url("**/cart")
    page.get_by_role("button", name="สั่งซื้อ", exact=True).click()
    page.wait_for_url(re.compile(r"/orders\?open="))
    page.locator("[data-order]").first.wait_for()
    check(tag("staff can buy"), page.locator("[data-order]").count() >= 1)
    r = page.goto(WEB + "/admin/products")
    page.locator("tr[data-code]").first.wait_for()
    check(tag("staff /admin/products OK"), r.status == 200 and page.locator("tr[data-code]").count() >= 5)
    shot(page, vp_name, "admin-products")
    no_hscroll(page, "/admin/products")
    page.locator('tr[data-code="MILK-001"]').get_by_role("button", name="ดูล็อต").click()
    page.get_by_text("ขายไม่ได้").first.wait_for()
    page.get_by_text("L-1", exact=False).first.wait_for()
    shot(page, vp_name, "admin-lots-drawer")
    check(tag("lots drawer shows FEFO first + expired lot"), "ขายไม่ได้" in page.inner_text("body"), page.inner_text("aside")[:200].replace(chr(10), " "))
    page.keyboard.press("Escape")

    # ---------- staff: Excel import ----------
    page.goto(WEB + "/admin/stock-import")
    page.get_by_role("button", name="หลายรายการ (Excel)").click()
    page.locator("#xlFile").wait_for(state="attached")
    s0 = stocks()
    page.locator("#xlFile").set_input_files(os.path.join(DATA, "a-valid-5rows.xlsx"))
    page.get_by_text("ผลตรวจไฟล์").wait_for()
    dup = page.locator("#xlAck").count() > 0
    if dup:
        page.locator("#xlAck").check()
    btn = page.locator("#xlConfirm")
    check(tag("preview a: 5 lots confirm enabled"), "5 ล็อต" in btn.inner_text() and btn.is_enabled(), btn.inner_text())
    shot(page, vp_name, "import-preview-ok")
    no_hscroll(page, "/admin/stock-import preview")
    btn.click()
    page.get_by_text("บันทึกทั้งไฟล์เรียบร้อย").wait_for()
    s1 = stocks()
    check(tag("stock increased after import a (MILK +15, YOG +20, EGG +12, BRD +6)"),
          s1["MILK-001"] - s0["MILK-001"] == 15 and s1["YOG-001"] - s0["YOG-001"] == 20 and s1["EGG-001"] - s0["EGG-001"] == 12 and s1["BRD-001"] - s0["BRD-001"] == 6,
          f"dup-file-ack={'yes' if dup else 'no'}")
    shot(page, vp_name, "import-done")
    page.get_by_role("button", name="นำเข้าไฟล์อื่น").click()
    page.locator("#xlFile").set_input_files(os.path.join(DATA, "b-all-errors.xlsx"))
    page.get_by_text("ผลตรวจไฟล์").wait_for()
    row = lambda n: page.locator(f'tr[data-row="{n}"]').inner_text().replace("\n", " ")
    exp_err = {2: "ไม่พบรหัส", 3: "ไม่พบรหัส", 4: "จำนวน", 5: "จำนวน", 6: "จำนวน", 7: "ย้อนหลัง", 8: "อ่านไม่ได้", 9: "ไม่ได้กรอกจำนวน", 12: "ไม่ได้กรอกรหัส"}
    ok_rows = all(m in row(n) and "ผิด" in row(n) for n, m in exp_err.items())
    check(tag("preview b: error rows match Excel row numbers"), ok_rows and page.locator('tr[data-row="10"]').count() == 0 and "ผ่าน" in row(11))
    check(tag("preview b: confirm disabled"), page.locator("#xlConfirm").is_disabled())
    shot(page, vp_name, "import-preview-errors")
    no_hscroll(page, "/admin/stock-import errors")

    # ---------- import with a lower-case code is matched (codes are case-insensitive) ----------
    page.get_by_role("button", name="เลือกไฟล์ใหม่").first.click()
    lq = 2 if vp_name == "m375" else 3
    m0 = stocks()["MILK-001"]
    page.locator("#xlFile").set_input_files(lower_code_xlsx(lq))
    page.get_by_text("ผลตรวจไฟล์").wait_for()
    check(tag("import: 'milk-001' row is ok and shows MILK-001"), "MILK-001" in row(2) and "ผ่าน" in row(2) and page.locator("#xlConfirm").is_enabled(), row(2)[:80])
    page.locator("#xlConfirm").click()
    page.get_by_text("บันทึกทั้งไฟล์เรียบร้อย").wait_for()
    check(tag("import: lower-case code added stock"), stocks()["MILK-001"] == m0 + lq, f"{m0} -> {stocks()['MILK-001']}")
    logout(page)

    # ---------- guest: cart -> email -> sent -> resend -> new link works, old link dead ----------
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    add_to_cart(page, "EGG-001")
    page.wait_for_timeout(800)
    page.locator("a:visible", has_text="ตะกร้า").first.click()
    page.wait_for_url("**/cart")
    page.locator("#gName").fill("สมชาย ใจดี")
    page.locator("#gContact").fill(f"guest-{vp_name}@example.com")
    shot(page, vp_name, "cart-guest")
    page.get_by_role("button", name="สั่งซื้อและรับลิงก์ยืนยัน").click()
    page.wait_for_url("**/checkout/sent")
    link1 = page.locator('[data-testid="outbox-link"]').inner_text()
    check(tag("sent page shows masked target + outbox link"), "***" in page.inner_text("body") and "/orders/confirm/" in link1, link1)
    shot(page, vp_name, "checkout-sent")
    no_hscroll(page, "/checkout/sent")
    egg_before_confirm = stocks()["EGG-001"]
    page.wait_for_function("!document.querySelector('#resendBtn').disabled", timeout=75000)
    page.locator("#resendBtn").click()
    page.wait_for_function("(old) => { const e = document.querySelector('[data-testid=outbox-link]'); return e && e.innerText.trim() !== old; }", arg=link1, timeout=15000)
    link2 = page.locator('[data-testid="outbox-link"]').inner_text()
    check(tag("resend produced a new link"), link2 != link1)
    old = ctx.new_page()
    old.goto(WEB + link1)
    old.get_by_text("ไม่พบคำสั่งซื้อ").wait_for()
    check(tag("old link no longer works"), True)
    old.close()
    check(tag("stock not cut before confirm"), stocks()["EGG-001"] == egg_before_confirm)
    new = ctx.new_page()
    new.goto(WEB + link2)
    new.get_by_text("ยืนยันคำสั่งซื้อเรียบร้อย").wait_for()
    check(tag("new link confirms the order"), stocks()["EGG-001"] == egg_before_confirm - 1)
    new.screenshot(path=os.path.join(SHOTS, f"{vp_name}-confirm-ok.png"))
    no_hscroll(new, "/orders/confirm ok")
    new.reload()
    new.get_by_text("คำสั่งซื้อนี้ยืนยันไปแล้ว").wait_for()
    check(tag("reopening link = already confirmed, no double cut"), stocks()["EGG-001"] == egg_before_confirm - 1)
    new.close()

    # ---------- infinite scroll ----------
    reqs = []
    page.on("request", lambda r: reqs.append(r.url) if "/api/proxy/products" in r.url and "page=" in r.url else None)
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    n1 = page.locator("article").count()
    page.mouse.wheel(0, 20000)
    page.wait_for_function("document.querySelectorAll('article').length > %d" % n1, timeout=15000)
    check(tag("infinite scroll requested page=2"), any("page=2" in u for u in reqs) and page.locator("article").count() > n1, f"{n1} -> {page.locator('article').count()} cards")
    shot(page, vp_name, "shop-scrolled")
    # search goes to server
    reqs.clear()
    page.locator("#q").fill("นมสด")
    page.wait_for_function("document.querySelectorAll('article').length === 1", timeout=15000)
    check(tag("search is server-side (q= in request)"), any("q=" in u for u in reqs), str([u for u in reqs][-1:]))
    no_hscroll(page, "/shop search")

    check(tag("no console errors"), len(errors) == 0, "; ".join(errors[:3]))
    check(tag("no 5xx responses"), len(bad_resp) == 0, "; ".join(bad_resp[:3]))
    ctx.close()
    browser.close()


# cards on screen dimmer than they should be (1, or .8 for the out-of-stock "opacity-80" card, which the reveal animation's fill may lift to 1)
DIM_JS = """() => [...document.querySelectorAll('article.rv')].filter(a => { const b = a.getBoundingClientRect(); return b.width > 0 && b.bottom > 0 && b.top < innerHeight; })
  .filter(a => parseFloat(getComputedStyle(a).opacity) < (a.classList.contains('opacity-80') ? .8 : 1) - .01).map(a => a.dataset.code)"""
CARD_ANIMS_JS = "() => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.tagName === 'ARTICLE').length"
ALL_BULK = "(n) => { const a = [...document.querySelectorAll('article')]; return a.length === n && a.every(e => e.dataset.code.startsWith('BULK')); }"
# IO that exists (so .rv-on is set) but never reports: only the 1s safety net can reveal the cards
DEAD_IO = "window.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };"


def reveal(pw, vp_name, size):
    """Cards must never stay invisible: a new result set of the same size (24 -> 24) used to never be observed."""
    tag = lambda s: f"[{vp_name}] reveal: {s}"
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport=size)
    ctx.set_default_timeout(15000)
    page = ctx.new_page()

    def dim(step):
        page.wait_for_timeout(900)  # stagger max 280ms + .2s anim; the safety net cannot fire before 1s, so this proves the IO path
        bad = page.evaluate(DIM_JS)
        check(tag(f"all on-screen cards opacity 1 after {step}"), not bad, ",".join(bad[:8]))

    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    dim("first load")
    page.locator("#q").fill("สินค้าทดสอบ")
    page.wait_for_function(ALL_BULK, arg=24)
    dim("search (24 -> 24 cards)")
    page.locator("#q").fill("")
    page.wait_for_function("[...document.querySelectorAll('article')].some(e => !e.dataset.code.startsWith('BULK'))")
    page.get_by_role("button", name="Bulk", exact=True).click()
    page.wait_for_function(ALL_BULK, arg=24)
    dim("type filter")
    page.locator("#q").fill("zzzz-no-match")
    page.get_by_role("button", name="ล้างตัวกรอง").click()
    page.wait_for_function("document.querySelectorAll('article').length === 24")
    dim("clear filters")
    # infinite scroll: page 2 cards must reveal too
    page.mouse.wheel(0, 20000)
    page.wait_for_function("document.querySelectorAll('article').length > 24")
    page.locator("article").nth(26).scroll_into_view_if_needed()
    dim("scroll to page 2")
    # stepper / add to cart re-render the card: an already revealed card must not replay its animation
    card = page.locator("article:has(button[aria-label='เพิ่มจำนวน']:enabled)").first
    card.scroll_into_view_if_needed()
    page.wait_for_timeout(900)
    card.get_by_role("button", name="เพิ่มจำนวน").click()
    page.wait_for_timeout(50)
    a1 = page.evaluate(CARD_ANIMS_JS)
    card.get_by_role("button", name="เพิ่มลงตะกร้า").click()
    page.wait_for_timeout(50)
    a2 = page.evaluate(CARD_ANIMS_JS)
    check(tag("stepper / add-to-cart do not replay card animation"), a1 == 0 and a2 == 0, f"running={a1},{a2}")
    ctx.close()

    # reduced motion: no .rv-on, cards visible immediately (no wait for an observer)
    ctx = browser.new_context(viewport=size, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    page.locator("#q").fill("สินค้าทดสอบ")
    page.wait_for_function(ALL_BULK, arg=24)
    bad = page.evaluate(DIM_JS)
    check(tag("reduced-motion: no .rv-on, cards visible at once"), not page.evaluate("document.documentElement.classList.contains('rv-on')") and not bad, ",".join(bad[:8]))
    ctx.close()

    # safety net: observer never reports -> on-screen cards still show within ~1.25s (instant, no motion)
    ctx = browser.new_context(viewport=size)
    ctx.add_init_script(DEAD_IO)
    page = ctx.new_page()
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    page.locator("#q").fill("สินค้าทดสอบ")
    page.wait_for_function(ALL_BULK, arg=24)
    page.wait_for_timeout(1600)
    bad = page.evaluate(DIM_JS)
    check(tag("safety net reveals cards when the observer never fires"), not bad and page.locator("article.in.now").count() > 0, ",".join(bad[:8]))
    ctx.close()
    browser.close()


def authlog_ip_ua(pw):
    """BFF login/logout must hand the browser's UA and the client IP to the API (AuthLog), not Next's own."""
    ua = "QA-Browser/9.9 (r2-extras; Playwright)"
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, user_agent=ua)
    ctx.set_default_timeout(30000)
    page = ctx.new_page()
    email = "customer@example.com"
    page.goto(WEB + "/login")
    ip = page.evaluate("fetch('/api/proxy/dev/ip').then(r => r.json())")["remoteIp"]
    page.locator("#lEmail").fill(email)
    page.locator("#lPass").fill("WrongPass-r2")
    page.get_by_role("button", name="เข้าสู่ระบบ").click()
    page.get_by_text("อีเมลหรือรหัสผ่านไม่ถูกต้อง").wait_for()
    page.locator("#lPass").fill("Test1234!")
    page.get_by_role("button", name="เข้าสู่ระบบ").click()
    page.wait_for_url(re.compile(r"/shop"))
    logout(page)
    _, t = jreq("POST", "/api/auth/login", body={"email": "staff@example.com", "password": "Test1234!"})
    _, d = jreq("GET", "/api/auth-logs?pageSize=20&email=" + email, t["token"])
    rows = [r for r in d["items"] if r["userAgent"] == ua]
    reasons = [r["reason"] for r in rows]
    check("AuthLog: bad_password, ok and logout rows carry the browser User-Agent", {"bad_password", "ok", "logout"} <= set(reasons), str(reasons))
    check("AuthLog: IP equals what the API resolves for the browser (not Next's ::1 by accident)", rows and all(r["ip"] == ip for r in rows), f"rows={[r['ip'] for r in rows]} dev/ip={ip}")
    check("AuthLog: no Node/undici UA stored for these rows", all("node" not in (r["userAgent"] or "").lower() and "undici" not in (r["userAgent"] or "").lower() for r in d["items"][:3]))
    ctx.close()
    browser.close()


def near_expiry_ui(pw):
    """near-expiry is decided by the server: shift the browser clock 11 days ahead + a far timezone, the UI must still match the API."""
    import datetime
    near_days = int(os.environ.get("E2E_NEAR_DAYS", "7"))
    _, d = jreq("GET", "/api/products?pageSize=100")
    truth = {p["code"]: p for p in d["items"]}
    milk, bread, yog = truth["MILK-001"], truth["BRD-001"], truth["YOG-001"]
    check(f"API (Stock:NearExpiryDays={near_days}): milk daysLeft={milk['daysLeft']} nearExpiry={milk['nearExpiry']}",
          milk["nearExpiry"] == (milk["daysLeft"] <= near_days) and yog["nearExpiry"] == (yog["daysLeft"] <= near_days),
          f"bread={bread['daysLeft']}/{bread['nearExpiry']} yog={yog['daysLeft']}/{yog['nearExpiry']}")
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, timezone_id="Pacific/Kiritimati")
    ctx.set_default_timeout(30000)
    page = ctx.new_page()
    page.clock.set_fixed_time(datetime.datetime.now() + datetime.timedelta(days=11))
    shown = page.evaluate("new Date().toISOString().slice(0,10)")
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    ok_all = True
    detail = []
    for code, p in (("MILK-001", milk), ("BRD-001", bread), ("YOG-001", yog)):
        page.locator("#q").fill(code)
        page.wait_for_function("document.querySelectorAll('article').length === 1")
        page.locator(f'article[data-code="{code}"]').wait_for()
        txt = page.locator(f'article[data-code="{code}"]').inner_text()
        has_badge = "ใกล้หมดอายุ" in txt
        has_days = f"อีก {p['daysLeft']} วัน" in txt
        good = has_badge == p["nearExpiry"] and has_days == p["nearExpiry"]
        ok_all &= good
        detail.append(f"{code}: server near={p['nearExpiry']} days={p['daysLeft']} -> badge={has_badge} text={has_days}")
    check(f"shop badge + '(อีก N วัน)' follow the server with the browser clock at {shown} (11 days ahead, UTC+14)", ok_all, " | ".join(detail))
    # admin: products table + lots drawer
    page.goto(WEB + "/login")
    page.get_by_role("button", name="ใช้บัญชีนี้").nth(1).click()
    page.get_by_role("button", name="เข้าสู่ระบบ").click()
    page.wait_for_url(re.compile(r"/admin/products"))
    page.locator('tr[data-code="MILK-001"]').wait_for()
    row_txt = page.locator('tr[data-code="MILK-001"]').inner_text()
    check("admin table near badge follows the server", ("ใกล้หมดอายุ" in row_txt) == milk["nearExpiry"], row_txt.replace(chr(10), " ")[:80])
    page.locator('tr[data-code="MILK-001"]').get_by_role("button", name="ดูล็อต").click()
    page.get_by_text("L-1", exact=False).first.wait_for()
    _, t = jreq("POST", "/api/auth/login", body={"email": "staff@example.com", "password": "Test1234!"})
    _, det = jreq("GET", "/api/products/1", t["token"])
    states = [l["state"] for l in det["lots"] if l["remainingQty"] > 0]
    aside = page.locator("aside").inner_text()
    check("drawer: lot states (ok/near/expired) come from the server",
          aside.count("ใกล้หมดอายุ") == states.count("near") and aside.count("หมดอายุ · ขายไม่ได้") == states.count("expired"),
          f"server states={states}")
    ctx.close()
    browser.close()


def search_utc_checks():
    """QA r2 N2 (case-insensitive name search, % _ literal) and N3 (every time ends with Z)."""
    win = int(os.environ.get("E2E_RATE_WINDOW", "0"))
    if win:
        time.sleep(win + 1)  # guest create + resend below use the rate-limit quota
    _, t = jreq("POST", "/api/auth/login", body={"email": "staff@example.com", "password": "Test1234!"})
    tok = t["token"]
    for code, name in (("SRCH-1", "QA low2"), ("SRCH-2", "100% real"), ("SRCH-3", "a_b item"), ("SRCH-4", "axb item"), ("SRCH-5", "ข้าวหอมมะลิ SRCH")):
        jreq("POST", "/api/products", tok, {"code": code, "name": name, "type": "Srch", "price": 1})
    codes = lambda q: sorted(i["code"] for i in jreq("GET", "/api/products?pageSize=100&q=" + urllib.parse.quote(q))[1]["items"])
    check("search 'qa low' finds 'QA low2'", codes("qa low") == ["SRCH-1"], str(codes("qa low")))
    check("search 'QA LOW2' (upper) finds it", codes("QA LOW2") == ["SRCH-1"])
    check("search 'Qa Low' (mixed) finds it", codes("Qa Low") == ["SRCH-1"])
    check("search '%' matches only the literal % (not everything)", codes("%") == ["SRCH-2"], str(codes("%")))
    check("search '_' matches only the literal _ (not any char)", codes("_") == ["SRCH-3"], str(codes("_")))
    check("search 'a_b' does not match 'axb item'", codes("a_b") == ["SRCH-3"])
    check("search Thai name works", codes("หอมมะลิ") == ["SRCH-5"], str(codes("หอมมะลิ")))
    check("search by code, lower-case", "SRCH-1" in codes("srch-1"))
    Z = re.compile(r"Z$")
    st, g = jreq("POST", "/api/orders/guest", body={"name": "Utc Test", "email": "utc@example.com", "items": [{"productId": 1, "qty": 1}]})
    check("guest expiresAt ends with Z", st == 202 and Z.search(g["expiresAt"]), g.get("expiresAt", ""))
    jreq("POST", f"/api/orders/guest/{g['orderId']}/resend")
    _, au = jreq("GET", f"/api/audit-logs?entity=Order&entityId={g['orderId']}&pageSize=20", tok)
    rs = [json.loads(i["changes"]) for i in au["items"] if i["action"] == "Resend"]
    exp = rs[0]["TokenExpiresAt"] if rs else {}
    check("audit Resend: TokenExpiresAt old AND new end with Z", bool(rs) and bool(Z.search(exp.get("old", ""))) and bool(Z.search(exp.get("new", ""))), json.dumps(exp))
    _, c = jreq("POST", "/api/auth/login", body={"email": "customer@example.com", "password": "Test1234!"})
    jreq("POST", "/api/orders/checkout", c["token"], {"items": [{"productId": 3, "qty": 1}]})
    _, o = jreq("GET", f"/api/dev/outbox/latest?orderId={g['orderId']}")
    _, bt = jreq("GET", "/api/orders/by-token/" + o["link"].rsplit("/", 1)[1])
    _, mine = jreq("GET", "/api/orders/mine", c["token"])
    _, hist = jreq("GET", "/api/stock-imports", tok)
    _, bat = jreq("GET", "/api/stock-imports/batches", tok)
    _, mv = jreq("GET", "/api/stock-movements?pageSize=5", tok)
    _, al = jreq("GET", "/api/auth-logs?pageSize=5", tok)
    _, aud = jreq("GET", "/api/audit-logs?pageSize=5", tok)
    _, pd = jreq("GET", "/api/products/1", tok)
    probes = {
        "orders/mine createdAt": mine[0]["createdAt"], "stock-imports receivedAt": hist[0]["receivedAt"],
        "batches createdAt": bat[0]["createdAt"], "stock-movements at": mv["items"][0]["at"],
        "auth-logs at": al["items"][0]["at"], "audit-logs at": aud["items"][0]["at"],
        "product lots receivedAt": pd["lots"][0]["receivedAt"], "by-token tokenExpiresAt": bt["tokenExpiresAt"], "by-token createdAt": bt["createdAt"],
    }
    check("every endpoint that returns a time ends with Z", all(Z.search(v) for v in probes.values()), json.dumps({k: v for k, v in probes.items() if not Z.search(v)}))


def api_checks():
    """P3 items that are easiest to prove straight against the API."""
    _, t = jreq("POST", "/api/auth/login", body={"email": "staff@example.com", "password": "Test1234!"})
    tok = t["token"]
    st, _ = jreq("POST", "/api/products", tok, {"code": "milk-001", "name": "dup", "type": "Dairy", "price": 1})
    check("create 'milk-001' while MILK-001 exists -> 409", st == 409, str(st))
    st, d = jreq("POST", "/api/products", tok, {"code": "  low-100 ", "name": "Lower", "type": "Dairy", "price": 1})
    check("create ' low-100 ' -> stored as LOW-100", st == 201 and d["code"] == "LOW-100", json.dumps(d)[:60])
    st, d = jreq("POST", "/api/stock-imports", tok, {"productCode": "low-100", "qty": 1, "expDate": "2027-01-01"})
    check("single import with lower-case code works", st == 201, str(st))
    pid = d["id"] and jreq("GET", "/api/products?q=low-100")[1]["items"][0]["id"]
    jreq("DELETE", f"/api/products/{pid}", tok)
    st, d = jreq("POST", "/api/stock-imports", tok, {"productCode": "LOW-100", "qty": 1, "expDate": "2027-01-01"})
    check("single import into an inactive product -> 400", st == 400 and "ปิดการขาย" in json.dumps(d, ensure_ascii=False), f"{st} {json.dumps(d, ensure_ascii=False)[:80]}")
    st, d = jreq("GET", "/api/products?q=milk")
    check("search by lower-case code finds MILK-001", any(i["code"] == "MILK-001" for i in d["items"]))
    # Type normalisation + shop types only with sellable stock
    st, d = jreq("POST", "/api/products", tok, {"code": "TYP-1", "name": "t1", "type": "dairy ", "price": 1})
    check("type 'dairy ' reuses existing spelling 'Dairy'", st == 201 and d["type"] == "Dairy", json.dumps(d)[:70])
    st, d = jreq("POST", "/api/products", tok, {"code": "TYP-2", "name": "t2", "type": "  Fresh   Food ", "price": 1})
    check("type '  Fresh   Food ' collapses to 'Fresh Food'", st == 201 and d["type"] == "Fresh Food", d.get("type", ""))
    st, d = jreq("POST", "/api/products", tok, {"code": "TYP-3", "name": "t3", "type": "FRESH food", "price": 1})
    check("'FRESH food' reuses 'Fresh Food'", st == 201 and d["type"] == "Fresh Food", d.get("type", ""))
    st, _ = jreq("POST", "/api/products", tok, {"code": "TYP-4", "name": "t4", "type": "   ", "price": 1})
    check("blank type -> 400", st == 400, str(st))
    _, shop_types = jreq("GET", "/api/products/types")
    _, admin_types = jreq("GET", "/api/products/admin/types", tok)
    check("/products/types hides types without sellable stock (Fresh Food has no lots)", "Fresh Food" not in shop_types and "Dairy" in shop_types, str(shop_types))
    check("/products/admin/types lists every type incl. no-stock ones", "Fresh Food" in admin_types and set(shop_types) <= set(admin_types), str(admin_types))
    st, _ = jreq("GET", "/api/products/admin/types")
    check("admin/types needs login (401)", st == 401, str(st))
    # quantity overflow / cap -> 400, never 500
    _, c = jreq("POST", "/api/auth/login", body={"email": "customer@example.com", "password": "Test1234!"})
    st, _ = jreq("POST", "/api/orders/checkout", c["token"], {"items": [{"productId": 1, "qty": 2147483647}, {"productId": 1, "qty": 1}]})
    check("checkout with qty sum overflowing int -> 400 (not 500)", st == 400, str(st))
    st, _ = jreq("POST", "/api/orders/checkout", c["token"], {"items": [{"productId": 1, "qty": 100001}]})
    check("checkout line above the cap -> 400", st == 400, str(st))


def rate_limit_ui(pw):
    """429 box counts down from Retry-After and the button comes back. Needs the API started with RateLimit__GuestWindowSeconds=E2E_RATE_WINDOW."""
    win = int(os.environ.get("E2E_RATE_WINDOW", "0"))
    if not win:
        print("SKIP 429 countdown (set E2E_RATE_WINDOW to the API's RateLimit__GuestWindowSeconds)")
        return
    time.sleep(win + 1)  # fresh window
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.set_default_timeout(30000)
    page = ctx.new_page()
    page.goto(WEB + "/shop")
    page.locator("article").first.wait_for()
    add_to_cart(page, "EGG-001")
    page.wait_for_timeout(800)
    page.locator("a:visible", has_text="ตะกร้า").first.click()
    page.wait_for_url("**/cart")
    for _ in range(5):  # burn the quota (a 400 counts too)
        try:
            urllib.request.urlopen(urllib.request.Request(WEB + "/api/proxy/orders/guest", method="POST", headers={"Content-Type": "application/json"},
                                                          data=json.dumps({"name": "x", "email": "bad", "items": [{"productId": 1, "qty": 1}]}).encode()))
        except urllib.error.HTTPError:
            pass
    page.locator("#gName").fill("ทดสอบ ลิมิต")
    page.locator("#gContact").fill("rate@example.com")
    page.get_by_role("button", name="สั่งซื้อและรับลิงก์ยืนยัน").click()
    box = page.locator('[data-testid="rate-box"]')
    box.wait_for()
    t = lambda: sum(int(x) * m for x, m in zip(page.locator('[data-testid="rate-left"]').inner_text().split(":"), (60, 1)))
    t0 = t()
    check("429 box shows a countdown <= window", 0 < t0 <= win, f"{t0}s of {win}s")
    page.screenshot(path=os.path.join(SHOTS, "d1280-cart-429.png"))
    page.wait_for_timeout(3500)
    t1 = t()
    check("429 countdown is ticking", t1 < t0, f"{t0}s -> {t1}s")
    check("order button disabled while counting", page.get_by_role("button", name="สั่งซื้อและรับลิงก์ยืนยัน").is_disabled())
    page.wait_for_function("!document.querySelector('[data-testid=rate-box]')", timeout=(win + 10) * 1000)
    check("at 0 the message disappears", True)
    check("button usable again", page.get_by_role("button", name="สั่งซื้อและรับลิงก์ยืนยัน").is_enabled())
    ctx.close()
    browser.close()


def clear_cart(pw, vp_name, size):
    """"ล้างตะกร้า" + confirm modal: cancel paths keep the cart, confirm empties it for good and drops every stale state."""
    tag = lambda s: f"[{vp_name}] clear-cart: {s}"
    key = "cart:customer@example.com"
    seed = json.dumps([{"productId": 2, "code": "YOG-001", "name": "โยเกิร์ตรสธรรมชาติ", "price": 18, "qty": 999},
                       {"productId": 1, "code": "MILK-001", "name": "นมสดพาสเจอร์ไรส์ 1L", "price": 45, "qty": 1},
                       {"productId": 4, "code": "EGG-001", "name": "ไข่ไก่ เบอร์ 2 (แผง)", "price": 5, "qty": 2}])
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport=size)
    ctx.set_default_timeout(15000)
    page = ctx.new_page()
    errors = []
    expected = re.compile(r"Failed to load resource: the server responded with a status of 409")
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not expected.search(m.text) else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    login(page, "customer")
    page.evaluate("([k, v]) => localStorage.setItem(k, v)", [key, seed])
    page.goto(WEB + "/cart")
    page.locator("[data-row]").first.wait_for()
    rows = lambda: page.locator("[data-row]").count()
    stored = lambda: page.evaluate("(k) => localStorage.getItem(k)", key)
    dialog = page.get_by_role("dialog")
    clear_btn = page.get_by_test_id("clear-cart")
    focused = lambda: page.evaluate("() => (document.activeElement && (document.activeElement.innerText || document.activeElement.id || document.activeElement.tagName)).trim()")
    h = clear_btn.bounding_box()["height"]
    check(tag("button below the list, target >= 40px"), h >= 40, f"h={h}")

    # open -> a11y + text + initial focus + trap
    clear_btn.click()
    dialog.wait_for()
    a = page.evaluate("() => { const d = document.querySelector('[role=dialog]'); return [d.getAttribute('aria-modal'), document.getElementById(d.getAttribute('aria-labelledby'))?.innerText, d.innerText]; }")
    check(tag("dialog aria-modal + labelledby title 'ล้างตะกร้าทั้งหมด 3 รายการ?'"), a[0] == "true" and a[1] == "ล้างตะกร้าทั้งหมด 3 รายการ?", str(a[:2]))
    check(tag("subtext 'รวม 1002 ชิ้น ลบแล้วกู้คืนไม่ได้'"), "รวม 1002 ชิ้น ลบแล้วกู้คืนไม่ได้" in a[2], a[2].replace("\n", " | "))
    check(tag("focus starts on ยกเลิก"), focused() == "ยกเลิก", focused())
    inside = []
    for k in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"):
        page.keyboard.press(k)
        inside.append(page.evaluate("() => !!document.activeElement.closest('[role=dialog]')"))
    check(tag("Tab / Shift+Tab stay inside the dialog"), all(inside), str(inside))
    page.wait_for_timeout(300)
    shot(page, vp_name, "cart-clear-modal")
    page.get_by_role("button", name="ยกเลิก").click()
    dialog.wait_for(state="detached")
    check(tag("ยกเลิก: cart unchanged, focus back on the button"), rows() == 3 and stored() == seed and focused() == "ล้างตะกร้า", f"rows={rows()} focus={focused()}")
    clear_btn.click()
    dialog.wait_for()
    page.keyboard.press("Escape")
    dialog.wait_for(state="detached")
    check(tag("Esc: cart unchanged, focus back"), rows() == 3 and stored() == seed and focused() == "ล้างตะกร้า", f"rows={rows()} focus={focused()}")
    clear_btn.click()
    dialog.wait_for()
    page.mouse.click(size["width"] - 5, size["height"] - 5)
    dialog.wait_for(state="detached")
    check(tag("backdrop click: cart unchanged"), rows() == 3 and stored() == seed, f"rows={rows()}")

    # disabled while checkout is in flight; the held request is then released and answers 409
    held = []
    page.route("**/api/proxy/orders/checkout", lambda r: held.append(r))
    page.get_by_role("button", name="สั่งซื้อ", exact=True).click()
    page.wait_for_function("() => document.body.innerText.includes('กำลังสั่งซื้อ')")
    check(tag("disabled while checkout is busy"), clear_btn.is_disabled())
    while not held:
        page.wait_for_timeout(50)
    held[0].continue_()
    page.unroute("**/api/proxy/orders/checkout")
    page.get_by_text("สั่งซื้อยังไม่สำเร็จ").wait_for()

    # delete a row (undo toast pending) -> clear -> the undo must not bring it back; 409 box gone
    page.locator('[data-row="MILK-001"]').get_by_role("button", name="ลบ", exact=True).click()
    page.locator("[data-undo]").wait_for()
    clear_btn.click()
    dialog.wait_for()
    t0 = time.time()
    dialog.get_by_role("button", name="ล้างตะกร้า").click()
    page.get_by_text("ตะกร้ายังว่างอยู่").wait_for()
    dt = int((time.time() - t0) * 1000)
    check(tag("rows collapse then the empty state shows (< 700ms incl. render)"), dt < 700, f"{dt}ms")
    alerts = page.evaluate("() => [...document.querySelectorAll('[role=alert]')].map(e => e.tagName + ':' + e.innerText.trim()).filter(t => !t.endsWith(':'))")
    check(tag("409 box cleared"), not alerts and "สั่งซื้อยังไม่สำเร็จ" not in page.inner_text("body"), str(alerts))
    check(tag("row-delete undo is gone"), page.locator("[data-undo]").count() == 0)
    check(tag("focus moves to the empty cart heading"), page.evaluate("() => document.activeElement.id") == "cartTitle", focused())
    page.wait_for_timeout(5500)  # past the old undo toast's 5s life
    check(tag("deleted row did not come back"), rows() == 0 and stored() is None, str(stored()))
    check(tag("navbar badge gone (0)"), page.locator(".cart-badge:visible").count() == 0)
    page.reload()
    page.get_by_text("ตะกร้ายังว่างอยู่").wait_for()
    check(tag("still empty after reload"), stored() is None and rows() == 0 and page.locator(".cart-badge:visible").count() == 0)
    check(tag("no console errors"), not errors, "; ".join(errors[:3]))
    ctx.close()

    # reduced motion (guest): fade only, still clears
    ctx = browser.new_context(viewport=size, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(WEB + "/shop")
    page.evaluate("(v) => localStorage.setItem('cart:guest', v)", json.dumps(json.loads(seed)[1:]))
    page.goto(WEB + "/cart")
    page.locator("[data-row]").first.wait_for()
    page.get_by_role("button", name="สั่งซื้อและรับลิงก์ยืนยัน").click()
    page.locator("#gName[aria-invalid=true]").wait_for()
    page.get_by_test_id("clear-cart").click()
    d = page.get_by_role("dialog")
    d.wait_for()
    dy = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--dy').trim()")
    check(tag("reduced-motion: dialog fades only (--dy 0, no slide)"), dy == "0px", dy)
    page.wait_for_timeout(300)
    shot(page, vp_name, "cart-clear-modal-reduced")
    t0 = time.time()
    d.get_by_role("button", name="ล้างตะกร้า").click()
    page.get_by_text("ตะกร้ายังว่างอยู่").wait_for()
    dt = int((time.time() - t0) * 1000)
    check(tag("reduced-motion: cleared"), page.evaluate("localStorage.getItem('cart:guest')") is None and dt < 600, f"{dt}ms")
    ctx.close()
    browser.close()


if __name__ == "__main__":
    seed_bulk()
    with sync_playwright() as pw:
        run(pw, "m375", {"width": 375, "height": 800})
        run(pw, "d1280", {"width": 1280, "height": 900})
        reveal(pw, "m375", {"width": 375, "height": 800})
        reveal(pw, "d1280", {"width": 1280, "height": 900})
        clear_cart(pw, "m375", {"width": 375, "height": 800})
        clear_cart(pw, "d1280", {"width": 1280, "height": 900})
        rate_limit_ui(pw)
        authlog_ip_ua(pw)
        near_expiry_ui(pw)
    api_checks()
    search_utc_checks()
    fails = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} PASS")
    sys.exit(1 if fails else 0)
