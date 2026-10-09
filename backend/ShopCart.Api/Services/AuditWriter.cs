using System.Text.Encodings.Web;
using System.Text.Json;
using ShopCart.Api.Data;
using ShopCart.Api.Models;

namespace ShopCart.Api.Services;

/// <summary>
/// For changes made with ExecuteUpdate/ExecuteDelete (they bypass the SaveChanges interceptor): the caller writes the
/// audit row itself, in the same transaction, then SaveChanges. Never put a token in `changes`.
/// </summary>
public class AuditWriter(AppDb db, ICurrentUser user)
{
    static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public void Add(string action, string entity, string entityId, object changes) =>
        db.AuditLogs.Add(new AuditLog
        {
            At = DateTime.UtcNow, UserId = user.UserId, Email = user.Email, Role = user.Role, Ip = user.Ip,
            Action = action, Entity = entity, EntityId = entityId, Changes = JsonSerializer.Serialize(changes, Json),
        });
}
