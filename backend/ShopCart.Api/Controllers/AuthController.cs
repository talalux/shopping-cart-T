using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ShopCart.Api.Data;
using ShopCart.Api.Models;
using ShopCart.Api.Services;

namespace ShopCart.Api.Controllers;

public record LoginRequest(string Email, string Password);

[ApiController]
[Route("api/auth")]
public class AuthController(AppDb db, IConfiguration cfg, ICurrentUser me) : ControllerBase
{
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest req)
    {
        var email = (req.Email ?? "").Trim();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        var ok = user is not null && BCrypt.Net.BCrypt.Verify(req.Password ?? "", user.PasswordHash);
        // never log the password that was typed
        await WriteAuthLog(email, user?.Id, ok, user is null ? "unknown_email" : ok ? "ok" : "bad_password");
        if (!ok) return Unauthorized(new { error = "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });

        var jwt = cfg.GetSection("Jwt");
        var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt["Key"]!)), SecurityAlgorithms.HmacSha256);
        var expires = DateTime.UtcNow.AddMinutes(int.Parse(jwt["ExpireMinutes"] ?? "480"));
        var token = new JwtSecurityToken(jwt["Issuer"], jwt["Audience"],
            [new Claim("sub", user!.Id.ToString()), new Claim("email", user.Email), new Claim("role", user.Role)],
            expires: expires, signingCredentials: creds);
        return Ok(new { token = new JwtSecurityTokenHandler().WriteToken(token), role = user.Role, email = user.Email, expiresAt = expires });
    }

    // Stateless JWT: this only records the logout in AuthLog (the BFF deletes the cookie).
    [HttpPost("logout"), Authorize]
    public async Task<IActionResult> Logout()
    {
        await WriteAuthLog(me.Email ?? "", me.UserId, true, "logout");
        return NoContent();
    }

    async Task WriteAuthLog(string email, int? userId, bool success, string reason)
    {
        var ua = Request.Headers.UserAgent.ToString();
        db.AuthLogs.Add(new AuthLog
        {
            At = DateTime.UtcNow, Email = email.Length > 256 ? email[..256] : email, UserId = userId, Success = success, Reason = reason,
            Ip = me.Ip, UserAgent = ua.Length > 300 ? ua[..300] : ua,
        });
        await db.SaveChangesAsync();
    }
}
