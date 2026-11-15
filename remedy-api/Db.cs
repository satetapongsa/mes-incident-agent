using System.Data;
using Dapper;
using Oracle.ManagedDataAccess.Client;
using Oracle.ManagedDataAccess.Types;

namespace RemedyApi;

/// <summary>
/// Dapper parameters for Oracle stored procedures (supports REF CURSOR and OUT params).
/// </summary>
public sealed class OraParams : SqlMapper.IDynamicParameters
{
    private readonly List<OracleParameter> _items = new();

    public OraParams In(string name, object? value, OracleDbType? type = null)
    {
        var p = new OracleParameter(name, value ?? DBNull.Value) { Direction = ParameterDirection.Input };
        if (type is not null) p.OracleDbType = type.Value;
        _items.Add(p);
        return this;
    }

    public OraParams Clob(string name, string? value) => In(name, value, OracleDbType.Clob);

    public OraParams Out(string name, OracleDbType type, int size = 0)
    {
        var p = new OracleParameter(name, type) { Direction = ParameterDirection.Output };
        if (size > 0) p.Size = size;
        _items.Add(p);
        return this;
    }

    public OraParams Cursor(string name = "p_cur") => Out(name, OracleDbType.RefCursor);

    public void AddParameters(IDbCommand command, SqlMapper.Identity identity)
    {
        var cmd = (OracleCommand)command;
        cmd.BindByName = true;
        foreach (var p in _items) cmd.Parameters.Add(p);
    }

    public object? Get(string name)
    {
        var v = _items.First(p => p.ParameterName == name).Value;
        return v switch
        {
            OracleString s => s.IsNull ? null : s.Value,
            OracleDecimal d => d.IsNull ? null : d.Value,
            DBNull => null,
            _ => v
        };
    }
}

/// <summary>
/// Thin wrapper: every call goes to a PL/SQL package procedure. No business SQL in C#.
/// </summary>
public sealed class Db(string connectionString)
{
    public OracleConnection Open()
    {
        var c = new OracleConnection(connectionString);
        c.Open();
        return c;
    }

    /// <summary>Call a procedure whose last parameter is an OUT SYS_REFCURSOR and return rows as dictionaries.</summary>
    public async Task<List<Dictionary<string, object?>>> Query(string proc, OraParams? prms = null)
    {
        prms ??= new OraParams();
        prms.Cursor();
        await using var conn = Open();
        var rows = await conn.QueryAsync(proc, prms, commandType: CommandType.StoredProcedure);
        return rows.Select(r => ToDict((IDictionary<string, object?>)r)).ToList();
    }

    public async Task<Dictionary<string, object?>?> QueryOne(string proc, OraParams? prms = null)
        => (await Query(proc, prms)).FirstOrDefault();

    /// <summary>Call a procedure (auto-commit) and return the parameter object to read OUT values.</summary>
    public async Task<OraParams> Exec(string proc, OraParams prms)
    {
        await using var conn = Open();
        await conn.ExecuteAsync(proc, prms, commandType: CommandType.StoredProcedure);
        return prms;
    }

    /// <summary>Readiness check: the seed script writes schema_info('seed') as its last step.</summary>
    public async Task<bool> IsReady()
    {
        try
        {
            await using var conn = Open();
            var v = await conn.ExecuteScalarAsync<string?>("SELECT info_value FROM schema_info WHERE info_key = 'seed'");
            return v == "done";
        }
        catch
        {
            return false;
        }
    }

    private static Dictionary<string, object?> ToDict(IDictionary<string, object?> row)
    {
        var d = new Dictionary<string, object?>(row.Count);
        foreach (var (k, v) in row)
        {
            d[k.ToLowerInvariant()] = v switch
            {
                decimal m when m == Math.Truncate(m) && Math.Abs(m) < long.MaxValue => (long)m,
                DBNull => null,
                _ => v
            };
        }
        return d;
    }
}
