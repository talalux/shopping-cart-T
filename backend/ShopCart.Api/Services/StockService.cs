using Microsoft.EntityFrameworkCore;
using ShopCart.Api.Data;
using ShopCart.Api.Models;

namespace ShopCart.Api.Services;

public record CheckoutItem(int ProductId, int Qty);

/// <summary>Shared FEFO logic for customer checkout and guest confirm.</summary>
public class StockService(AppDb db, ICurrentUser user)
{
    static DateOnly Today => DateOnly.FromDateTime(DateTime.Today);

    /// <summary>Merge duplicate lines, load active products, snapshot server price. missingProductId set if a product is not found/inactive.</summary>
    public async Task<(List<OrderItem> Items, int? MissingProductId)> BuildItems(IEnumerable<CheckoutItem> req)
    {
        var items = new List<OrderItem>();
        foreach (var g in req.GroupBy(i => i.ProductId))
        {
            var p = await db.Products.FirstOrDefaultAsync(x => x.Id == g.Key && x.IsActive);
            if (p is null) return (items, g.Key);
            items.Add(new OrderItem { ProductId = p.Id, Product = p, Qty = (int)Math.Min(g.Sum(x => (long)x.Qty), int.MaxValue), UnitPrice = p.Price });
        }
        return (items, null);
    }

    /// <summary>Read-only availability check. Returns shortages (empty = ok).</summary>
    public async Task<List<object>> CheckAvailability(IEnumerable<OrderItem> items)
    {
        var shortages = new List<object>();
        foreach (var it in items)
        {
            var (lots, expired) = await LoadLots(it.ProductId);
            var s = Shortage(it, lots.Sum(l => l.RemainingQty), expired);
            if (s is not null) shortages.Add(s);
        }
        return shortages;
    }

    /// <summary>
    /// FEFO allocate + decrement stock. MUST be called inside a caller-owned transaction;
    /// if the result is non-empty the caller must roll back. Fills item.Lots.
    /// </summary>
    public async Task<List<object>> Allocate(IEnumerable<OrderItem> items, Order order, string movementType)
    {
        var shortages = new List<object>();
        foreach (var it in items)
        {
            var (lots, expired) = await LoadLots(it.ProductId);
            var s = Shortage(it, lots.Sum(l => l.RemainingQty), expired);
            if (s is not null) { shortages.Add(s); continue; }

            var need = it.Qty;
            foreach (var lot in lots)
            {
                if (need == 0) break;
                var take = Math.Min(need, lot.RemainingQty);
                // guarded decrement: re-check RemainingQty inside the UPDATE (see README on concurrency)
                var rows = await db.StockLots.Where(l => l.Id == lot.Id && l.RemainingQty >= take)
                    .ExecuteUpdateAsync(x => x.SetProperty(l => l.RemainingQty, l => l.RemainingQty - take));
                if (rows == 0)
                {
                    shortages.Add(Shortage(it, 0, expired, "stock เปลี่ยนระหว่างสั่ง ลองใหม่")!);
                    need = -1; break;
                }
                // the single place where lot quantity leaves stock: always paired with a StockMovement in the same transaction
                var balance = await db.StockLots.AsNoTracking().Where(l => l.Id == lot.Id).Select(l => l.RemainingQty).SingleAsync();
                db.StockMovements.Add(new StockMovement
                {
                    At = DateTime.UtcNow, StockLotId = lot.Id, ProductId = it.ProductId, Type = movementType, Qty = -take,
                    BalanceAfter = balance, Order = order, UserId = user.UserId, Ip = user.Ip,
                });
                it.Lots.Add(new OrderItemLot { StockLotId = lot.Id, Qty = take });
                need -= take;
            }
        }
        return shortages;
    }

    /// <summary>Movement for a newly received lot (call before SaveChanges; lot may still be unsaved).</summary>
    public StockMovement AddImportMovement(StockLot lot, int? batchId)
    {
        var m = ImportMovement(lot, batchId, user.UserId ?? lot.ImportedByUserId, user.Ip);
        db.StockMovements.Add(m);
        return m;
    }

    public static StockMovement ImportMovement(StockLot lot, int? batchId, int? userId, string? ip) => new()
    {
        At = DateTime.UtcNow, ProductId = lot.ProductId, Type = MovementType.Import, Qty = lot.ReceivedQty,
        // unsaved lot (Id 0): link by navigation so EF fills in the real id; saved lot: plain FK
        StockLot = lot.Id == 0 ? lot : null, StockLotId = lot.Id,
        BalanceAfter = lot.RemainingQty, BatchId = batchId, UserId = userId, Ip = ip,
    };

    // FEFO order: earliest exp, then earliest received, then id. Expired / empty lots never selected.
    async Task<(List<StockLot> Lots, int ExpiredQty)> LoadLots(int productId)
    {
        var today = Today;
        var lots = await db.StockLots
            .Where(l => l.ProductId == productId && l.ExpDate >= today && l.RemainingQty > 0)
            .OrderBy(l => l.ExpDate).ThenBy(l => l.ReceivedAt).ThenBy(l => l.Id).ToListAsync();
        var expired = await db.StockLots.Where(l => l.ProductId == productId && l.ExpDate < today)
            .SumAsync(l => (int?)l.RemainingQty) ?? 0;
        return (lots, expired);
    }

    static object? Shortage(OrderItem it, int available, int expiredQty, string? note = null)
    {
        if (available >= it.Qty && note is null) return null;
        return new
        {
            productId = it.ProductId, code = it.Product?.Code, name = it.Product?.Name,
            requested = it.Qty, available, short_by = it.Qty - available, expired_qty = expiredQty, note
        };
    }
}
