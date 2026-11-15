// Backend-for-frontend: the browser only calls /api/*, this handler forwards to remedy-api / agent
// inside the docker network, using an allowlist (lib/backend.ts). The service token never reaches the browser.
import { NextRequest, NextResponse } from "next/server";
import { AGENT, REMEDY, RULES, backendJson, base, headers } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function match(method: string, path: string) {
  return RULES.find((r) => r.method === method && r.re.test(path));
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const path = parts.join("/");
  const rule = match(req.method, path);
  if (!rule) return NextResponse.json({ error: `Not allowed: ${req.method} /api/${path}` }, { status: 404 });

  const qs = req.nextUrl.search;
  const url = `${base(rule.target)}${encodeURI(rule.to(path))}${qs}`;

  try {
    // Server-Sent Events: pass the stream through
    if (rule.stream) {
      const upstream = await fetch(url, { cache: "no-store", headers: { Accept: "text/event-stream" } });
      if (!upstream.ok || !upstream.body) {
        return NextResponse.json({ error: `stream failed (${upstream.status})` }, { status: 502 });
      }
      return new Response(upstream.body, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
      });
    }

    const body = req.method === "POST" ? await req.text() : undefined;

    // Approve = approve (remedy) -> execute (remedy, PL/SQL action_pkg) -> verify + resolve (agent)
    if (rule.composite === "approve") {
      const id = path.split("/")[1];
      const user = (body ? JSON.parse(body).user : null) || "shift_lead";
      const approve = await backendJson(`${REMEDY}/api/actions/${id}/approve`, {
        method: "POST", token: true, body: JSON.stringify({ user }),
      });
      if (!approve.ok) return NextResponse.json(approve.data, { status: approve.status });
      const exec = await backendJson(`${REMEDY}/api/actions/${id}/execute`, {
        method: "POST", token: true, body: JSON.stringify({ user }),
      });
      if (!exec.ok) return NextResponse.json(exec.data, { status: exec.status });
      const verify = await backendJson(`${AGENT}/actions/${id}/verify`, { method: "POST" });
      return NextResponse.json({ execute: exec.data, verify: verify.data });
    }

    const r = await fetch(url, {
      method: req.method,
      headers: headers(rule, body ? { "Content-Type": "application/json" } : {}),
      body,
      cache: "no-store",
    });
    const text = await r.text();
    return new Response(text || "null", {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return NextResponse.json({ error: `Backend unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
