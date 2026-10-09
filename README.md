# shop-cart

ระบบตะกร้าสินค้า (stock แบบ lot + ตัดสต็อก FEFO)

```
shop-cart/
├── backend/ShopCart.Api   .NET 10 Web API + EF Core + SQLite  (http://localhost:5080)
├── frontend/              Next.js 16 (App Router, TS, Tailwind) BFF           (http://localhost:3000)
├── design/mockup.html     spec หน้าตา/พฤติกรรม (ห้ามแก้ — เวร่าดูแล)
└── e2e/e2e.py             Playwright end-to-end (375 + 1280)
```

## วิธีรันคู่กัน
```
# 1) API  (ครั้งแรก / schema เปลี่ยน: ลบ backend/ShopCart.Api/shopcart.db* ก่อน)
cd backend/ShopCart.Api && dotnet run
# 2) Web  (ครั้งแรก: cp .env.example .env.local)
cd frontend && npm install && npm run dev        # ใช้ server.mjs (custom server) — ดูหัวข้อ IP ลูกค้า
# เปิด http://localhost:3000
# build/lint:  npm run build && npm run lint      production: npm run build && npm start
# e2e (API + Web ต้องรันอยู่, DB สด):  pip install playwright && python e2e/e2e.py
```

## Backend (ShopCart.Api — .NET 10, EF Core + SQLite)

```
cd backend/ShopCart.Api
dotnet run            # http://localhost:5080  (Swagger: /swagger, ปุ่ม Authorize ใส่ token)
```
สร้าง `shopcart.db` + seed อัตโนมัติตอนรันครั้งแรก (ลบไฟล์ db เพื่อ reset)

### บัญชีทดสอบ (dev seed)
| Email | Password | Role |
|---|---|---|
| staff@example.com | Test1234! | Staff |
| staff2@example.com | Test1234! | Staff (คนที่สอง ไว้ทดสอบสิทธิ์ข้าม user) |
| customer@example.com | Test1234! | Customer |

Seed สินค้า 5 ตัว (MILK-001 มี 3 lot รวม 1 lot หมดอายุ, JUI-001 มีแต่ lot หมดอายุ => stock 0)

### Endpoints
- POST `/api/auth/login` -> `{token, role, email}`
- GET `/api/products` (ทุกคน; stock = SUM(RemainingQty) ของ lot ที่ ExpDate >= วันนี้, nearestExp) · GET `/api/products/{id}` (Staff เห็น lots)
- Staff: POST/PUT/DELETE(soft) `/api/products` · POST/GET `/api/stock-imports`
- Customer: POST `/api/orders/checkout` `{items:[{productId,qty}]}` · GET `/api/orders/mine`

### นำเข้า stock หลายรายการด้วย template (Staff, เฉพาะ .xlsx)
1. GET `/api/stock-imports/template` -> `stock-import-template.xlsx` (ชีต "นำเข้า" มีแต่ header · ชีต "ตัวอย่าง" ใช้รหัสสมมุติ EXAMPLE-001 · ชีต "รหัสสินค้า" ไว้ดูรหัสที่ใช้ได้) — parser อ่านเฉพาะชีต "นำเข้า" (ไม่พบ = 400, ไม่มีแถวข้อมูล = 400 "ไฟล์ไม่มีข้อมูล")
2. POST `/api/stock-imports/preview` (multipart field `file`, <= 2 MB, <= 1,000 แถว) — ไม่เขียน DB; คืน rows ตามเลขแถวจริงใน Excel (header = แถว 1), summary, `duplicateFile`, `previewId` (อยู่ใน memory 10 นาที ผูกกับ user) — ไม่ใช่ .xlsx จริง = 400
3. POST `/api/stock-imports/apply` `{previewId, confirmDuplicate?}` — 410 ไม่พบ/หมดอายุ · 403 ของ user อื่น · 422 มีแถว error · 409 ไฟล์ซ้ำ (hash) ต้องส่ง confirmDuplicate=true · สำเร็จ = ทุกแถวเป็น StockLot ใน transaction เดียว + บันทึก `StockImportBatch`
- นำเข้าได้เฉพาะสินค้าที่ active และมีอยู่แล้ว ไม่สร้างสินค้าใหม่ · exp รับ date cell หรือข้อความ `yyyy-mm-dd` · preview cache เป็น in-memory (restart server = ต้อง preview ใหม่)
- ไฟล์ทดสอบ: `backend/testdata/import/` (a ถูกทั้งหมด, b error ทุกเคส, c .csv / d .txt / e xlsx ปลอม / g 1,001 แถว / i ไม่มีชีต "นำเข้า" = 400, f warning)
- **schema เปลี่ยน (StockImportBatch, StockLot.BatchId): ต้องลบ `shopcart.db` แล้วรันใหม่**

### Log / ประวัติ (อ่านอย่างเดียว, Staff เท่านั้น — ไม่มี endpoint แก้/ลบ)
- `AuditLog` อัตโนมัติผ่าน `SaveChangesInterceptor` (Added/Modified/Deleted + `{field:{old,new}}`, mask `PasswordHash`/`ConfirmToken`, ข้ามตาราง log เอง) · `GET /api/audit-logs?entity=&entityId=&userId=&from=&to=&page=&pageSize=`
- `StockMovement` เขียนใน `StockService` จุดเดียว (Import / Sale / GuestConfirm) ใน transaction เดียวกับที่เปลี่ยน stock — ทุกล็อต `SUM(Qty) == RemainingQty` · `GET /api/stock-movements?productId=&lotId=&type=&from=&to=`
- `AuthLog` login สำเร็จ/ผิด/ไม่รู้จักอีเมล + logout (ไม่เก็บรหัสผ่าน) · `GET /api/auth-logs?email=&success=&from=&to=`
- **schema เปลี่ยน (3 ตารางใหม่): ต้องลบ `shopcart.db` แล้วรันใหม่**

### Guest checkout (ไม่ต้อง login)
- POST `/api/orders/guest` `{name, email?, phone?, items}` (ต้องมี email หรือ phone; เบอร์ไทย 10 หลักขึ้นต้น 0) -> 202 `{orderId, channel, maskedTarget, expiresAt}`; ตรวจ stock เบื้องต้น (ไม่พอ 409) แต่ **ยังไม่ตัด stock**; rate limit 5 ครั้ง / 10 นาที / IP (429 + Retry-After)
- ระบบส่งลิงก์ `{FrontendBaseUrl}/orders/confirm/{token}` ผ่าน `INotifier` (dev = `DevOutboxNotifier` เขียนไฟล์ `outbox/*.txt` — token อยู่ในไฟล์นี้เท่านั้น ไม่อยู่ใน response)
- POST `/api/orders/confirm/{token}`: 404 ไม่พบ · 410 หมดอายุ (30 นาที, ตั้ง Expired) · 200 ถ้า Confirmed แล้ว (idempotent) · 409 stock ไม่พอ (order ยัง PendingConfirm, ไม่ตัดอะไร) · สำเร็จ = ตัด FEFO + Confirmed
- GET `/api/orders/by-token/{token}`: ดูสถานะ (email/phone ถูก mask)
- เปลี่ยนไปใช้ SMTP/SMS: เขียน class ใหม่ implement `INotifier` แล้วสลับบรรทัด DI ใน `Program.cs`
- **schema เปลี่ยน (Order guest fields): ต้องลบ `shopcart.db` แล้วรันใหม่** (ใช้ EnsureCreated)
- 409 shortages มี `expired_qty` = จำนวนในล็อตหมดอายุของสินค้านั้น (ไม่นับเป็น available)

### Checkout FEFO
transaction เดียว; ต่อสินค้าเลือก lot `ExpDate >= วันนี้ AND RemainingQty > 0` เรียง `ExpDate, ReceivedAt, Id` ตัดข้าม lot ได้ (logic อยู่ใน `Services/StockService.cs` ใช้ร่วมกับ guest confirm);
ไม่พอ -> rollback ทั้ง order + 409 `{shortages:[{code,requested,available,short_by}]}`; qty <= 0 -> 400; ราคาใช้ฝั่ง server;
บันทึกการตัดต่อ lot ใน `OrderItemLot`.

### หมายเหตุ concurrency
SQLite เขียนได้ทีละ writer + UPDATE ตรวจ `RemainingQty >= take` ซ้ำ (guarded `ExecuteUpdate`) พอสำหรับ scaffold.
ถ้าย้ายไป SQL Server ต้องใช้ `rowversion` หรือ `UPDLOCK, ROWLOCK` ตอนอ่าน lot (ตอนนี้ read-then-update ใน READ COMMITTED จะไม่กัน oversell เองได้ครบ ถ้าไม่มี guard).
JWT key ใน `appsettings.Development.json` เป็นค่า dev เท่านั้น; prod ใช้ env `Jwt__Key`.
เวลา "วันนี้" = วันตามเวลาเครื่อง server (`DateTime.Today`).

## Frontend (Next.js 16)
- **Auth = BFF:** `POST /api/auth/login` เรียก .NET แล้วตั้ง cookie `token` แบบ httpOnly + SameSite=Lax (secure ใน production); JS อ่าน token ไม่ได้ · `/api/proxy/*` แนบ `Authorization: Bearer` จาก cookie ส่งต่อไป `API_URL` (env ฝั่ง server เท่านั้น) รองรับ JSON, multipart (อัปโหลด .xlsx) และไฟล์ดาวน์โหลด (template)
- **Route guard:** Next 16 เปลี่ยนชื่อ `middleware.ts` เป็น `proxy.ts` — `/admin/*` = Staff เท่านั้น (Customer ได้หน้า 403), `/orders` ต้อง login; `/shop /cart /orders/confirm/* /checkout/sent` เปิดทุกคน (ตัวจริงที่บังคับสิทธิ์คือ API ทุก request)
- **ตะกร้า** เก็บใน localStorage แยก key ตาม user (guest แยก) แล้วรวมเข้าตะกร้า user ตอน login
- **โหมด dev เท่านั้น:** กล่อง "ดู outbox (dev)" ใน `/checkout/sent` ดึงลิงก์ล่าสุดจาก `GET /api/dev/outbox/latest` (ลงทะเบียนเฉพาะ `IsDevelopment()`) และบัญชีทดสอบในหน้า login
- **IP จริงของลูกค้า (rate limit):** Next จะ `x-forwarded-for ??= socket` ซึ่งค่าที่ลูกค้าแนบมาจะรอด จึงใช้ `server.mjs` (custom server) **เขียนทับ** header ด้วย IP จาก socket ก่อนถึง Next; proxy route **set** `X-Forwarded-For` ค่าเดียว (ไม่ append/ไม่ส่งต่อของลูกค้า) และไม่ส่งต่อ `host`/`connection`/`cookie`. ฝั่ง .NET เชื่อ header นี้เฉพาะจาก `Proxy:TrustedIPs` (dev = 127.0.0.1, ::1) และ `ForwardLimit=1`.
  **ถ้าวันหน้ามี reverse proxy อยู่หน้า Next** ต้องเปลี่ยน `server.mjs` ให้อ่าน IP จาก proxy ตัวนั้น (เฉพาะคำขอที่มาจาก proxy จริง) และใส่ IP ของ Next ใน `Proxy:TrustedIPs` ของ API

## Deploy checklist
- **ปิด port ของ .NET API ไม่ให้เข้าจากภายนอก** (listen เฉพาะ loopback / เครือข่ายภายใน หรือ firewall) ให้เข้าได้ผ่าน Next (BFF) เท่านั้น — ถ้า client ยิงตรงเข้า .NET ได้ และ IP ของมันอยู่ใน `Proxy:TrustedIPs` มันเลือก `X-Forwarded-For` เองได้ (หลบ rate limit ได้)
- ตั้ง `Proxy:TrustedIPs` เป็น **IP ของ Next เท่านั้น** (ห้ามใส่ช่วงกว้าง) · dev ใช้ `127.0.0.1`, `::1`
- ตั้ง `Jwt:Key` จาก env/secret (`Jwt__Key`) ไม่ใช้ค่า dev · `FrontendBaseUrl` ชี้โดเมนจริง
- รันเป็น `Production` (endpoint `/api/dev/*` ถูกลงทะเบียนเฉพาะ Development และตอบเฉพาะ client ที่เป็น loopback แม้ใน dev)
- `RateLimit:GuestPermit` / `RateLimit:GuestWindowSeconds` (default 5 / 600) ปรับได้ด้วย config
- schema เปลี่ยนรอบนี้ (`StockImportBatch.PreviewId` + unique index): **ต้องลบ `shopcart.db` แล้วรันใหม่**

## กฎที่ควรรู้
- รหัสสินค้า **ไม่แยกตัวพิมพ์เล็ก-ใหญ่**: เก็บเป็นตัวใหญ่เสมอ (`Trim().ToUpperInvariant()`) ทั้งตอนสร้าง/แก้ นำเข้า (ทีละรายการและ Excel) และค้นหา · สร้าง `milk-001` ตอนมี `MILK-001` = 409
- `POST /api/stock-imports/apply`: จอง preview แบบ atomic (apply ซ้ำพร้อมกันได้ 200 ครั้งเดียว ที่เหลือ 410) + `StockImportBatch.PreviewId` unique เป็นด่านที่สอง · 409 ไฟล์ซ้ำ/422 คืน preview ให้ส่ง `confirmDuplicate` ต่อได้
- จำนวนต่อรายการ (หลังรวมบรรทัดซ้ำ) ไม่เกิน 100,000 ชิ้น · เกิน = 400
- สูตร Excel ที่ไม่มีค่าที่คำนวณเก็บไว้ในไฟล์ = error บอกให้เปิดไฟล์ใน Excel แล้วบันทึกอีกครั้ง
- `ExecuteUpdate` ที่ไม่ผ่าน AuditInterceptor ต้องเขียน audit เองด้วย `AuditWriter` (resend = `Resend`, ลิงก์หมดอายุ = `Expired`); stock เขียน `StockMovement` เสมอ
- ทดสอบ: `python e2e/e2e.py` (ตั้ง `E2E_WEB`/`E2E_API`; ข้อ 429 countdown ต้องรัน API ด้วย `RateLimit__GuestWindowSeconds=25` และตั้ง `E2E_RATE_WINDOW=25`) · `python e2e/apply_race.py` (apply พร้อมกัน)

## การ apply ไฟล์นำเข้าพร้อมกัน (QA r2 N1)
- apply ถูก serialize ต่อ `FileHash` (`PreviewStore.LockAsync`) และเช็ค "ไฟล์นี้เคยนำเข้าแล้วไหม" **ภายใน transaction เดียวกับที่ insert batch** · preview จำไว้ว่าตอนตรวจไฟล์มี batch ของไฟล์นี้กี่อัน (`KnownBatches`); ถ้าตอน apply จำนวนเปลี่ยนไป (มีคนนำเข้าไปก่อน) = 409 และคืน preview ให้ ⇒ แม้ส่ง `confirmDuplicate=true` พร้อมกันหลายอันก็ผ่านได้ **อันเดียว** ที่เหลือต้องตรวจไฟล์ใหม่แล้วกดยืนยันเองอีกครั้ง
- **lock นี้ใช้ได้กับ instance เดียวเท่านั้น** ถ้า scale หลาย instance หรือย้ายไป SQL Server ต้องเปลี่ยนเป็น `sp_getapplock` หรือ UPDLOCK
- ค้นหาสินค้า (code/ชื่อ) ไม่แยกตัวพิมพ์ ทำใน DB ด้วย `LIKE` และตัวอักษร `% _ \` ในคำค้นเป็นตัวอักษรตรงตัว · เวลาทุกค่าจาก API เป็น UTC ลงท้าย `Z` (EF value converter จุดเดียวใน `AppDb`)
