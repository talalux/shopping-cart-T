using Microsoft.EntityFrameworkCore;
using ShopCart.Api.Models;

namespace ShopCart.Api.Data;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<StockLot> StockLots => Set<StockLot>();
    public DbSet<StockImportBatch> StockImportBatches => Set<StockImportBatch>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<AuthLog> AuthLogs => Set<AuthLog>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<OrderItemLot> OrderItemLots => Set<OrderItemLot>();

    // SQLite stores DateTime as text with no zone, so EF reads Kind=Unspecified. Everything we store is UTC:
    // read back as Utc so JSON gets the trailing Z (one place, applies to every DateTime column).
    protected override void ConfigureConventions(ModelConfigurationBuilder cb)
    {
        cb.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        cb.Properties<DateTime?>().HaveConversion<NullableUtcDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>().HasIndex(x => x.Code).IsUnique();
        b.Entity<StockImportBatch>().HasIndex(x => x.FileHash);
        b.Entity<StockImportBatch>().HasIndex(x => x.PreviewId).IsUnique();
        b.Entity<StockLot>().HasOne<StockImportBatch>().WithMany().HasForeignKey(x => x.BatchId);
        b.Entity<AuditLog>().HasIndex(x => x.At);
        b.Entity<AuditLog>().HasIndex(x => new { x.Entity, x.EntityId });
        b.Entity<StockMovement>().HasIndex(x => new { x.ProductId, x.At });
        b.Entity<StockMovement>().HasIndex(x => x.StockLotId);
        b.Entity<StockMovement>().HasOne(x => x.StockLot).WithMany().HasForeignKey(x => x.StockLotId);
        b.Entity<StockMovement>().HasOne(x => x.Order).WithMany().HasForeignKey(x => x.OrderId);
        b.Entity<AuthLog>().HasIndex(x => x.At);
        b.Entity<AuthLog>().HasIndex(x => new { x.Email, x.At });
        b.Entity<User>().HasIndex(x => x.Email).IsUnique();
        b.Entity<StockLot>().HasOne(x => x.Product).WithMany(p => p.Lots).HasForeignKey(x => x.ProductId);
        b.Entity<StockLot>().HasIndex(x => new { x.ProductId, x.ExpDate });
        b.Entity<OrderItem>().HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId);
        b.Entity<Order>().HasMany(o => o.Items).WithOne().HasForeignKey(i => i.OrderId);
        b.Entity<OrderItem>().HasMany(i => i.Lots).WithOne().HasForeignKey(l => l.OrderItemId);
        // SQLite has no native decimal (EF would store TEXT and block ORDER BY/SUM): store money as double.
        b.Entity<Product>().Property(x => x.Price).HasConversion<double>();
        b.Entity<Order>().Property(x => x.Status).HasConversion<string>();
        b.Entity<Order>().HasIndex(x => x.ConfirmToken).IsUnique();
        b.Entity<Order>().Property(x => x.Total).HasConversion<double>();
        b.Entity<OrderItem>().Property(x => x.UnitPrice).HasConversion<double>();
    }
}

public class UtcDateTimeConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime, DateTime>(
    v => v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v,
    v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

public class NullableUtcDateTimeConverter() : Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime?, DateTime?>(
    v => v.HasValue && v.Value.Kind == DateTimeKind.Local ? v.Value.ToUniversalTime() : v,
    v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
