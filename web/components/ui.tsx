"use client";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, RotateCw, type LucideIcon } from "lucide-react";

export function Card({ title, icon: Icon, right, children, className = "", pad = true }: {
  title?: ReactNode; icon?: LucideIcon; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {title !== undefined && (
        <div className="card-h">
          <h2 className="card-t">{Icon && <Icon className="h-4 w-4 text-zinc-500" />}{title}</h2>
          {right}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageTitle({ title, sub, icon: Icon, right }: { title: string; sub?: string; icon?: LucideIcon; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="grid h-10 w-10 place-items-center rounded-md border border-line bg-panel">
            <Icon className="h-5 w-5 text-accent" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">{title}</h1>
          {sub && <p className="mt-0.5 text-sm text-zinc-500">{sub}</p>}
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

const tone: Record<string, string> = {
  red: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  orange: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  yellow: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  blue: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  purple: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  teal: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  gray: "border-zinc-600/60 bg-zinc-800/60 text-zinc-300",
};

export function Badge({ children, color = "gray", className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded border px-2 text-xs font-medium ${tone[color] ?? tone.gray} ${className}`}>
      {children}
    </span>
  );
}

const dotTone: Record<string, string> = {
  red: "bg-rose-500", orange: "bg-orange-500", amber: "bg-amber-400", yellow: "bg-yellow-400", green: "bg-emerald-500",
  blue: "bg-sky-500", purple: "bg-violet-500", teal: "bg-teal-400", gray: "bg-zinc-500",
};

/** Status with a small signal light - like an andon / tower light. */
export function Signal({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
      <span className={`h-2 w-2 rounded-full ${dotTone[color] ?? dotTone.gray}`} />
      {children}
    </span>
  );
}

export function PriorityBadge({ p }: { p: number }) {
  const m: Record<number, [string, string]> = { 1: ["P1 Critical", "red"], 2: ["P2 High", "orange"], 3: ["P3 Medium", "yellow"], 4: ["P4 Low", "gray"] };
  const [t, c] = m[p] ?? [`P${p}`, "gray"];
  return <Badge color={c}>{t}</Badge>;
}

const statusColor: Record<string, string> = {
  New: "blue", Assigned: "purple", "In Progress": "amber", Pending: "orange", Resolved: "green", Closed: "gray",
  Approved: "blue", Rejected: "gray", Executed: "green", Failed: "red", Running: "amber", Completed: "green", Timeout: "red",
  Waiting: "blue", Hold: "red", Escalated: "purple",
};

export function StatusBadge({ s }: { s: string }) {
  return <Badge color={statusColor[s] ?? "gray"}>{s}</Badge>;
}

export function StatusSignal({ s }: { s: string }) {
  return <Signal color={statusColor[s] ?? "gray"}>{s}</Signal>;
}

export function RiskBadge({ r }: { r: string }) {
  return <Badge color={r === "high" ? "red" : r === "medium" ? "orange" : "green"}>Risk: {r}</Badge>;
}

export const stateColor: Record<string, string> = {
  Productive: "green", Standby: "blue", Down: "red", Engineering: "purple", Online: "green", Offline: "gray", Timeout: "red",
};

export function StateSignal({ s }: { s: string }) {
  return <Signal color={stateColor[s] ?? "gray"}>{s}</Signal>;
}

export function Loading({ text = "Loading" }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin text-accent" />
      {text}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2.5 text-sm text-rose-200">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</span>
      {onRetry && <button className="btn-ghost h-8" onClick={onRetry}><RotateCw className="h-3.5 w-3.5" /> Retry</button>}
    </div>
  );
}

export function Empty({ text, icon: Icon = Inbox }: { text: string; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-500">
      <Icon className="h-6 w-6 text-zinc-600" />
      {text}
    </div>
  );
}

export function Kpi({ label, value, unit, hint, icon: Icon, color = "text-zinc-50" }: {
  label: string; value: ReactNode; unit?: string; hint?: string; icon: LucideIcon; color?: string;
}) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-raised">
        <Icon className="h-5 w-5 text-zinc-400" />
      </div>
      <div className="min-w-0">
        <div className="label">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>
          {value ?? "-"}
          {unit && <span className="ml-1 text-sm font-normal text-zinc-500">{unit}</span>}
        </div>
        {hint && <div className="mt-0.5 truncate text-xs text-zinc-500">{hint}</div>}
      </div>
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded border border-line bg-ink p-2.5 font-mono text-xs leading-relaxed text-zinc-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
