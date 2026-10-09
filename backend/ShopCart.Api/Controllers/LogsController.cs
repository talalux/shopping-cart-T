using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopCart.Api.Data;
using ShopCart.Api.Models;

namespace ShopCart.Api.Controllers;

/// <summary>Read-only history. There is deliberately no endpoint that edits or deletes these tables.</summary>
[ApiController]
[Authorize(Roles = Roles.Staff)]
public class LogsController(AppDb db) : ControllerBase
{
    static (int page, int size) Paging(int page, int pageSize) => (Math.Max(1, page), Math.Clamp(pageSize, 1, 100));

    [HttpGet("api/audit-logs")]
    public async Task<IActionResult> Audit(string? entity, string? entityId, int? userId, DateTime? from, DateTime? to, int page = 1, int pageSize = 50)
    {
        (page, pageSize) = Paging(page, pageSize);
        var q = db.AuditLogs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(entity)) q = q.Where(x => x.Entity == entity);
        if (!string.IsNullOrWhiteSpace(entityId)) q = q.Where(x => x.EntityId == entityId);
        if (userId is not null) q = q.Where(x => x.UserId == userId);
        if (from is not null) q = q.Where(x => x.At >= from.Value.ToUniversalTime());
        if (to is not null) q = q.Where(x => x.At <= to.Value.ToUniversalTime());
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new { items, page, pageSize, total, hasMore = (long)page * pageSize < total });
    }

    [HttpGet("api/stock-movements")]
    public async Task<IActionResult> Movements(int? productId, int? lotId, string? type, DateTime? from, DateTime? to, int page = 1, int pageSize = 50)
    {
        (page, pageSize) = Paging(page, pageSize);
        var q = db.StockMovements.AsNoTracking().AsQueryable();
        if (productId is not null) q = q.Where(x => x.ProductId == productId);
        if (lotId is not null) q = q.Where(x => x.StockLotId == lotId);
        if (!string.IsNullOrWhiteSpace(type)) q = q.Where(x => x.Type == type);
        if (from is not null) q = q.Where(x => x.At >= from.Value.ToUniversalTime());
        if (to is not null) q = q.Where(x => x.At <= to.Value.ToUniversalTime());
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(x => new { x.Id, x.At, x.StockLotId, x.ProductId, x.Type, x.Qty, x.BalanceAfter, x.OrderId, x.BatchId, x.UserId, x.Ip }).ToListAsync();
        return Ok(new { items, page, pageSize, total, hasMore = (long)page * pageSize < total });
    }

    [HttpGet("api/auth-logs")]
    public async Task<IActionResult> Auth(string? email, bool? success, DateTime? from, DateTime? to, int page = 1, int pageSize = 50)
    {
        (page, pageSize) = Paging(page, pageSize);
        var q = db.AuthLogs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(email)) q = q.Where(x => x.Email == email);
        if (success is not null) q = q.Where(x => x.Success == success);
        if (from is not null) q = q.Where(x => x.At >= from.Value.ToUniversalTime());
        if (to is not null) q = q.Where(x => x.At <= to.Value.ToUniversalTime());
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new { items, page, pageSize, total, hasMore = (long)page * pageSize < total });
    }
}
