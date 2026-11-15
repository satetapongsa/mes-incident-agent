"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BookOpen, Bot, BrainCircuit, ClipboardCheck, Database, Factory, LayoutDashboard, Menu, ScrollText, TicketCheck,
  UserRound, Wrench, X, type LucideIcon,
} from "lucide-react";
import { post, useApi, useUser } from "@/lib/api";

const NAV: [string, string, LucideIcon][] = [
  ["/", "Dashboard", LayoutDashboard],
  ["/incidents", "Incidents", TicketCheck],
  ["/approvals", "Approvals", ClipboardCheck],
  ["/mes", "Shop floor", Factory],
  ["/analysis", "Analysis", BarChart3],
  ["/skills", "Agent skills", BookOpen],
  ["/audit", "Audit log", ScrollText],
];

interface AutoView { enabled: boolean; current_incident: string | null; handled_count: number; last_error: string | null }
interface Status {
  database: boolean; mcp_server: boolean; agent: boolean; llm_mode: string; provider: string; model: string | null; auto: AutoView;
}

function Light({ ok, icon: Icon, label, detail }: { ok: boolean | null; icon: LucideIcon; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm" title={detail}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${ok === null ? "bg-zinc-600" : ok ? "bg-emerald-500" : "bg-rose-500"}`} />
      <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
      <span className="truncate text-zinc-300">{label}</span>
    </div>
  );
}

function SystemStatus() {
  const { data: st, error, reload } = useApi<Status>("status", 10000);
  const [busy, setBusy] = useState(false);
  const up = st && !error;
  const auto = st?.auto;

  async function toggle() {
    if (!auto) return;
    setBusy(true);
    try {
      await post("auto", { enabled: !auto.enabled });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-ink p-3">
      <div className="label">System</div>
      <Light ok={up ? st!.database : error ? false : null} icon={Database} label="Oracle + Remedy API" />
      <Light ok={up ? st!.mcp_server : error ? false : null} icon={Wrench} label="MCP tools" />
      <Light ok={up ? true : error ? false : null} icon={BrainCircuit}
             label={!st ? "Agent" : st.llm_mode === "llm" ? `Agent: ${st.provider}` : "Agent: mock"}
             detail={st?.model ?? "rule-based planner, works offline"} />
      {st?.model && <div className="mono truncate pl-10 text-zinc-500" title={st.model}>{st.model}</div>}
      {auto && (
        <div className="border-t border-line pt-2">
          <button onClick={toggle} disabled={busy} className="flex w-full items-center gap-2 text-left text-sm"
                  title="When on, the agent analyses every New ticket by itself. Fixes still need your approval.">
            <Bot className={`h-4 w-4 ${auto.enabled ? "text-accent" : "text-zinc-500"}`} />
            <span className="flex-1 text-zinc-300">Auto mode</span>
            <span className={`relative h-5 w-9 rounded-full transition-colors ${auto.enabled ? "bg-accent" : "bg-zinc-700"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${auto.enabled ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </button>
          <div className="mt-1 text-xs text-zinc-500">
            {!auto.enabled ? "Off - press Run agent on a ticket" : auto.current_incident
              ? <>Working on <Link href={`/incidents/${auto.current_incident}`} className="mono text-accent">{auto.current_incident}</Link></>
              : `On - watching new tickets (${auto.handled_count} done)`}
          </div>
        </div>
      )}
    </div>
  );
}

function UserBox() {
  const [user, setUser] = useUser();
  return (
    <label className="block rounded-md border border-line bg-ink p-3">
      <span className="label mb-2 flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> Signed in as</span>
      <input className="input h-8 w-full" value={user} onChange={(e) => setUser(e.target.value)} title="Name written to the audit log" />
    </label>
  );
}

export default function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { data: kpi } = useApi<{ pending_approvals: number }>("analytics/kpis", 15000);

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(([href, label, Icon]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
                className={`group flex h-10 items-center gap-3 rounded-md border-l-2 px-3 text-sm transition-colors ${
                  active ? "border-accent bg-raised font-medium text-zinc-50" : "border-transparent text-zinc-400 hover:bg-raised hover:text-zinc-100"}`}>
            <Icon className={`h-[18px] w-[18px] ${active ? "text-accent" : "text-zinc-500 group-hover:text-zinc-300"}`} />
            <span className="flex-1">{label}</span>
            {href === "/approvals" && !!kpi?.pending_approvals && (
              <span className="rounded bg-accent px-1.5 text-xs font-semibold text-zinc-950">{kpi.pending_approvals}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-panel px-4 lg:hidden">
        <button className="btn-ghost h-9 w-9 px-0" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="font-semibold text-zinc-100">MES Incident Agent</span>
      </div>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-panel transition-transform lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <div className="grid h-8 w-8 place-items-center rounded bg-accent">
            <Factory className="h-[18px] w-[18px] text-zinc-950" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-zinc-50">MES Incident Agent</div>
            <div className="text-xs text-zinc-500">Backend site · Operations</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{nav}</div>
        <div className="space-y-2 border-t border-line p-3">
          <SystemStatus />
          <UserBox />
        </div>
      </aside>
    </>
  );
}
