"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!r.ok) {
    const d = data as { error?: string; detail?: string } | null;
    throw new Error(d?.error || d?.detail || `HTTP ${r.status}`);
  }
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Fetch JSON with loading / error state and optional auto refresh. */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api<T>(pathRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(!!path);
    load();
    if (!refreshMs || !path) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [path, refreshMs, load]);

  return { data, error, loading, reload: load };
}

export function useUser(): [string, (u: string) => void] {
  const [user, setUser] = useState("sup_chaiwat");
  useEffect(() => {
    const u = localStorage.getItem("mia_user");
    if (u) setUser(u);
    const on = () => setUser(localStorage.getItem("mia_user") || "sup_chaiwat");
    window.addEventListener("mia-user", on);
    return () => window.removeEventListener("mia-user", on);
  }, []);
  const save = (u: string) => {
    localStorage.setItem("mia_user", u);
    setUser(u);
    window.dispatchEvent(new Event("mia-user"));
  };
  return [user, save];
}

export function ago(ts?: string | null): string {
  if (!ts) return "-";
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function fmt(ts?: string | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ---- types (snake_case, as returned by remedy-api) ----
export interface Incident {
  incident_id: string;
  summary: string;
  description?: string;
  status: string;
  priority: number;
  category_tier1?: string | null;
  category_tier2?: string | null;
  category_tier3?: string | null;
  ci_name?: string | null;
  assigned_group?: string | null;
  assignee?: string | null;
  submitter: string;
  source: string;
  root_cause?: string | null;
  resolution?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  age_hours?: number;
  worklogs?: Worklog[];
}
export interface Worklog {
  id: number;
  author: string;
  log_type: string;
  text: string;
  created_at: string;
}
export interface Action {
  id: number;
  incident_id: string;
  run_id?: number | null;
  action_type: string;
  params: Record<string, unknown>;
  risk: "low" | "medium" | "high";
  reason: string;
  status: string;
  requested_by: string;
  created_at: string;
  decided_by?: string | null;
  decided_at?: string | null;
  executed_at?: string | null;
  result?: string | null;
  incident_summary?: string;
  incident_priority?: number;
  incident_status?: string;
}
export interface Step {
  run_id: number;
  step_no: number;
  step_type: string;
  content: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  created_at: string;
}
export interface Run {
  run_id: number;
  incident_id: string;
  skill_used?: string | null;
  status: string;
  llm_mode: string;
  tool_calls: number;
  root_cause?: string | null;
  summary?: string | null;
  started_at: string;
  finished_at?: string | null;
  steps?: Step[];
}
export interface Equipment {
  equipment_id: string;
  eq_type: string;
  area: string;
  operation: string;
  state: string;
  current_recipe: string;
  last_heartbeat: string;
  interface_status: string;
  heartbeat_age_sec: number;
  running_lots: number;
  queued_lots: number;
}
export interface Lot {
  lot_id: string;
  product: string;
  route: string;
  operation: string;
  equipment_id?: string | null;
  status: string;
  hold_code?: string | null;
  hold_reason?: string | null;
  qty: number;
  recipe_required: string;
  updated_at: string;
}
