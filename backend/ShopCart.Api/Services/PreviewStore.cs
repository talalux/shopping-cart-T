using System.Collections.Concurrent;

namespace ShopCart.Api.Services;

public record PreviewLot(int ProductId, int Qty, DateOnly Exp);
/// <param name="KnownBatches">How many batches with this file hash existed when the preview was made (what the user saw / confirmed).</param>
public record PreviewData(int UserId, string FileName, string FileHash, List<PreviewLot> Lots, bool HasError, int KnownBatches = 0);

/// <summary>
/// Preview results (10 min TTL, owned by the uploading user). TryTake is atomic: of N concurrent apply calls for the
/// same previewId exactly one gets the data, the others get nothing (410). Restore puts it back when the apply stops
/// on an error the user can fix (duplicate file not confirmed, row errors).
/// </summary>
public class PreviewStore
{
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);
    readonly ConcurrentDictionary<string, (PreviewData Data, DateTime Expires)> _d = new();

    public void Add(string id, PreviewData data)
    {
        Purge();
        _d[id] = (data, DateTime.UtcNow + Ttl);
    }

    /// <summary>Look without consuming (owner check).</summary>
    public PreviewData? Peek(string id) =>
        _d.TryGetValue(id, out var e) && e.Expires > DateTime.UtcNow ? e.Data : null;

    public bool TryTake(string id, out PreviewData data, out DateTime expires)
    {
        if (_d.TryRemove(id, out var e) && e.Expires > DateTime.UtcNow) { data = e.Data; expires = e.Expires; return true; }
        data = null!; expires = default;
        return false;
    }

    public void Restore(string id, PreviewData data, DateTime expires)
    {
        if (expires > DateTime.UtcNow) _d[id] = (data, expires);
    }

    // One apply at a time per file hash (in-process; with several instances / SQL Server use sp_getapplock or UPDLOCK instead).
    readonly ConcurrentDictionary<string, SemaphoreSlim> _gates = new();

    public async Task<IDisposable> LockAsync(string fileHash)
    {
        var gate = _gates.GetOrAdd(fileHash, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        return new Releaser(gate);
    }

    sealed class Releaser(SemaphoreSlim gate) : IDisposable
    {
        public void Dispose() => gate.Release();
    }

    void Purge()
    {
        var now = DateTime.UtcNow;
        foreach (var kv in _d) if (kv.Value.Expires <= now) _d.TryRemove(kv.Key, out _);
    }
}
