using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopCart.Api.Data;
using ShopCart.Api.Models;

namespace ShopCart.Api.Controllers;

public record ProductRequest(string Code, string Name, string Type, decimal Price, bool? IsActive);

[ApiController]
[Route("api/products")]
public class ProductsController(AppDb db, IConfiguration cfg) : ControllerBase
{
    static DateOnly Today => DateOnly.FromDateTime(DateTime.Today);
    int NearDays => cfg.GetValue("Stock:NearExpiryDays", 7);

    // The server is the only place that decides "near expiry" (same Today that decides what is sellable).
    int? DaysLeft(DateOnly? exp, DateOnly today) => exp is { } d ? d.DayNumber - today.DayNumber : null;
    bool IsNear(int? daysLeft) => daysLeft is { } n && n <= NearDays;
    string LotState(DateOnly exp, DateOnly today) => exp < today ? "expired" : IsNear(exp.DayNumber - today.DayNumber) ? "near" : "ok";

    // Stock = SUM(RemainingQty) of lots not expired (aggregated in DB, never loads lots into memory).
    // Paged: ?page=1&pageSize=24&q=&type=
    [HttpGet]
    public async Task<IActionResult> List(int page = 1, int pageSize = 24, string? q = null, string? type = null)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var today = Today;
        var query = db.Products.Where(p => p.IsActive);
        if (!string.IsNullOrWhiteSpace(type)) query = query.Where(p => p.Type == type);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var t = q.Trim();
            // LIKE is case-insensitive for ASCII on SQLite and runs in the DB; % _ \ in the search text are literals, not wildcards
            var pat = "%" + t.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
            query = query.Where(p => EF.Functions.Like(p.Code, pat, "\\") || EF.Functions.Like(p.Name, pat, "\\"));
        }
        var total = await query.CountAsync();
        var items = await query.OrderBy(p => p.Name).ThenBy(p => p.Id).Skip((page - 1) * pageSize).Take(pageSize).Select(p => new
        {
            p.Id, p.Code, p.Name, p.Type, Price = p.Price,
            Stock = p.Lots.Where(l => l.ExpDate >= today).Sum(l => (int?)l.RemainingQty) ?? 0,
            NearestExp = p.Lots.Where(l => l.ExpDate >= today && l.RemainingQty > 0).Min(l => (DateOnly?)l.ExpDate)
        }).ToListAsync();
        var shaped = items.Select(i => new
        {
            i.Id, i.Code, i.Name, i.Type, i.Price, i.Stock, i.NearestExp,
            DaysLeft = DaysLeft(i.NearestExp, today), NearExpiry = IsNear(DaysLeft(i.NearestExp, today)),
        });
        return Ok(new { items = shaped, page, pageSize, total, hasMore = (long)page * pageSize < total });
    }

    // Shop filter chips: only types that have an active product with sellable stock right now (decided in the DB).
    [HttpGet("types")]
    public async Task<IActionResult> Types()
    {
        var today = Today;
        return Ok(await db.Products
            .Where(p => p.IsActive && p.Lots.Any(l => l.ExpDate >= today && l.RemainingQty > 0))
            .Select(p => p.Type).Distinct().OrderBy(t => t).ToListAsync());
    }

    // Admin datalist: every type in use (incl. inactive products / no stock)
    [HttpGet("admin/types"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> AdminTypes() =>
        Ok(await db.Products.Select(p => p.Type).Distinct().OrderBy(t => t).ToListAsync());

    // Staff: every product (incl. inactive) with sellable stock and expired qty
    [HttpGet("admin"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> AdminList()
    {
        var today = Today;
        var rows = await db.Products.OrderBy(p => p.Code).Select(p => new
        {
            p.Id, p.Code, p.Name, p.Type, Price = p.Price, p.IsActive,
            Stock = p.Lots.Where(l => l.ExpDate >= today).Sum(l => (int?)l.RemainingQty) ?? 0,
            ExpiredQty = p.Lots.Where(l => l.ExpDate < today).Sum(l => (int?)l.RemainingQty) ?? 0,
            NearestExp = p.Lots.Where(l => l.ExpDate >= today && l.RemainingQty > 0).Min(l => (DateOnly?)l.ExpDate)
        }).ToListAsync();
        return Ok(rows.Select(r => new
        {
            r.Id, r.Code, r.Name, r.Type, r.Price, r.IsActive, r.Stock, r.ExpiredQty, r.NearestExp,
            DaysLeft = DaysLeft(r.NearestExp, today), NearExpiry = IsNear(DaysLeft(r.NearestExp, today)),
        }));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var today = Today;
        var p = await db.Products.Include(x => x.Lots).FirstOrDefaultAsync(x => x.Id == id);
        if (p is null || (!p.IsActive && !User.IsInRole(Roles.Staff))) return NotFound();
        var sellable = p.Lots.Where(l => l.ExpDate >= today).ToList();
        var nearest = sellable.Where(l => l.RemainingQty > 0).Select(l => (DateOnly?)l.ExpDate).Min();
        object? lots = User.IsInRole(Roles.Staff)
            ? p.Lots.OrderBy(l => l.ExpDate).ThenBy(l => l.ReceivedAt).ThenBy(l => l.Id)
                .Select(l => new { l.Id, l.ReceivedQty, l.RemainingQty, l.ReceivedAt, l.ExpDate, Expired = l.ExpDate < today, DaysLeft = l.ExpDate.DayNumber - today.DayNumber, State = LotState(l.ExpDate, today), l.ImportedByUserId })
            : null;
        return Ok(new
        {
            p.Id, p.Code, p.Name, p.Type, p.Price, p.IsActive,
            Stock = sellable.Sum(l => l.RemainingQty),
            NearestExp = nearest, DaysLeft = DaysLeft(nearest, today), NearExpiry = IsNear(DaysLeft(nearest, today)),
            Lots = lots
        });
    }

    [HttpPost, Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Create(ProductRequest r)
    {
        var err = Validate(r);
        if (err is not null) return BadRequest(new { error = err });
        var code = r.Code.Trim().ToUpperInvariant();
        if (await db.Products.AnyAsync(x => x.Code == code)) return Conflict(new { error = $"รหัสสินค้า {code} ซ้ำ" });
        var p = new Product { Code = code, Name = r.Name.Trim(), Type = await NormalizeType(r.Type), Price = r.Price, IsActive = r.IsActive ?? true };
        db.Products.Add(p);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = p.Id }, new { p.Id, p.Code, p.Name, p.Type, p.Price, p.IsActive });
    }

    [HttpPut("{id:int}"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Update(int id, ProductRequest r)
    {
        var err = Validate(r);
        if (err is not null) return BadRequest(new { error = err });
        var p = await db.Products.FindAsync(id);
        if (p is null) return NotFound();
        var code = r.Code.Trim().ToUpperInvariant();
        if (await db.Products.AnyAsync(x => x.Code == code && x.Id != id)) return Conflict(new { error = $"รหัสสินค้า {code} ซ้ำ" });
        p.Code = code; p.Name = r.Name.Trim(); p.Type = await NormalizeType(r.Type); p.Price = r.Price;
        if (r.IsActive.HasValue) p.IsActive = r.IsActive.Value;
        await db.SaveChangesAsync();
        return Ok(new { p.Id, p.Code, p.Name, p.Type, p.Price, p.IsActive });
    }

    [HttpDelete("{id:int}"), Authorize(Roles = Roles.Staff)]
    public async Task<IActionResult> Delete(int id)
    {
        var p = await db.Products.FindAsync(id);
        if (p is null) return NotFound();
        p.IsActive = false; // soft delete
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Trim + collapse inner whitespace; if the same type already exists ignoring case, reuse its spelling.</summary>
    async Task<string> NormalizeType(string raw)
    {
        var t = System.Text.RegularExpressions.Regex.Replace(raw.Trim(), @"\s+", " ");
        var existing = await db.Products.Select(p => p.Type).Distinct().ToListAsync();
        return existing.FirstOrDefault(e => string.Equals(e, t, StringComparison.OrdinalIgnoreCase)) ?? t;
    }

    static string? Validate(ProductRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Type)) return "ต้องระบุ Type";
        if (string.IsNullOrWhiteSpace(r.Code)) return "ต้องระบุรหัสสินค้า";
        if (string.IsNullOrWhiteSpace(r.Name)) return "ต้องระบุชื่อสินค้า";
        if (r.Price < 0) return "ราคาต้องไม่ติดลบ";
        return null;
    }
}
