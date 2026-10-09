using System.Security.Cryptography;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopCart.Api.Data;
using ShopCart.Api.Models;
using ShopCart.Api.Services;

namespace ShopCart.Api.Controllers;

public record StockImportRequest(string ProductCode, int Qty, DateOnly ExpDate);
public record ApplyRequest(string? PreviewId, bool? ConfirmDuplicate);

[ApiController]
[Route("api/stock-imports")]
[Authorize(Roles = Roles.Staff)]
public class StockImportsController(AppDb db, PreviewStore previews, StockService stock) : ControllerBase
{
    static DateOnly Today => DateOnly.FromDateTime(DateTime.Today);
    int UserId => int.Parse(User.FindFirst("sub")!.Value);

    // ---------- single item (original) ----------
    [HttpPost]
    public async Task<IActionResult> Import(StockImportRequest r)
    {
        if (r.Qty <= 0) return BadRequest(new { error = "จำนวนต้องมากกว่า 0" });
        var code = (r.ProductCode ?? "").Trim().ToUpperInvariant();
        var p = await db.Products.FirstOrDefaultAsync(x => x.Code == code);
        if (p is null) return NotFound(new { error = $"ไม่พบรหัสสินค้า {code}" });
        if (!p.IsActive) return BadRequest(new { error = $"สินค้า {p.Code} ปิดการขายแล้ว — เปิดขายในหน้า สินค้า ก่อน" });
        if (r.ExpDate < Today)
            return BadRequest(new { error = "วันหมดอายุต้องไม่ย้อนหลัง" });
        var lot = new StockLot
        {
            ProductId = p.Id, ReceivedQty = r.Qty, RemainingQty = r.Qty,
            ReceivedAt = DateTime.UtcNow, ExpDate = r.ExpDate,
            ImportedByUserId = UserId
        };
        db.StockLots.Add(lot);
        stock.AddImportMovement(lot, null);
        await db.SaveChangesAsync();
        return Created($"/api/stock-imports/{lot.Id}", new { lot.Id, ProductCode = p.Code, lot.ReceivedQty, lot.RemainingQty, lot.ReceivedAt, lot.ExpDate });
    }

    [HttpGet]
    public async Task<IActionResult> History() =>
        Ok(await db.StockLots.OrderByDescending(l => l.ReceivedAt).ThenByDescending(l => l.Id).Take(500).Select(l => new
        {
            l.Id, ProductCode = l.Product!.Code, ProductName = l.Product.Name,
            l.ReceivedQty, l.RemainingQty, l.ReceivedAt, l.ExpDate, l.ImportedByUserId, l.BatchId,
            ImportedBy = db.Users.Where(u => u.Id == l.ImportedByUserId).Select(u => u.Email).FirstOrDefault()
        }).ToListAsync());

    // per-file import history with lots
    [HttpGet("batches")]
    public async Task<IActionResult> Batches()
    {
        var batches = await db.StockImportBatches.OrderByDescending(b => b.CreatedAt).ThenByDescending(b => b.Id).Take(100).ToListAsync();
        var ids = batches.Select(b => b.Id).ToList();
        var lots = await db.StockLots.Where(l => l.BatchId != null && ids.Contains(l.BatchId.Value))
            .Select(l => new { l.BatchId, ProductCode = l.Product!.Code, ProductName = l.Product.Name, l.ReceivedQty, l.ExpDate }).ToListAsync();
        var emails = await db.Users.ToDictionaryAsync(u => u.Id, u => u.Email);
        return Ok(batches.Select(b => new
        {
            b.Id, b.FileName, b.RowCount, b.TotalQty, b.CreatedAt,
            ImportedBy = emails.GetValueOrDefault(b.ImportedByUserId),
            Lots = lots.Where(l => l.BatchId == b.Id).Select(l => new { l.ProductCode, l.ProductName, qty = l.ReceivedQty, l.ExpDate })
        }));
    }

    // ---------- bulk via template ----------
    [HttpGet("template")]
    public async Task<IActionResult> Template()
    {
        var products = await db.Products.Where(p => p.IsActive).OrderBy(p => p.Code).ToListAsync();
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet(StockImportFile.SheetName);
        ws.Cell(1, 1).Value = "รหัสสินค้า";
        ws.Cell(1, 2).Value = "จำนวน";
        ws.Cell(1, 3).Value = "วันหมดอายุ (yyyy-mm-dd)";
        ws.Row(1).Style.Font.Bold = true;
        ws.Column(1).Style.NumberFormat.Format = "@";
        ws.Column(2).Style.NumberFormat.Format = "0";
        ws.Column(3).Style.DateFormat.Format = "yyyy-mm-dd";
        ws.Cell(1, 1).Style.NumberFormat.Format = "@";
        ws.Columns().AdjustToContents();
        ws.Column(3).Width = 26;

        var ex = wb.AddWorksheet("ตัวอย่าง");
        ex.Cell(1, 1).Value = "รหัสสินค้า"; ex.Cell(1, 2).Value = "จำนวน"; ex.Cell(1, 3).Value = "วันหมดอายุ (yyyy-mm-dd)"; ex.Cell(1, 4).Value = "คำอธิบาย";
        ex.Row(1).Style.Font.Bold = true;
        ex.Cell(2, 1).Value = "EXAMPLE-001"; ex.Cell(2, 2).Value = 10; ex.Cell(2, 3).Value = "2027-01-31";
        ex.Cell(2, 4).Value = "รหัสสินค้า: ต้องมีอยู่แล้วและเปิดขายอยู่ (ดูชีต 'รหัสสินค้า') · จำนวน: จำนวนเต็มมากกว่า 0 · วันหมดอายุ: วันที่ใน Excel หรือข้อความ yyyy-mm-dd ไม่ย้อนหลัง";
        ex.Cell(3, 1).Value = "EXAMPLE-001"; ex.Cell(3, 2).Value = 5; ex.Cell(3, 3).Value = "2027-03-31";
        ex.Cell(3, 4).Value = "รหัสเดียวกันหลายแถว = หลายล็อต (วันหมดอายุต่างกันได้)";
        ex.Cell(4, 4).Value = "ตัวอย่างนี้เป็นรหัสสมมุติ ห้ามคัดลอกไปนำเข้าจริง — กรอกในชีต 'นำเข้า' เท่านั้น";
        ex.Columns().AdjustToContents();

        var ref2 = wb.AddWorksheet("รหัสสินค้า");
        ref2.Cell(1, 1).Value = "รหัสสินค้า"; ref2.Cell(1, 2).Value = "ชื่อ"; ref2.Cell(1, 3).Value = "Type";
        ref2.Row(1).Style.Font.Bold = true;
        for (var i = 0; i < products.Count; i++)
        {
            ref2.Cell(i + 2, 1).Value = products[i].Code;
            ref2.Cell(i + 2, 2).Value = products[i].Name;
            ref2.Cell(i + 2, 3).Value = products[i].Type;
        }
        ref2.Columns().AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "stock-import-template.xlsx");
    }

    [HttpPost("preview")]
    public async Task<IActionResult> Preview(IFormFile? file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { error = "ไม่พบไฟล์ (ส่ง multipart field ชื่อ file)" });
        if (!Path.GetExtension(file.FileName).Equals(".xlsx", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = StockImportFile.OnlyXlsxMessage });
        if (file.Length > StockImportFile.MaxBytes) return BadRequest(new { error = "ไฟล์ใหญ่เกิน 2 MB" });

        byte[] bytes;
        using (var ms = new MemoryStream()) { await file.CopyToAsync(ms); bytes = ms.ToArray(); }

        var (raw, err) = StockImportFile.Read(bytes);
        if (raw is null) return BadRequest(new { error = err });

        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var products = await db.Products.ToDictionaryAsync(p => p.Code);
        var today = Today;

        var rows = new List<PreviewRow>();
        foreach (var r in raw)
        {
            var code = (r.Code ?? "").Trim().ToUpperInvariant(); // product codes are case-insensitive (stored upper-case)
            var pr = new PreviewRow { Row = r.Row, Code = code, Qty = StockImportFile.Display(r.Qty), ExpDate = StockImportFile.Display(r.Exp) };
            Product? prod = null;
            if (r.FormulaCols.Contains('A')) pr.Errors.Add(StockImportFile.FormulaMessage("รหัสสินค้า"));
            else if (code.Length == 0) pr.Errors.Add("ไม่ได้กรอกรหัสสินค้า");
            else if (!products.TryGetValue(code, out prod)) pr.Errors.Add($"ไม่พบรหัส {code} — สร้างสินค้าในหน้า สินค้า ก่อน");
            else if (!prod.IsActive) pr.Errors.Add($"สินค้า {code} ปิดการขายแล้ว — เปิดขายในหน้า สินค้า ก่อน");
            else pr.ProductName = prod.Name;

            if (r.FormulaCols.Contains('B')) pr.Errors.Add(StockImportFile.FormulaMessage("จำนวน"));
            else if (r.Qty is null) pr.Errors.Add("ไม่ได้กรอกจำนวน");
            else if (!StockImportFile.TryQty(r.Qty, out pr.QtyValue)) pr.Errors.Add("จำนวนต้องเป็นจำนวนเต็มมากกว่า 0");

            if (r.FormulaCols.Contains('C')) pr.Errors.Add(StockImportFile.FormulaMessage("วันหมดอายุ"));
            else if (r.Exp is null) pr.Errors.Add("ไม่ได้กรอกวันหมดอายุ");
            else if (!StockImportFile.TryExp(r.Exp, out var exp)) pr.Errors.Add("วันหมดอายุอ่านไม่ได้ — ใช้วันที่ใน Excel หรือข้อความ yyyy-mm-dd เท่านั้น");
            else
            {
                pr.ExpValue = exp;
                if (exp < today) pr.Errors.Add("วันหมดอายุย้อนหลัง");
                else if (exp.DayNumber - today.DayNumber < 7) pr.Warnings.Add("วันหมดอายุเหลือไม่ถึง 7 วัน");
            }
            pr.ProductId = prod is { IsActive: true } ? prod.Id : 0;
            rows.Add(pr);
        }

        // same code + same exp on several rows (valid rows only) -> warning, not blocking
        foreach (var g in rows.Where(x => x.Errors.Count == 0).GroupBy(x => (x.Code, x.ExpValue)).Where(g => g.Count() > 1))
            foreach (var x in g)
                x.Warnings.Add($"รหัส {x.Code} + วันหมดอายุ {x.ExpValue:yyyy-MM-dd} ซ้ำกับแถว {string.Join(", ", g.Where(y => y != x).Select(y => y.Row))}");

        var hasError = rows.Any(x => x.Errors.Count > 0);
        var okRows = rows.Where(x => x.Errors.Count == 0).ToList();
        var previewId = Guid.NewGuid().ToString("N");
        var knownBatches = await db.StockImportBatches.CountAsync(b => b.FileHash == hash);
        previews.Add(previewId,
            new PreviewData(UserId, file.FileName, hash, okRows.Select(x => new PreviewLot(x.ProductId, x.QtyValue, x.ExpValue)).ToList(), hasError, knownBatches));

        return Ok(new
        {
            previewId, fileHash = hash,
            rows = rows.Select(x => new
            {
                row = x.Row, code = x.Code, qty = x.Qty, expDate = x.ExpDate, productName = x.ProductName,
                status = x.Errors.Count > 0 ? "error" : x.Warnings.Count > 0 ? "warning" : "ok",
                messages = x.Errors.Concat(x.Warnings).ToList()
            }),
            summary = new
            {
                total = rows.Count,
                ok = rows.Count(x => x.Errors.Count == 0 && x.Warnings.Count == 0),
                error = rows.Count(x => x.Errors.Count > 0),
                warning = rows.Count(x => x.Errors.Count == 0 && x.Warnings.Count > 0),
                totalQty = okRows.Sum(x => x.QtyValue)
            },
            duplicateFile = knownBatches > 0
        });
    }

    [HttpPost("apply")]
    public async Task<IActionResult> Apply(ApplyRequest req)
    {
        var gone = StatusCode(StatusCodes.Status410Gone, new { error = "ไม่พบผลตรวจไฟล์หรือหมดอายุแล้ว กรุณาอัปโหลดใหม่" });
        var id = req.PreviewId;
        if (string.IsNullOrWhiteSpace(id)) return gone;
        var peek = previews.Peek(id);
        if (peek is null) return gone;
        if (peek.UserId != UserId) return StatusCode(StatusCodes.Status403Forbidden, new { error = "ผลตรวจไฟล์นี้เป็นของผู้ใช้อื่น" });

        // Reserve the preview atomically: only the request that removes it may continue, every concurrent one gets 410.
        if (!previews.TryTake(id, out var pv, out var expires)) return gone;
        var done = false;
        try
        {
            if (pv.HasError || pv.Lots.Count == 0)
                return UnprocessableEntity(new { error = "ไฟล์ยังมีแถวที่ผิด แก้ไฟล์แล้วอัปโหลดใหม่ (ไม่นำเข้าบางส่วน)" });

            // products/exp may have changed since preview
            var ids = pv.Lots.Select(l => l.ProductId).Distinct().ToList();
            var activeCount = await db.Products.CountAsync(p => ids.Contains(p.Id) && p.IsActive);
            if (activeCount != ids.Count || pv.Lots.Any(l => l.Exp < Today))
                return UnprocessableEntity(new { error = "ข้อมูลเปลี่ยนไปตั้งแต่ตรวจไฟล์ (สินค้าถูกปิดขายหรือวันหมดอายุผ่านไปแล้ว) กรุณาอัปโหลดใหม่" });

            // Serialise per file hash, then decide "is this a duplicate?" INSIDE the transaction that inserts the batch,
            // so a second request always sees the first one's batch.
            using var gate = await previews.LockAsync(pv.FileHash);
            var now = DateTime.UtcNow;
            await using var tx = await db.Database.BeginTransactionAsync();
            var batchesNow = await db.StockImportBatches.CountAsync(b => b.FileHash == pv.FileHash);
            if (batchesNow != pv.KnownBatches)
                // somebody imported this file after this preview was made: the user never saw/confirmed that state
                return Conflict(new { error = "ไฟล์นี้เพิ่งถูกนำเข้าโดยอีกคำสั่ง ตรวจไฟล์ใหม่อีกครั้งก่อนยืนยัน", duplicateFile = true, changed = true });
            if (batchesNow > 0 && req.ConfirmDuplicate != true)
                return Conflict(new { error = "ไฟล์นี้เคยนำเข้าสำเร็จแล้ว ถ้าต้องการนำเข้าซ้ำให้ยืนยัน (confirmDuplicate)", duplicateFile = true });
            var batch = new StockImportBatch
            {
                FileName = pv.FileName, FileHash = pv.FileHash, RowCount = pv.Lots.Count,
                TotalQty = pv.Lots.Sum(l => l.Qty), ImportedByUserId = pv.UserId, CreatedAt = now, PreviewId = id,
            };
            db.StockImportBatches.Add(batch);
            try
            {
                await db.SaveChangesAsync(); // 2nd line of defence: unique index on PreviewId
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
                await tx.RollbackAsync();
                done = true; // never give this preview back
                if (await db.StockImportBatches.AnyAsync(b => b.PreviewId == id)) return gone;
                throw;
            }
            var newLots = pv.Lots.Select(l => new StockLot
            {
                ProductId = l.ProductId, ReceivedQty = l.Qty, RemainingQty = l.Qty, ReceivedAt = now,
                ExpDate = l.Exp, ImportedByUserId = pv.UserId, BatchId = batch.Id
            }).ToList();
            db.StockLots.AddRange(newLots);
            foreach (var l in newLots) stock.AddImportMovement(l, batch.Id); // one movement per lot, same transaction
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            done = true;
            return Ok(new { batchId = batch.Id, lotsCreated = pv.Lots.Count, totalQty = batch.TotalQty });
        }
        finally
        {
            // stopped on something the user can fix (409 duplicate, 422) or an unexpected error: give the preview back
            if (!done && !Response.HasStarted) previews.Restore(id, pv, expires);
        }
    }

    class PreviewRow
    {
        public int Row; public string Code = ""; public string Qty = ""; public string ExpDate = ""; public string? ProductName;
        public int ProductId; public int QtyValue; public DateOnly ExpValue;
        public List<string> Errors = new(); public List<string> Warnings = new();
    }
}
