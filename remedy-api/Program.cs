using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.OpenApi.Models;
using Oracle.ManagedDataAccess.Client;
using RemedyApi;

var builder = WebApplication.CreateBuilder(args);

var connStr = Environment.GetEnvironmentVariable("ORACLE_CONN")
              ?? "User Id=MESAPP;Password=MesApp_2026;Data Source=localhost:1521/FREEPDB1";
var serviceToken = Environment.GetEnvironmentVariable("SERVICE_TOKEN") ?? "change-me-service-token";

builder.Services.AddSingleton(new Db(connStr));
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
    o.SerializerOptions.Converters.Add(new UtcDateTimeConverter());
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "remedy-api (simulated BMC Remedy incidents + Siemens Opcenter-style MES)",
        Version = "v1",
        Description = "All business logic runs in Oracle PL/SQL packages. Write endpoints need the X-Service-Token header."
    });
    c.AddSecurityDefinition("ServiceToken", new OpenApiSecurityScheme
    {
        In = ParameterLocation.Header, Name = "X-Service-Token", Type = SecuritySchemeType.ApiKey
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "ServiceToken" } },
            Array.Empty<string>()
        }
    });
});

var app = builder.Build();
var db = app.Services.GetRequiredService<Db>();
var log = app.Logger;

// ---------------------------------------------------------------------------
// Wait for Oracle (first boot takes minutes) - retry until the seed marker exists
// ---------------------------------------------------------------------------
for (var attempt = 1; ; attempt++)
{
    if (await db.IsReady())
    {
        log.LogInformation("Oracle schema MESAPP is ready (attempt {Attempt})", attempt);
        break;
    }
    log.LogWarning("Oracle not ready yet (attempt {Attempt}), retrying in 5 s ...", attempt);
    await Task.Delay(TimeSpan.FromSeconds(5));
}

app.UseSwagger();
app.UseSwaggerUI(o => o.DocumentTitle = "remedy-api");

// ---------------------------------------------------------------------------
// Oracle ORA-20xxx -> clean JSON 400/404
// ---------------------------------------------------------------------------
app.Use(async (ctx, next) =>
{
    try
    {
        await next();
    }
    catch (OracleException ex) when (ex.Number is >= 20000 and <= 20999)
    {
        ctx.Response.StatusCode = ex.Number is 20001 or 20010 or 20011 or 20020 or 20027 ? 404 : 400;
        await ctx.Response.WriteAsJsonAsync(new { error = Ora.Clean(ex.Message), code = $"ORA-{ex.Number}" });
    }
    catch (OracleException ex)
    {
        log.LogError(ex, "Oracle error");
        ctx.Response.StatusCode = 500;
        await ctx.Response.WriteAsJsonAsync(new { error = Ora.Clean(ex.Message), code = $"ORA-{ex.Number:00000}" });
    }
    catch (BadHttpRequestException ex)
    {
        ctx.Response.StatusCode = 400;
        await ctx.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});

app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();

app.MapGet("/health", async () =>
    await db.IsReady()
        ? Results.Ok(new { status = "ok", service = "remedy-api", database = "ready" })
        : Results.Json(new { status = "starting", database = "not ready" }, statusCode: 503));

// Write endpoints require the internal service token
var requireToken = new Func<EndpointFilterInvocationContext, EndpointFilterDelegate, ValueTask<object?>>(async (ctx, next) =>
{
    var token = ctx.HttpContext.Request.Headers["X-Service-Token"].ToString();
    if (token != serviceToken)
        return Results.Json(new { error = "Missing or invalid X-Service-Token" }, statusCode: 401);
    return await next(ctx);
});

var api = app.MapGroup("/api");
var w = app.MapGroup("/api").AddEndpointFilter(requireToken);

// ===========================================================================
// Incidents (Remedy-style)
// ===========================================================================
api.MapGet("/incidents", async (string? status, int? priority, string? category, string? search, int? limit) =>
    await db.Query("incident_pkg.list_incidents", new OraParams()
        .In("p_status", status).In("p_priority", priority).In("p_category", category)
        .In("p_search", search).In("p_limit", limit ?? 200)))
    .WithTags("Incidents");

api.MapGet("/incidents/{id}", async (string id) =>
{
    var inc = await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id));
    if (inc is null) return Results.NotFound(new { error = $"Incident {id} not found" });
    inc["worklogs"] = await db.Query("incident_pkg.get_worklogs", new OraParams().In("p_incident_id", id));
    return Results.Ok(inc);
}).WithTags("Incidents");

w.MapPost("/incidents", async (CreateIncidentReq r) =>
{
    var p = await db.Exec("incident_pkg.create_incident", new OraParams()
        .In("p_summary", r.Summary).In("p_description", r.Description).In("p_priority", r.Priority)
        .In("p_impact", r.Impact).In("p_urgency", r.Urgency)
        .In("p_cat1", r.CategoryTier1).In("p_cat2", r.CategoryTier2).In("p_cat3", r.CategoryTier3)
        .In("p_ci_name", r.CiName).In("p_submitter", r.Submitter).In("p_source", r.Source ?? "manual")
        .In("p_assigned_group", r.AssignedGroup)
        .Out("p_incident_id", Oracle.ManagedDataAccess.Client.OracleDbType.Varchar2, 15));
    var id = (string)p.Get("p_incident_id")!;
    return Results.Created($"/api/incidents/{id}",
        await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id)));
}).WithTags("Incidents");

w.MapPost("/incidents/import", async (ImportIncidentReq r) =>
{
    var p = await db.Exec("incident_pkg.import_incident", new OraParams()
        .In("p_external_ref", r.ExternalRef).In("p_summary", r.Summary).In("p_description", r.Description)
        .In("p_priority", r.Priority).In("p_cat1", r.CategoryTier1).In("p_cat2", r.CategoryTier2)
        .In("p_cat3", r.CategoryTier3).In("p_ci_name", r.CiName).In("p_assigned_group", r.AssignedGroup)
        .In("p_submitter", r.Submitter).In("p_status", r.Status).In("p_root_cause", r.RootCause)
        .In("p_resolution", r.Resolution)
        .In("p_created_at", r.CreatedAt, OracleDbType.TimeStamp).In("p_resolved_at", r.ResolvedAt, OracleDbType.TimeStamp)
        .Out("p_incident_id", OracleDbType.Varchar2, 15).Out("p_skipped", OracleDbType.Decimal));
    return Results.Ok(new { incident_id = p.Get("p_incident_id"), skipped = Convert.ToInt32(p.Get("p_skipped")) == 1 });
}).WithTags("Incidents");

w.MapPatch("/incidents/{id}/status", async (string id, StatusReq r) =>
{
    await db.Exec("incident_pkg.set_status", new OraParams()
        .In("p_incident_id", id).In("p_status", r.Status).In("p_user", r.User ?? "api").In("p_note", r.Note));
    return Results.Ok(await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id)));
}).WithTags("Incidents");

w.MapPatch("/incidents/{id}/triage", async (string id, TriageReq r) =>
{
    await db.Exec("incident_pkg.update_triage", new OraParams()
        .In("p_incident_id", id).In("p_cat1", r.CategoryTier1).In("p_cat2", r.CategoryTier2).In("p_cat3", r.CategoryTier3)
        .In("p_priority", r.Priority).In("p_group", r.AssignedGroup).In("p_user", r.User ?? "agent"));
    return Results.Ok(await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id)));
}).WithTags("Incidents");

w.MapPost("/incidents/{id}/assign", async (string id, AssignReq r) =>
{
    await db.Exec("incident_pkg.assign", new OraParams()
        .In("p_incident_id", id).In("p_group", r.AssignedGroup).In("p_assignee", r.Assignee).In("p_user", r.User ?? "api"));
    return Results.Ok(await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id)));
}).WithTags("Incidents");

w.MapPost("/incidents/{id}/worklogs", async (string id, WorklogReq r) =>
{
    await db.Exec("incident_pkg.add_worklog", new OraParams()
        .In("p_incident_id", id).In("p_author", r.Author ?? "api").In("p_log_type", r.LogType ?? "note").Clob("p_text", r.Text));
    return Results.Ok(await db.Query("incident_pkg.get_worklogs", new OraParams().In("p_incident_id", id)));
}).WithTags("Incidents");

w.MapPost("/incidents/{id}/resolve", async (string id, ResolveReq r) =>
{
    await db.Exec("incident_pkg.resolve", new OraParams()
        .In("p_incident_id", id).In("p_root_cause", r.RootCause).In("p_resolution", r.Resolution)
        .In("p_resolved_by", r.ResolvedBy ?? "human").In("p_user", r.User ?? "api"));
    return Results.Ok(await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id)));
}).WithTags("Incidents");

api.MapGet("/incidents/{id}/similar", async (string id, string? text, string? category) =>
{
    var inc = await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id));
    if (inc is null) return Results.NotFound(new { error = $"Incident {id} not found" });
    return Results.Ok(await db.Query("incident_pkg.find_similar", new OraParams()
        .In("p_text", text ?? inc["summary"]).In("p_category", category ?? inc["category_tier3"]).In("p_exclude_id", id)));
}).WithTags("Incidents");

api.MapGet("/incidents/{id}/runs", async (string id) =>
    await db.Query("agent_pkg.list_runs", new OraParams().In("p_incident_id", id)))
    .WithTags("Agent runs");

// ===========================================================================
// MES (Opcenter-style)
// ===========================================================================
api.MapGet("/mes/lots", async (string? status, [FromQuery(Name = "equipment_id")] string? equipmentId) =>
    await db.Query("mes_pkg.list_lots", new OraParams().In("p_status", status).In("p_equipment_id", equipmentId)))
    .WithTags("MES");

api.MapGet("/mes/lots/{id}", async (string id) =>
    await db.QueryOne("mes_pkg.get_lot", new OraParams().In("p_lot_id", id)) is { } lot
        ? Results.Ok(lot)
        : Results.NotFound(new { error = $"Lot {id} not found" }))
    .WithTags("MES");

api.MapGet("/mes/lots/{id}/history", async (string id) =>
    await db.Query("mes_pkg.get_lot_history", new OraParams().In("p_lot_id", id)))
    .WithTags("MES");

w.MapPost("/mes/lots/{id}/track-in", async (string id, TrackInReq r) =>
{
    await db.Exec("mes_pkg.track_in", new OraParams().In("p_lot_id", id).In("p_equipment_id", r.EquipmentId).In("p_user", r.User));
    return Results.Ok(await db.QueryOne("mes_pkg.get_lot", new OraParams().In("p_lot_id", id)));
}).WithTags("MES");

w.MapPost("/mes/lots/{id}/track-out", async (string id, UserReq r) =>
{
    await db.Exec("mes_pkg.track_out", new OraParams().In("p_lot_id", id).In("p_user", r.User));
    return Results.Ok(await db.QueryOne("mes_pkg.get_lot", new OraParams().In("p_lot_id", id)));
}).WithTags("MES");

w.MapPost("/mes/lots/{id}/hold", async (string id, HoldReq r) =>
{
    await db.Exec("mes_pkg.hold_lot", new OraParams()
        .In("p_lot_id", id).In("p_hold_code", r.HoldCode).In("p_reason", r.Reason).In("p_user", r.User));
    return Results.Ok(await db.QueryOne("mes_pkg.get_lot", new OraParams().In("p_lot_id", id)));
}).WithTags("MES");

api.MapGet("/mes/equipment", async () => await db.Query("mes_pkg.list_equipment")).WithTags("MES");

api.MapGet("/mes/equipment/{id}", async (string id) =>
{
    var eq = await db.QueryOne("mes_pkg.get_equipment", new OraParams().In("p_equipment_id", id));
    if (eq is null) return Results.NotFound(new { error = $"Equipment {id} not found" });
    eq["lots"] = await db.Query("mes_pkg.list_lots", new OraParams().In("p_status", null).In("p_equipment_id", id));
    return Results.Ok(eq);
}).WithTags("MES");

w.MapPost("/mes/equipment/{id}/heartbeat", async (string id) =>
{
    await db.Exec("mes_pkg.heartbeat", new OraParams().In("p_equipment_id", id));
    return Results.Ok(new { equipment_id = id, heartbeat = "ok" });
}).WithTags("MES");

w.MapPost("/mes/heartbeat", async () =>
{
    var p = await db.Exec("mes_pkg.heartbeat_all", new OraParams().Out("p_count", OracleDbType.Decimal));
    return Results.Ok(new { updated = Convert.ToInt32(p.Get("p_count")) });
}).WithTags("MES");

api.MapGet("/mes/users/{user}/roles", async (string user) =>
    await db.Query("mes_pkg.get_user_roles", new OraParams().In("p_user_name", user)))
    .WithTags("MES");

api.MapGet("/mes/db-sessions", async ([FromQuery(Name = "min_elapsed")] int? minElapsed) =>
    await db.Query("mes_pkg.list_db_sessions", new OraParams().In("p_min_elapsed", minElapsed ?? 0)))
    .WithTags("MES");

// ===========================================================================
// Action requests (human approval gate)
// ===========================================================================
api.MapGet("/actions", async (string? status, [FromQuery(Name = "incident_id")] string? incidentId) =>
    Json.ParseField(await db.Query("action_pkg.list_requests",
        new OraParams().In("p_status", status).In("p_incident_id", incidentId)), "params"))
    .WithTags("Actions");

api.MapGet("/actions/{id:int}", async (int id) =>
{
    var rows = Json.ParseField(await db.Query("action_pkg.get_request", new OraParams().In("p_id", id)), "params");
    return rows.Count == 0 ? Results.NotFound(new { error = $"Action request #{id} not found" }) : Results.Ok(rows[0]);
}).WithTags("Actions");

w.MapPost("/actions", async (CreateActionReq r) =>
{
    var p = await db.Exec("action_pkg.create_request", new OraParams()
        .In("p_incident_id", r.IncidentId).In("p_run_id", r.RunId).In("p_action_type", r.ActionType)
        .Clob("p_params", r.Params.ValueKind == JsonValueKind.Undefined ? "{}" : r.Params.GetRawText())
        .In("p_risk", r.Risk).In("p_reason", r.Reason).In("p_requested_by", r.RequestedBy ?? "agent")
        .Out("p_id", OracleDbType.Decimal));
    var id = Convert.ToInt32(p.Get("p_id"));
    var rows = Json.ParseField(await db.Query("action_pkg.get_request", new OraParams().In("p_id", id)), "params");
    return Results.Created($"/api/actions/{id}", rows[0]);
}).WithTags("Actions");

w.MapPost("/actions/{id:int}/approve", async (int id, UserReq r) =>
{
    await db.Exec("action_pkg.approve", new OraParams().In("p_id", id).In("p_user", r.User));
    return Results.Ok(Json.ParseField(await db.Query("action_pkg.get_request", new OraParams().In("p_id", id)), "params")[0]);
}).WithTags("Actions");

w.MapPost("/actions/{id:int}/reject", async (int id, RejectReq r) =>
{
    await db.Exec("action_pkg.reject", new OraParams().In("p_id", id).In("p_user", r.User).In("p_comment", r.Comment));
    return Results.Ok(Json.ParseField(await db.Query("action_pkg.get_request", new OraParams().In("p_id", id)), "params")[0]);
}).WithTags("Actions");

w.MapPost("/actions/{id:int}/execute", async (int id, UserReq r) =>
{
    var p = await db.Exec("action_pkg.execute_action", new OraParams()
        .In("p_id", id).In("p_approver", r.User)
        .Out("p_status", OracleDbType.Varchar2, 20).Out("p_result", OracleDbType.Varchar2, 4000));
    var action = Json.ParseField(await db.Query("action_pkg.get_request", new OraParams().In("p_id", id)), "params")[0];
    return Results.Ok(new { status = p.Get("p_status"), result = p.Get("p_result"), action });
}).WithTags("Actions");

// ===========================================================================
// Analytics + audit
// ===========================================================================
api.MapGet("/analytics/pareto", async () => await db.Query("analytics_pkg.pareto")).WithTags("Analytics");
api.MapGet("/analytics/mttr", async () => await db.Query("analytics_pkg.mttr")).WithTags("Analytics");
api.MapGet("/analytics/recurring", async () => await db.Query("analytics_pkg.recurring")).WithTags("Analytics");
api.MapGet("/analytics/trend", async () => await db.Query("analytics_pkg.trend")).WithTags("Analytics");
api.MapGet("/analytics/kpis", async () => await db.QueryOne("analytics_pkg.kpis")).WithTags("Analytics");
api.MapGet("/audit", async (int? limit) => await db.Query("audit_pkg.list_audit", new OraParams().In("p_limit", limit ?? 200)))
    .WithTags("Audit");

// ===========================================================================
// Agent runs (persistence for the agent service)
// ===========================================================================
w.MapPost("/agent/runs", async (StartRunReq r) =>
{
    var p = await db.Exec("agent_pkg.start_run", new OraParams()
        .In("p_incident_id", r.IncidentId).In("p_llm_mode", r.LlmMode).Out("p_run_id", OracleDbType.Decimal));
    var runId = Convert.ToInt32(p.Get("p_run_id"));
    return Results.Ok(await db.QueryOne("agent_pkg.get_run", new OraParams().In("p_run_id", runId)));
}).WithTags("Agent runs");

w.MapPost("/agent/runs/{id:int}/steps", async (int id, AddStepReq r) =>
{
    var content = r.Content.ValueKind == JsonValueKind.String ? r.Content.GetString() : r.Content.GetRawText();
    var p = await db.Exec("agent_pkg.add_step", new OraParams()
        .In("p_run_id", id).In("p_step_type", r.StepType).Clob("p_content", content).Out("p_step_no", OracleDbType.Decimal));
    return Results.Ok(new { run_id = id, step_no = Convert.ToInt32(p.Get("p_step_no")) });
}).WithTags("Agent runs");

w.MapPost("/agent/runs/{id:int}/finish", async (int id, FinishRunReq r) =>
{
    await db.Exec("agent_pkg.finish_run", new OraParams()
        .In("p_run_id", id).In("p_status", r.Status).In("p_skill_used", r.SkillUsed).In("p_summary", r.Summary)
        .In("p_root_cause", r.RootCause).In("p_tool_calls", r.ToolCalls));
    return Results.Ok(await db.QueryOne("agent_pkg.get_run", new OraParams().In("p_run_id", id)));
}).WithTags("Agent runs");

api.MapGet("/agent/runs", async ([FromQuery(Name = "incident_id")] string? incidentId) =>
    await db.Query("agent_pkg.list_runs", new OraParams().In("p_incident_id", incidentId)))
    .WithTags("Agent runs");

api.MapGet("/agent/runs/{id:int}", async (int id) =>
{
    var run = await db.QueryOne("agent_pkg.get_run", new OraParams().In("p_run_id", id));
    if (run is null) return Results.NotFound(new { error = $"Agent run {id} not found" });
    run["steps"] = Json.ParseField(await db.Query("agent_pkg.get_steps", new OraParams().In("p_run_id", id)), "content");
    return Results.Ok(run);
}).WithTags("Agent runs");

// ===========================================================================
// Failure simulation
// ===========================================================================
var scenarios = new[]
{
    "lot-hold-stuck", "trackin-recipe-mismatch", "equipment-heartbeat-stale",
    "interface-timeout", "user-permission-missing", "db-slow-query"
};
api.MapGet("/simulate/scenarios", () => scenarios).WithTags("Simulator");

w.MapPost("/simulate/{scenario}", async (string scenario, string? target) =>
{
    var p = await db.Exec("sim_pkg.inject", new OraParams()
        .In("p_scenario", scenario).In("p_target", target)
        .Out("p_incident_id", OracleDbType.Varchar2, 15).Out("p_detail", OracleDbType.Varchar2, 400));
    var id = (string)p.Get("p_incident_id")!;
    return Results.Ok(new
    {
        scenario,
        incident_id = id,
        detail = p.Get("p_detail"),
        incident = await db.QueryOne("incident_pkg.get_incident", new OraParams().In("p_incident_id", id))
    });
}).WithTags("Simulator");

app.Run();

// ===========================================================================
// Request DTOs (JSON snake_case)
// ===========================================================================
record CreateIncidentReq(string Summary, string? Description, int? Priority, string? Impact, string? Urgency,
    string? CategoryTier1, string? CategoryTier2, string? CategoryTier3, string? CiName, string Submitter,
    string? Source, string? AssignedGroup);
record ImportIncidentReq(string ExternalRef, string Summary, string? Description, int? Priority,
    string? CategoryTier1, string? CategoryTier2, string? CategoryTier3, string? CiName, string? AssignedGroup,
    string? Submitter, string? Status, string? RootCause, string? Resolution, DateTime? CreatedAt, DateTime? ResolvedAt);
record StatusReq(string Status, string? User, string? Note);
record TriageReq(string? CategoryTier1, string? CategoryTier2, string? CategoryTier3, int? Priority, string? AssignedGroup, string? User);
record AssignReq(string AssignedGroup, string? Assignee, string? User);
record WorklogReq(string? Author, string? LogType, string Text);
record ResolveReq(string RootCause, string Resolution, string? ResolvedBy, string? User);
record TrackInReq(string EquipmentId, string User);
record HoldReq(string HoldCode, string Reason, string User);
record UserReq(string User);
record RejectReq(string User, string? Comment);
record CreateActionReq(string IncidentId, int? RunId, string ActionType, JsonElement Params, string Risk, string Reason, string? RequestedBy);
record StartRunReq(string IncidentId, string LlmMode);
record AddStepReq(string StepType, JsonElement Content);
record FinishRunReq(string? Status, string? SkillUsed, string? Summary, string? RootCause, int? ToolCalls);

// ===========================================================================
// Helpers
// ===========================================================================
static class Ora
{
    /// <summary>"ORA-20003: Invalid status transition ...\nORA-06512: ..." -> "Invalid status transition ..."</summary>
    public static string Clean(string message)
    {
        var first = message.Split('\n')[0].Trim();
        return System.Text.RegularExpressions.Regex.Replace(first, @"^ORA-\d+:\s*", "");
    }
}

static class Json
{
    /// <summary>CLOB columns that hold JSON are returned as JSON objects, not strings.</summary>
    public static List<Dictionary<string, object?>> ParseField(List<Dictionary<string, object?>> rows, string key)
    {
        foreach (var row in rows)
        {
            if (row.TryGetValue(key, out var v) && v is string s && s.Length > 0)
            {
                try { row[key] = JsonDocument.Parse(s).RootElement.Clone(); }
                catch (JsonException) { /* keep as plain text */ }
            }
        }
        return rows;
    }
}

/// <summary>Oracle TIMESTAMP values are UTC in the container; write them with a Z suffix.</summary>
sealed class UtcDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var d = reader.GetDateTime();
        return d.Kind == DateTimeKind.Utc ? d : d.Kind == DateTimeKind.Local ? d.ToUniversalTime() : DateTime.SpecifyKind(d, DateTimeKind.Utc);
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
        => writer.WriteStringValue(DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
}
