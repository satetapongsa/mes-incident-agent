// Server-only: the browser never sees these URLs or the service token.
import "server-only";

export const REMEDY = (process.env.REMEDY_API_URL ?? "http://localhost:5080").replace(/\/$/, "");
export const AGENT = (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/$/, "");
const TOKEN = process.env.SERVICE_TOKEN ?? "change-me-service-token";

type Target = "remedy" | "agent";

export interface Rule {
  method: "GET" | "POST";
  re: RegExp;
  target: Target;
  to: (path: string) => string; // path on the backend
  token?: boolean;
  stream?: boolean;
  composite?: "approve";
}

// Allowlist of what the browser may call. Anything else -> 404.
export const RULES: Rule[] = [
  // reads from remedy-api
  { method: "GET", re: /^incidents$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^incidents\/INC\d{9}(\/(similar|runs))?$/i, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^mes\/(lots|equipment|db-sessions)$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^mes\/lots\/[\w-]+(\/history)?$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^mes\/equipment\/[\w-]+$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^mes\/users\/[\w-]+\/roles$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^actions(\/\d+)?$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^analytics\/(pareto|mttr|recurring|trend|kpis)$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^audit$/, target: "remedy", to: (p) => `/api/${p}` },
  { method: "GET", re: /^simulate\/scenarios$/, target: "remedy", to: (p) => `/api/${p}` },
  // human writes to remedy-api (token added here, server side)
  { method: "POST", re: /^incidents$/, target: "remedy", to: (p) => `/api/${p}`, token: true },
  { method: "POST", re: /^incidents\/INC\d{9}\/worklogs$/i, target: "remedy", to: (p) => `/api/${p}`, token: true },
  { method: "POST", re: /^incidents\/INC\d{9}\/resolve$/i, target: "remedy", to: (p) => `/api/${p}`, token: true },
  { method: "POST", re: /^simulate\/[a-z-]+$/, target: "remedy", to: (p) => `/api/${p}`, token: true },
  { method: "POST", re: /^actions\/\d+\/reject$/, target: "remedy", to: (p) => `/api/${p}`, token: true },
  { method: "POST", re: /^actions\/\d+\/approve$/, target: "remedy", to: (p) => `/api/${p}`, token: true, composite: "approve" },
  // agent service
  { method: "POST", re: /^runs$/, target: "agent", to: () => `/runs` },
  { method: "GET", re: /^runs\/\d+$/, target: "agent", to: (p) => `/${p}` },
  { method: "GET", re: /^runs\/\d+\/stream$/, target: "agent", to: (p) => `/${p}`, stream: true },
  { method: "GET", re: /^skills(\/[\w-]+)?$/, target: "agent", to: (p) => `/${p}` },
  { method: "POST", re: /^analysis\/recurring$/, target: "agent", to: (p) => `/${p}` },
  { method: "GET", re: /^system$/, target: "agent", to: () => `/health` },
  { method: "GET", re: /^status$/, target: "agent", to: () => `/status` },
  { method: "GET", re: /^auto$/, target: "agent", to: () => `/auto` },
  { method: "POST", re: /^auto$/, target: "agent", to: () => `/auto` },
];

export function base(t: Target) {
  return t === "remedy" ? REMEDY : AGENT;
}

export function headers(rule: Rule, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (rule.token) h["X-Service-Token"] = TOKEN;
  return h;
}

export async function backendJson(url: string, init: RequestInit & { token?: boolean } = {}) {
  const h = new Headers(init.headers);
  if (init.token) h.set("X-Service-Token", TOKEN);
  if (init.body) h.set("Content-Type", "application/json");
  const r = await fetch(url, { ...init, headers: h, cache: "no-store" });
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  return { status: r.status, ok: r.ok, data };
}
