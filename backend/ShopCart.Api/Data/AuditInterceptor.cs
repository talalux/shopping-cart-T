using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ShopCart.Api.Models;
using ShopCart.Api.Services;

namespace ShopCart.Api.Data;

/// <summary>
/// Writes an AuditLog row for every Added/Modified/Deleted entity in the same SaveChanges (same transaction).
/// Skips the log tables themselves. PasswordHash / ConfirmToken are masked as "***".
/// Added rows get their real key after the insert (SavedChanges), never 0.
/// Note: ExecuteUpdate/ExecuteDelete bypass SaveChanges, so stock changes are covered by StockMovement instead.
/// </summary>
public sealed class AuditInterceptor(ICurrentUser user) : SaveChangesInterceptor
{
    static readonly HashSet<Type> Skip = [typeof(AuditLog), typeof(StockMovement), typeof(AuthLog)];
    static readonly HashSet<string> Masked = ["PasswordHash", "ConfirmToken"];
    static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    readonly List<(AuditLog Row, EntityEntry Entry)> _added = [];

    public override InterceptionResult<int> SavingChanges(DbContextEventData e, InterceptionResult<int> result)
    {
        Capture(e.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> result, CancellationToken ct = default)
    {
        Capture(e.Context);
        return new(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData e, int result)
    {
        FixIds(e.Context);
        return result;
    }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData e, int result, CancellationToken ct = default)
    {
        FixIds(e.Context);
        return new(result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData e) => _added.Clear();
    public override Task SaveChangesFailedAsync(DbContextErrorEventData e, CancellationToken ct = default) { _added.Clear(); return Task.CompletedTask; }

    void Capture(DbContext? ctx)
    {
        if (ctx is null) return;
        _added.Clear();
        ctx.ChangeTracker.DetectChanges();
        var entries = ctx.ChangeTracker.Entries()
            .Where(x => x.State is EntityState.Added or EntityState.Modified or EntityState.Deleted && !Skip.Contains(x.Metadata.ClrType))
            .ToList();
        var now = DateTime.UtcNow;
        var rows = new List<AuditLog>();
        foreach (var en in entries)
        {
            var changes = new Dictionary<string, Dictionary<string, object?>>();
            foreach (var p in en.Properties)
            {
                if (p.IsTemporary) continue; // generated key not known yet (real id goes to EntityId)
                var name = p.Metadata.Name;
                object? Val(object? v) => v is null ? null : Masked.Contains(name) ? "***" : v;
                switch (en.State)
                {
                    case EntityState.Added:
                        if (p.CurrentValue is not null) changes[name] = new() { ["new"] = Val(p.CurrentValue) };
                        break;
                    case EntityState.Deleted:
                        if (p.OriginalValue is not null) changes[name] = new() { ["old"] = Val(p.OriginalValue) };
                        break;
                    case EntityState.Modified:
                        if (p.IsModified && !Equals(p.OriginalValue, p.CurrentValue))
                            changes[name] = new() { ["old"] = Val(p.OriginalValue), ["new"] = Val(p.CurrentValue) };
                        break;
                }
            }
            if (en.State == EntityState.Modified && changes.Count == 0) continue;
            var row = new AuditLog
            {
                At = now, UserId = user.UserId, Email = user.Email, Role = user.Role, Ip = user.Ip,
                Action = en.State.ToString(), Entity = en.Metadata.ClrType.Name,
                EntityId = en.State == EntityState.Added ? "" : KeyOf(en),
                Changes = JsonSerializer.Serialize(changes, Json),
            };
            rows.Add(row);
            if (en.State == EntityState.Added) _added.Add((row, en));
        }
        if (rows.Count > 0) ctx.Set<AuditLog>().AddRange(rows);
    }

    static string KeyOf(EntityEntry en) =>
        string.Join(",", en.Properties.Where(p => p.Metadata.IsPrimaryKey()).Select(p => p.CurrentValue?.ToString()));

    void FixIds(DbContext? ctx)
    {
        if (ctx is null || _added.Count == 0) return;
        var pending = _added.ToList();
        _added.Clear();
        foreach (var (row, entry) in pending)
        {
            var id = KeyOf(entry);
            var rowId = row.Id;
            ctx.Set<AuditLog>().Where(a => a.Id == rowId).ExecuteUpdate(s => s.SetProperty(a => a.EntityId, id));
            ctx.Entry(row).State = EntityState.Detached;
        }
    }
}
