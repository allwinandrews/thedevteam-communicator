using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod()
            .WithExposedHeaders("x-auth-error");
    });
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var key = builder.Configuration["Jwt:Key"] ?? "dev-only-secret-change-me";
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        options.Events = new JwtBearerEvents
        {
            OnAuthenticationFailed = context =>
            {
                context.Response.Headers.Append("x-auth-error", context.Exception.GetType().Name);
                return Task.CompletedTask;
            },
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hub/chat"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            },
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSignalR();
builder.Services.AddSingleton<IUserIdProvider, UserIdProvider>();

builder.Services.AddSingleton<UserStore>();
builder.Services.AddSingleton<MessageStore>();
builder.Services.AddSingleton<PresenceStore>();
builder.Services.AddSingleton<PasswordHasher<UserRecord>>();
builder.Services.AddSingleton<JwtIssuer>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapHub<ChatHub>("/hub/chat").RequireAuthorization();

app.MapPost("/auth/register", (RegisterRequest request, UserStore users, PasswordHasher<UserRecord> hasher) =>
{
    if (string.IsNullOrWhiteSpace(request.UserName) || string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.BadRequest(new { error = "Username and password are required." });
    }

    var existing = users.FindByUserName(request.UserName);
    if (existing != null)
    {
        return Results.BadRequest(new { error = "Username already exists." });
    }

    var user = new UserRecord(Guid.NewGuid(), request.UserName.Trim());
    user.PasswordHash = hasher.HashPassword(user, request.Password);
    users.Add(user);

    return Results.Ok(new { user.Id, user.UserName });
});

app.MapPost("/auth/login", (LoginRequest request, UserStore users, PasswordHasher<UserRecord> hasher, JwtIssuer jwt) =>
{
    var user = users.FindByUserName(request.UserName);
    if (user == null)
    {
        return Results.Unauthorized();
    }

    var result = hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
    if (result == PasswordVerificationResult.Failed)
    {
        return Results.Unauthorized();
    }

    var token = jwt.IssueToken(user);
    return Results.Ok(new AuthResponse(token, user.Id, user.UserName));
});

var authGroup = app.MapGroup("/").RequireAuthorization();

authGroup.MapGet("/users", (ClaimsPrincipal principal, UserStore users) =>
{
    var currentId = principal.GetUserId();
    var others = users.All()
        .Where(u => u.Id != currentId)
        .Select(u => new { u.Id, u.UserName })
        .ToList();

    return Results.Ok(others);
});

authGroup.MapPost("/messages", async (SendMessageRequest request, ClaimsPrincipal principal, UserStore users, MessageStore messages, IHubContext<ChatHub> hubContext) =>
{
    var senderId = principal.GetUserId();
    if (senderId == Guid.Empty)
    {
        return Results.Unauthorized();
    }

    var recipient = users.FindById(request.ToUserId);
    if (recipient == null)
    {
        return Results.BadRequest(new { error = "Recipient not found." });
    }

    if (string.IsNullOrWhiteSpace(request.Content))
    {
        return Results.BadRequest(new { error = "Message content is required." });
    }

    var clientMessageId = string.IsNullOrWhiteSpace(request.ClientMessageId)
        ? Guid.NewGuid().ToString()
        : request.ClientMessageId.Trim();

    var message = new MessageRecord(
        Guid.NewGuid(),
        senderId,
        request.ToUserId,
        request.Content.Trim(),
        DateTimeOffset.UtcNow,
        clientMessageId
    );

    messages.Add(message);

    var dto = new MessageDto(
        message.Id,
        message.FromUserId,
        message.ToUserId,
        message.Content,
        message.SentAtUtc,
        message.ClientMessageId
    );

    await hubContext.Clients.User(recipient.Id.ToString()).SendAsync("message", dto);
    await hubContext.Clients.User(senderId.ToString()).SendAsync("message", dto);

    return Results.Ok(dto);
});

authGroup.MapGet("/messages/inbox", (ClaimsPrincipal principal, MessageStore messages) =>
{
    var userId = principal.GetUserId();
    var inbox = messages.ForRecipient(userId)
        .OrderBy(m => m.SentAtUtc)
        .Select(m => new MessageDto(m.Id, m.FromUserId, m.ToUserId, m.Content, m.SentAtUtc, m.ClientMessageId))
        .ToList();

    return Results.Ok(inbox);
});

authGroup.MapGet("/messages/thread/{userId:guid}", (Guid userId, ClaimsPrincipal principal, UserStore users, MessageStore messages) =>
{
    var currentUserId = principal.GetUserId();
    if (currentUserId == Guid.Empty)
    {
        return Results.Unauthorized();
    }

    var otherUser = users.FindById(userId);
    if (otherUser == null)
    {
        return Results.NotFound();
    }

    var thread = messages.ForThread(currentUserId, userId)
        .OrderBy(m => m.SentAtUtc)
        .Select(m => new MessageDto(m.Id, m.FromUserId, m.ToUserId, m.Content, m.SentAtUtc, m.ClientMessageId))
        .ToList();

    return Results.Ok(thread);
});

authGroup.MapGet("/auth/me", (ClaimsPrincipal principal, UserStore users) =>
{
    var userId = principal.GetUserId();
    var user = users.FindById(userId);
    if (user == null)
    {
        return Results.NotFound();
    }

    return Results.Ok(new { user.Id, user.UserName });
});

authGroup.MapGet("/presence", (PresenceStore presence) =>
{
    return Results.Ok(presence.OnlineUserIds());
});

authGroup.MapPost("/presence/ping", (ClaimsPrincipal principal, PresenceStore presence) =>
{
    var userId = principal.GetUserId();
    if (userId == Guid.Empty)
    {
        return Results.Unauthorized();
    }

    presence.MarkSeen(userId.ToString());
    return Results.NoContent();
});

app.Run();

record RegisterRequest(string UserName, string Password);
record LoginRequest(string UserName, string Password);
record AuthResponse(string Token, Guid UserId, string UserName);
record SendMessageRequest(Guid ToUserId, string Content, string ClientMessageId);
record MessageDto(Guid Id, Guid FromUserId, Guid ToUserId, string Content, DateTimeOffset SentAtUtc, string ClientMessageId);

record UserRecord(Guid Id, string UserName)
{
    public string PasswordHash { get; set; } = string.Empty;
}

record MessageRecord(Guid Id, Guid FromUserId, Guid ToUserId, string Content, DateTimeOffset SentAtUtc, string ClientMessageId);

sealed class UserStore
{
    private readonly object _lock = new();
    private readonly List<UserRecord> _users = new();

    public void Add(UserRecord user)
    {
        lock (_lock)
        {
            _users.Add(user);
        }
    }

    public UserRecord? FindByUserName(string userName)
    {
        lock (_lock)
        {
            return _users.FirstOrDefault(u => string.Equals(u.UserName, userName, StringComparison.OrdinalIgnoreCase));
        }
    }

    public UserRecord? FindById(Guid id)
    {
        lock (_lock)
        {
            return _users.FirstOrDefault(u => u.Id == id);
        }
    }

    public List<UserRecord> All()
    {
        lock (_lock)
        {
            return _users.ToList();
        }
    }
}

sealed class MessageStore
{
    private readonly object _lock = new();
    private readonly List<MessageRecord> _messages = new();

    public void Add(MessageRecord message)
    {
        lock (_lock)
        {
            _messages.Add(message);
        }
    }

    public List<MessageRecord> ForRecipient(Guid userId)
    {
        lock (_lock)
        {
            return _messages.Where(m => m.ToUserId == userId).ToList();
        }
    }

    public List<MessageRecord> ForThread(Guid userId, Guid otherUserId)
    {
        lock (_lock)
        {
            return _messages
                .Where(m => (m.FromUserId == userId && m.ToUserId == otherUserId)
                    || (m.FromUserId == otherUserId && m.ToUserId == userId))
                .ToList();
        }
    }
}

sealed class JwtIssuer
{
    private readonly string _key;

    public JwtIssuer(IConfiguration configuration)
    {
        _key = configuration["Jwt:Key"] ?? "dev-only-secret-change-me";
    }

    public string IssueToken(UserRecord user)
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.UserName)
        };

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_key));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddHours(8),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

static class ClaimsPrincipalExtensions
{
    public static Guid GetUserId(this ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(sub, out var id) ? id : Guid.Empty;
    }
}

sealed class UserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection)
    {
        var sub = connection.User?.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? connection.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        return sub;
    }
}

sealed class ChatHub : Hub
{
    private readonly PresenceStore _presence;

    public ChatHub(PresenceStore presence)
    {
        _presence = presence;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User?.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!string.IsNullOrWhiteSpace(userId))
        {
            _presence.MarkSeen(userId);
            await Clients.All.SendAsync("presence", _presence.OnlineUserIds());
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = Context.User?.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!string.IsNullOrWhiteSpace(userId))
        {
            _presence.MarkOffline(userId);
            await Clients.All.SendAsync("presence", _presence.OnlineUserIds());
        }
        await base.OnDisconnectedAsync(exception);
    }
}

sealed class PresenceStore
{
    private readonly object _lock = new();
    private readonly Dictionary<string, int> _connections = new();
    private readonly Dictionary<string, DateTimeOffset> _lastSeen = new();
    private static readonly TimeSpan OnlineTtl = TimeSpan.FromSeconds(30);

    public void MarkSeen(string userId)
    {
        lock (_lock)
        {
            _connections.TryGetValue(userId, out var count);
            _connections[userId] = count + 1;
            _lastSeen[userId] = DateTimeOffset.UtcNow;
        }
    }

    public void MarkOffline(string userId)
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(userId, out var count))
            {
                return;
            }

            count -= 1;
            if (count <= 0)
            {
                _connections.Remove(userId);
            }
            else
            {
                _connections[userId] = count;
            }
        }
    }

    public List<string> OnlineUserIds()
    {
        lock (_lock)
        {
            var now = DateTimeOffset.UtcNow;
            var expired = _lastSeen
                .Where(kvp => now - kvp.Value > OnlineTtl)
                .Select(kvp => kvp.Key)
                .ToList();

            foreach (var userId in expired)
            {
                _connections.Remove(userId);
                _lastSeen.Remove(userId);
            }

            return _connections.Keys.ToList();
        }
    }
}
