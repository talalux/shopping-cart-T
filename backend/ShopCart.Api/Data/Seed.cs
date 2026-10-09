using Microsoft.EntityFrameworkCore;
using ShopCart.Api.Models;

namespace ShopCart.Api.Data;

public static class Seed
{
    public static void Run(AppDb db)
    {
        db.Database.EnsureCreated();
        if (db.Users.Any()) return;
        var hash = BCrypt.Net.BCrypt.HashPassword("Test1234!");
        var staff = new User { Email = "staff@example.com", PasswordHash = hash, Role = Roles.Staff };
        db.Users.AddRange(staff, new User { Email = "staff2@example.com", PasswordHash = hash, Role = Roles.Staff }, new User { Email = "customer@example.com", PasswordHash = hash, Role = Roles.Customer });
        db.SaveChanges();

        var today = DateOnly.FromDateTime(DateTime.Today);
        var now = DateTime.UtcNow;
        Product P(string c, string n, string t, decimal pr) => new() { Code = c, Name = n, Type = t, Price = pr };
        var milk = P("MILK-001", "นมสดพาสเจอร์ไรส์ 1L", "Dairy", 45);
        var yog = P("YOG-001", "โยเกิร์ตรสธรรมชาติ", "Dairy", 18);
        var bread = P("BRD-001", "ขนมปังแซนด์วิช", "Bakery", 35);
        var egg = P("EGG-001", "ไข่ไก่ เบอร์ 2 (แผง)", "Fresh", 110);
        var juice = P("JUI-001", "น้ำส้มคั้น 500ml", "Beverage", 40);
        db.Products.AddRange(milk, yog, bread, egg, juice);
        db.SaveChanges();

        StockLot L(Product p, int qty, int expDays, int recvDaysAgo) => new()
        {
            ProductId = p.Id, ReceivedQty = qty, RemainingQty = qty,
            ReceivedAt = now.AddDays(-recvDaysAgo), ExpDate = today.AddDays(expDays), ImportedByUserId = staff.Id
        };
        db.StockLots.AddRange(
            L(milk, 10, 10, 3),   // later exp
            L(milk, 5, 3, 5),     // earlier exp -> FEFO picks first
            L(milk, 20, -2, 10),  // expired, must never be sold
            L(yog, 30, 14, 2),
            L(bread, 8, 2, 1), L(bread, 12, 6, 1),
            L(egg, 40, 20, 4),
            L(juice, 7, -1, 8));  // only expired lot -> stock 0
        db.SaveChanges();
        // every seeded lot starts with an Import movement so SUM(movements) == RemainingQty from day one
        db.StockMovements.AddRange(db.StockLots.AsNoTracking().ToList()
            .Select(l => Services.StockService.ImportMovement(l, null, l.ImportedByUserId, null)));
        db.SaveChanges();
    }
}
