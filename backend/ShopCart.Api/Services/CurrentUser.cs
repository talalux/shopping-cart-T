namespace ShopCart.Api.Services;

/// <summary>Who is acting (from the JWT) and from where (RemoteIpAddress, after ForwardedHeaders). Guest = UserId null.</summary>
public interface ICurrentUser
{
    int? UserId { get; }
    string? Email { get; }
    string? Role { get; }
    string? Ip { get; }
}

public class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    HttpContext? Ctx => accessor.HttpContext;
    public int? UserId => int.TryParse(Ctx?.User.FindFirst("sub")?.Value, out var id) ? id : null;
    public string? Email => Ctx?.User.FindFirst("email")?.Value;
    public string? Role => Ctx?.User.FindFirst("role")?.Value;
    public string? Ip => Ctx?.Connection.RemoteIpAddress?.ToString();
}
