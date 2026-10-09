using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ShopCart.Api.Data;
using ShopCart.Api.Models;
using ShopCart.Api.Services;

namespace ShopCart.Api.Controllers;

public record CheckoutRequest(List<CheckoutItem> Items);
public record GuestOrderRequest(string? Name, string? Email, string? Phone, List<CheckoutItem> Items);

[ApiController]
[Route("api/orders")]
public class OrdersController(AppDb db, StockService stock, INotifier notifier, IConfiguration cfg, AuditWriter audit) : ControllerBase
{
    static readonly Regex EmailRx = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);
    static readonly Regex PhoneRx = new(@"^0\d{9}$", RegexOptions.Compiled);

    const int MaxLineQty = 100_000;
    int UserId => int.Parse(User.FindFirst("sub")!.Value);

    // ---------- Customer (logged in): Confirmed immediately, stock cut now ----------
    [HttpPost("checkout"), Authorize(Roles = Roles.Customer + "," + Roles.Staff)]
    public async Task<IActionResult> Checkout(CheckoutRequest req)
    {
        var bad = ValidateItems(req.Items);
        if (bad is not null) return bad;

        await using var tx = await db.Database.BeginTransactionAsync();
        var (items, missing) = await stock.BuildItems(req.Items);
        if (missing is not null) return NotFound(new { error = $"ไม่พบสินค้า id {missing}" });

        var order = new Order { UserId = UserId, CreatedAt = DateTime.UtcNow, Status = OrderStatus.Confirmed, ConfirmedAt = DateTime.UtcNow, Items = items };
        order.Total = items.Sum(i => i.UnitPrice * i.Qty);

        var shortages = await stock.Allocate(items, order, MovementType.Sale);
        if (shortages.Count > 0)
        {
            await tx.RollbackAsync();
            return Conflict(new { error = "สินค้าไม่เพียงพอ", shortages });
        }
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Ok(Project(order));
    }

    [HttpGet("mine"), Authorize(Roles = Roles.Customer + "," + Roles.Staff)]
    public async Task<IActionResult> Mine()
    {
        var uid = UserId;
        var orders = await db.Orders.Where(o => o.UserId == uid).OrderByDescending(o => o.CreatedAt)
            .Select(o => new
            {
                o.Id, o.CreatedAt, o.Total, Status = o.Status.ToString(),
                Items = o.Items.Select(i => new
                {
                    i.ProductId, ProductCode = i.Product!.Code, ProductName = i.Product.Name, i.Qty, i.UnitPrice,
                    Lots = i.Lots.Select(l => new { l.StockLotId, l.Qty })
                })
            }).ToListAsync();
        return Ok(orders);
    }

    // ---------- Guest: create (no stock cut) -> notify -> confirm via token ----------
    [HttpPost("guest"), AllowAnonymous, EnableRateLimiting("guest")]
    public async Task<IActionResult> GuestCreate(GuestOrderRequest req)
    {
        var name = req.Name?.Trim();
        var email = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim();
        var phone = string.IsNullOrWhiteSpace(req.Phone) ? null : req.Phone.Trim();
        if (string.IsNullOrEmpty(name)) return BadRequest(new { error = "ต้องระบุชื่อ" });
        if (email is null && phone is null) return BadRequest(new { error = "ต้องระบุอีเมลหรือเบอร์โทรอย่างน้อย 1 อย่าง" });
        if (email is not null && !EmailRx.IsMatch(email)) return BadRequest(new { error = "รูปแบบอีเมลไม่ถูกต้อง" });
        if (phone is not null && !PhoneRx.IsMatch(phone)) return BadRequest(new { error = "เบอร์โทรต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0" });
        var bad = ValidateItems(req.Items);
        if (bad is not null) return bad;

        var (items, missing) = await stock.BuildItems(req.Items);
        if (missing is not null) return NotFound(new { error = $"ไม่พบสินค้า id {missing}" });

        var shortages = await stock.CheckAvailability(items); // preliminary only, stock is NOT cut
        if (shortages.Count > 0) return Conflict(new { error = "สินค้าไม่เพียงพอ", shortages });

        var now = DateTime.UtcNow;
        var order = new Order
        {
            UserId = null, GuestName = name, GuestEmail = email, GuestPhone = phone,
            CreatedAt = now, Status = OrderStatus.PendingConfirm,
            ConfirmToken = Guid.NewGuid(), TokenExpiresAt = now.AddMinutes(30), Items = items,
            Total = items.Sum(i => i.UnitPrice * i.Qty)
        };
        db.Orders.Add(order);
        await db.SaveChangesAsync();

        var channel = email is not null ? "email" : "sms";
        var target = email ?? phone!;
        var baseUrl = (cfg["FrontendBaseUrl"] ?? "http://localhost:3000").TrimEnd('/');
        await notifier.SendOrderConfirm(channel, target, $"{baseUrl}/orders/confirm/{order.ConfirmToken}", order);

        return Accepted(new { orderId = order.Id, channel, maskedTarget = channel == "email" ? MaskEmail(email!) : MaskPhone(phone!), expiresAt = order.TokenExpiresAt });
    }

    // New token + 30 more minutes; the old token stops working immediately. Same rate-limit policy as guest create.
    [HttpPost("guest/{orderId:int}/resend"), AllowAnonymous, EnableRateLimiting("guest")]
    public async Task<IActionResult> GuestResend(int orderId)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == orderId && o.UserId == null);
        if (order is null) return NotFound(new { error = "ไม่พบคำสั่งซื้อ" });
        if (order.Status != OrderStatus.PendingConfirm) return Conflict(new { error = "คำสั่งซื้อนี้ไม่อยู่ในสถานะรอยืนยัน" });

        var token = Guid.NewGuid();
        var expires = DateTime.UtcNow.AddMinutes(30);
        var oldExpires = order.TokenExpiresAt;
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            var rows = await db.Orders.Where(o => o.Id == orderId && o.Status == OrderStatus.PendingConfirm)
                .ExecuteUpdateAsync(s => s.SetProperty(o => o.ConfirmToken, token).SetProperty(o => o.TokenExpiresAt, expires));
            if (rows == 0) return Conflict(new { error = "คำสั่งซื้อนี้ไม่อยู่ในสถานะรอยืนยัน" });
            // ExecuteUpdate bypasses the audit interceptor, so write the row ourselves (same transaction). No token in it.
            audit.Add("Resend", "Order", orderId.ToString(), new Dictionary<string, object?>
            {
                ["Status"] = new { old = "PendingConfirm", @new = "PendingConfirm" },
                ["TokenExpiresAt"] = new { old = oldExpires, @new = expires },
                ["ConfirmToken"] = new { old = "***", @new = "***" },
            });
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }

        var channel = order.GuestEmail is not null ? "email" : "sms";
        var target = order.GuestEmail ?? order.GuestPhone!;
        var baseUrl = (cfg["FrontendBaseUrl"] ?? "http://localhost:3000").TrimEnd('/');
        await notifier.SendOrderConfirm(channel, target, $"{baseUrl}/orders/confirm/{token}", order);
        return Accepted(new { orderId = order.Id, channel, maskedTarget = channel == "email" ? MaskEmail(target) : MaskPhone(target), expiresAt = expires });
    }

    [HttpPost("confirm/{token:guid}"), AllowAnonymous]
    public async Task<IActionResult> Confirm(Guid token)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        var order = await db.Orders.Include(o => o.Items).ThenInclude(i => i.Product)
            .FirstOrDefaultAsync(o => o.ConfirmToken == token);
        if (order is null) return NotFound(new { error = "ไม่พบคำสั่งซื้อ" });

        if (order.Status == OrderStatus.Confirmed) return Ok(PublicView(order, alreadyConfirmed: true));
        if (order.Status == OrderStatus.Expired || order.TokenExpiresAt < DateTime.UtcNow)
        {
            var expiredRows = await db.Orders.Where(o => o.Id == order.Id && o.Status == OrderStatus.PendingConfirm)
                .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, OrderStatus.Expired));
            if (expiredRows > 0)
            {
                audit.Add("Expired", "Order", order.Id.ToString(), new Dictionary<string, object?>
                {
                    ["Status"] = new { old = "PendingConfirm", @new = "Expired" },
                    ["TokenExpiresAt"] = order.TokenExpiresAt,
                });
                await db.SaveChangesAsync();
            }
            await tx.CommitAsync();
            return StatusCode(StatusCodes.Status410Gone, new { error = "ลิงก์ยืนยันหมดอายุแล้ว กรุณาสั่งซื้อใหม่" });
        }

        // claim: conditional update guards against double confirm; same tx as the stock cut
        var confirmedAt = DateTime.UtcNow;
        var claimed = await db.Orders.Where(o => o.Id == order.Id && o.Status == OrderStatus.PendingConfirm)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, OrderStatus.Confirmed).SetProperty(o => o.ConfirmedAt, confirmedAt));
        if (claimed == 0)
        {
            await db.Entry(order).ReloadAsync();
            return order.Status == OrderStatus.Confirmed ? Ok(PublicView(order, alreadyConfirmed: true))
                : StatusCode(StatusCodes.Status410Gone, new { error = "ลิงก์ยืนยันหมดอายุแล้ว กรุณาสั่งซื้อใหม่" });
        }

        var shortages = await stock.Allocate(order.Items, order, MovementType.GuestConfirm);
        if (shortages.Count > 0)
        {
            await tx.RollbackAsync(); // status goes back to PendingConfirm, nothing cut
            return Conflict(new { error = "สินค้าไม่เพียงพอ", shortages });
        }
        order.Status = OrderStatus.Confirmed; order.ConfirmedAt = confirmedAt;
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Ok(PublicView(order));
    }

    [HttpGet("by-token/{token:guid}"), AllowAnonymous]
    public async Task<IActionResult> ByToken(Guid token)
    {
        var order = await db.Orders.Include(o => o.Items).ThenInclude(i => i.Product)
            .FirstOrDefaultAsync(o => o.ConfirmToken == token);
        if (order is null) return NotFound(new { error = "ไม่พบคำสั่งซื้อ" });
        return Ok(PublicView(order));
    }

    // ---------- helpers ----------
    IActionResult? ValidateItems(List<CheckoutItem>? items)
    {
        if (items is null || items.Count == 0) return BadRequest(new { error = "ตะกร้าว่าง" });
        if (items.Any(i => i.Qty <= 0)) return BadRequest(new { error = "จำนวนต้องมากกว่า 0" });
        // per line AND after merging duplicate lines (sum as long so it cannot overflow)
        if (items.GroupBy(i => i.ProductId).Any(g => g.Sum(x => (long)x.Qty) > MaxLineQty))
            return BadRequest(new { error = $"จำนวนต่อรายการต้องไม่เกิน {MaxLineQty:N0} ชิ้น" });
        return null;
    }

    static string MaskEmail(string e)
    {
        var at = e.IndexOf('@');
        return e[0] + new string('*', Math.Max(at - 1, 2)) + e[at..];
    }
    static string MaskPhone(string p) => p[..2] + new string('*', p.Length - 4) + p[^2..];

    static object Project(Order o) => new
    {
        o.Id, o.CreatedAt, o.Total, Status = o.Status.ToString(),
        Items = o.Items.Select(i => new { i.ProductId, i.Qty, i.UnitPrice, Lots = i.Lots.Select(l => new { l.StockLotId, l.Qty }) })
    };

    // public view for guests: no token, email/phone masked
    static object PublicView(Order o, bool alreadyConfirmed = false) => new
    {
        alreadyConfirmed, o.Id, Status = o.Status.ToString(), o.CreatedAt, o.ConfirmedAt, o.TokenExpiresAt, o.Total, o.GuestName,
        MaskedEmail = o.GuestEmail is null ? null : MaskEmail(o.GuestEmail),
        MaskedPhone = o.GuestPhone is null ? null : MaskPhone(o.GuestPhone),
        Items = o.Items.Select(i => new { i.ProductId, ProductCode = i.Product?.Code, ProductName = i.Product?.Name, i.Qty, i.UnitPrice })
    };
}
