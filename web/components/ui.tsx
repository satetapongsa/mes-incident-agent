"use client";
import type { ReactNode } from "react";

export function Card({ title, right, children, className = "" }: {
  title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title !== undefined && (
        <div className="card-h">
          <span>{title}</span>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const tone: Record<string, string> = {
  red: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  orange: "bg-orange-500/15 text-orange-300 ring-orange-500/40",
  amber: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  yellow: "bg-yellow-500/15 text-yellow-200 ring-yellow-500/40",
  green: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  blue: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  purple: "bg-violet-500/15 text-violet-300 ring-violet-500/40",
  teal: "bg-teal-500/15 text-teal-300 ring-teal-500/40",
  gray: "bg-slate-500/15 text-slate-300 ring-slate-500/40",
};

export function Badge({ children, color = "gray", className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone[color] ?? tone.gray} ${className}`}>
      {children}
    </span>
  );
}

export function PriorityBadge({ p }: { p: number }) {
  const m: Record<number, [string, string]> = { 1: ["P1 Critical", "red"], 2: ["P2 High", "orange"], 3: ["P3 Medium", "yellow"], 4: ["P4 Low", "gray"] };
  const [t, c] = m[p] ?? [`P${p}`, "gray"];
  return <Badge color={c}>{t}</Badge>;
}

export function StatusBadge({ s }: { s: string }) {
  const m: Record<string, string> = {
    New: "blue", Assigned: "purple", "In Progress": "amber", Pending: "orange", Resolved: "green", Closed: "gray",
    Approved: "blue", Rejected: "gray", Executed: "green", Failed: "red", Running: "amber", Completed: "green", Timeout: "red",
    Waiting: "blue", Hold: "red",
  };
  return <Badge color={m[s] ?? "gray"}>{s}</Badge>;
}

export function RiskBadge({ r }: { r: string }) {
  return <Badge color={r === "high" ? "red" : r === "medium" ? "orange" : "green"}>risk {r}</Badge>;
}

export function StateBadge({ s }: { s: string }) {
  const m: Record<string, string> = { Productive: "green", Standby: "blue", Down: "red", Engineering: "purple", Online: "green", Offline: "gray", Timeout: "red" };
  return <Badge color={m[s] ?? "gray"}>{s}</Badge>;
}

export function Loading({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      {text}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      <span>⚠ {error}</span>
      {onRetry && <button className="btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="py-6 text-center text-sm text-slate-500">{text}</div>;
}

export function Kpi({ label, value, unit, hint, color = "text-slate-100" }: {
  label: string; value: ReactNode; unit?: string; hint?: string; color?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${color}`}>
        {value ?? "-"}
        {unit && <span className="ml-1 text-base font-medium text-slate-400">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded bg-slate-950 p-2 font-mono text-[11px] leading-snug text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
