using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using ShopCart.Api.Data;
using ShopCart.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddScoped<AuditInterceptor>();
builder.Services.AddDbContext<AppDb>((sp, o) => o
    .UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=shopcart.db")
    .AddInterceptors(sp.GetRequiredService<AuditInterceptor>()));
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT",
        Description = "วาง JWT จาก /api/auth/login"
    });
    c.AddSecurityRequirement(doc => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", doc)] = new List<string>()
    });
});

var jwt = builder.Configuration.GetSection("Jwt");
var key = jwt["Key"] ?? throw new InvalidOperationException("Jwt:Key missing (set in appsettings.Development.json or env Jwt__Key)");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true, ValidIssuer = jwt["Issuer"],
        ValidateAudience = true, ValidAudience = jwt["Audience"],
        ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
        ValidateLifetime = true, RoleClaimType = "role", NameClaimType = "sub"
    };
});
builder.Services.AddAuthorization();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<StockService>();
builder.Services.AddScoped<AuditWriter>();
builder.Services.AddSingleton<PreviewStore>();
builder.Services.AddSingleton<INotifier, DevOutboxNotifier>(); // swap this one line for SMTP/SMS notifier
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("guest", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = builder.Configuration.GetValue("RateLimit:GuestPermit", 5),
            Window = TimeSpan.FromSeconds(builder.Configuration.GetValue("RateLimit:GuestWindowSeconds", 600)),
            QueueLimit = 0,
        }));
    o.OnRejected = async (c, ct) =>
    {
        if (c.Lease.TryGetMetadata(MetadataName.RetryAfter, out var ra))
            c.HttpContext.Response.Headers.RetryAfter = ((int)ra.TotalSeconds).ToString();
        c.HttpContext.Response.ContentType = "application/json";
        await c.HttpContext.Response.WriteAsync("{\"error\":\"ส่งคำสั่งซื้อบ่อยเกินไป ลองใหม่ภายหลัง\"}", ct);
    };
});
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins("http://localhost:3000").AllowAnyHeader().AllowAnyMethod()));

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    // Only trust X-Forwarded-For from the proxies listed in Proxy:TrustedIPs (the Next.js BFF). A request from anywhere
    // else keeps its real socket address, so a spoofed header cannot dodge the rate limiter. ForwardLimit = 1: read one hop only.
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.ForwardLimit = 1;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
    foreach (var ip in builder.Configuration.GetSection("Proxy:TrustedIPs").Get<string[]>() ?? [])
        o.KnownProxies.Add(System.Net.IPAddress.Parse(ip));
});

var app = builder.Build();
app.UseForwardedHeaders();

using (var scope = app.Services.CreateScope())
    Seed.Run(scope.ServiceProvider.GetRequiredService<AppDb>());

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapControllers();

if (app.Environment.IsDevelopment())
{
    // Dev only: latest outbox message for an order, so the UI can show the confirm link without a real mailbox.
    // Dev only: which client IP the API resolved after ForwardedHeaders (used to verify the rate-limit key)
    // dev endpoints answer only a loopback client (RemoteIpAddress is the real client IP after ForwardedHeaders)
    static bool Loopback(HttpContext c) => c.Connection.RemoteIpAddress is { } ip && System.Net.IPAddress.IsLoopback(ip);
    app.MapGet("/api/dev/ip", (HttpContext c) =>
    {
        if (!Loopback(c)) return Results.NotFound();
        var ip = c.Connection.RemoteIpAddress?.ToString();
        app.Logger.LogInformation("RemoteIpAddress={Ip} X-Forwarded-For={Xff}", ip, c.Request.Headers["X-Forwarded-For"].ToString());
        return Results.Ok(new { remoteIp = ip, xForwardedFor = c.Request.Headers["X-Forwarded-For"].ToString() });
    });
    app.MapGet("/api/dev/outbox/latest", (HttpContext c, int orderId, IHostEnvironment env) =>
    {
        if (!Loopback(c)) return Results.NotFound();
        var dir = Path.Combine(env.ContentRootPath, "outbox");
        if (!Directory.Exists(dir)) return Results.NotFound();
        var f = new DirectoryInfo(dir).GetFiles($"*-{orderId}.txt").OrderByDescending(x => x.Name).FirstOrDefault();
        if (f is null) return Results.NotFound();
        var text = File.ReadAllText(f.FullName);
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).ToList();
        var link = lines.LastOrDefault(l => l.StartsWith("http")) ?? "";
        var to = lines.FirstOrDefault(l => l.StartsWith("ถึง:"))?.Substring(4).Trim();
        return Results.Ok(new { file = f.Name, sentAt = f.CreationTimeUtc, to, body = text, link });
    });
}
app.Run();
