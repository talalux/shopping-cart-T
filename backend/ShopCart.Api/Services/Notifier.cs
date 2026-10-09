using System.Text;
using ShopCart.Api.Models;

namespace ShopCart.Api.Services;

public interface INotifier
{
    /// <summary>channel = "email" | "sms"</summary>
    Task SendOrderConfirm(string channel, string target, string link, Order order);
}

/// <summary>Dev only: writes the message to outbox/{timestamp}-{orderId}.txt and logs it. Replace with SMTP/SMS class later.</summary>
public class DevOutboxNotifier(IHostEnvironment env, ILogger<DevOutboxNotifier> log) : INotifier
{
    public async Task SendOrderConfirm(string channel, string target, string link, Order order)
    {
        var dir = Path.Combine(env.ContentRootPath, "outbox");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{order.Id}.txt");
        var sb = new StringBuilder();
        sb.AppendLine($"ช่องทาง: {channel}");
        sb.AppendLine($"ถึง: {target}");
        sb.AppendLine($"หัวข้อ: กรุณายืนยันคำสั่งซื้อ #{order.Id}");
        sb.AppendLine();
        sb.AppendLine($"สวัสดีคุณ {order.GuestName}");
        sb.AppendLine($"เราได้รับคำสั่งซื้อ #{order.Id} ยอดรวม {order.Total:N2} บาท แล้ว");
        sb.AppendLine("กรุณากดลิงก์ด้านล่างเพื่อยืนยัน (ลิงก์หมดอายุใน 30 นาที) สต็อกจะถูกตัดเมื่อยืนยันแล้วเท่านั้น");
        sb.AppendLine();
        sb.AppendLine(link);
        await File.WriteAllTextAsync(path, sb.ToString(), new UTF8Encoding(false));
        log.LogInformation("[DevOutbox] order {OrderId} via {Channel} written to {File}", order.Id, channel, Path.GetFileName(path)); // never log the link/token
    }
}
