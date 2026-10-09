namespace ShopCart.Api.Models;

public static class Roles { public const string Staff = "Staff"; public const string Customer = "Customer"; }

public class Product
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public decimal Price { get; set; }
    public bool IsActive { get; set; } = true;
    public List<StockLot> Lots { get; set; } = new();
}

public class StockLot
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public int ReceivedQty { get; set; }
    public int RemainingQty { get; set; }
    public DateTime ReceivedAt { get; set; }
    public DateOnly ExpDate { get; set; }
    public int ImportedByUserId { get; set; }
    public int? BatchId { get; set; }
}

public class StockImportBatch
{
    public int Id { get; set; }
    public string FileName { get; set; } = "";
    public string FileHash { get; set; } = "";
    public int RowCount { get; set; }
    public int TotalQty { get; set; }
    public int ImportedByUserId { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>The preview this batch was applied from. Unique: a second apply of the same preview cannot insert.</summary>
    public string? PreviewId { get; set; }
}

public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = Roles.Customer;
}

public enum OrderStatus { PendingConfirm, Confirmed, Expired }

public class Order
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public string? GuestName { get; set; }
    public string? GuestEmail { get; set; }
    public string? GuestPhone { get; set; }
    public OrderStatus Status { get; set; } = OrderStatus.Confirmed;
    public Guid? ConfirmToken { get; set; }
    public DateTime? TokenExpiresAt { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public decimal Total { get; set; }
    public List<OrderItem> Items { get; set; } = new();
}

public class OrderItem
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public int Qty { get; set; }
    public decimal UnitPrice { get; set; }
    public List<OrderItemLot> Lots { get; set; } = new();
}

public class OrderItemLot
{
    public int Id { get; set; }
    public int OrderItemId { get; set; }
    public int StockLotId { get; set; }
    public int Qty { get; set; }
}

public static class MovementType { public const string Import = "Import"; public const string Sale = "Sale"; public const string GuestConfirm = "GuestConfirm"; }

/// <summary>Automatic change history (written by AuditInterceptor). Never edited or deleted.</summary>
public class AuditLog
{
    public long Id { get; set; }
    public DateTime At { get; set; }
    public int? UserId { get; set; }
    public string? Email { get; set; }
    public string? Role { get; set; }
    public string? Ip { get; set; }
    public string Action { get; set; } = "";   // Added | Modified | Deleted
    public string Entity { get; set; } = "";
    public string EntityId { get; set; } = "";
    public string Changes { get; set; } = "{}"; // {field:{old,new}}
}

/// <summary>Every change of a lot's RemainingQty. SUM(Qty) per lot must equal StockLot.RemainingQty.</summary>
public class StockMovement
{
    public long Id { get; set; }
    public DateTime At { get; set; }
    public int StockLotId { get; set; }
    public StockLot? StockLot { get; set; }
    public int ProductId { get; set; }
    public string Type { get; set; } = "";      // Import | Sale | GuestConfirm
    public int Qty { get; set; }                // + in, - out
    public int BalanceAfter { get; set; }
    public int? OrderId { get; set; }
    public Order? Order { get; set; }
    public int? BatchId { get; set; }
    public int? UserId { get; set; }
    public string? Ip { get; set; }
}

public class AuthLog
{
    public long Id { get; set; }
    public DateTime At { get; set; }
    public string Email { get; set; } = "";      // as typed (never the password)
    public int? UserId { get; set; }
    public bool Success { get; set; }
    public string Reason { get; set; } = "";    // ok | bad_password | unknown_email | logout
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
}
