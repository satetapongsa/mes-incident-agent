"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BookOpen, ClipboardCheck, Cpu, Factory, LayoutDashboard, Menu, ScrollText, TicketCheck, UserRound, X,
  type LucideIcon,
} from "lucide-react";
import { useApi, useUser } from "@/lib/api";

const NAV: [string, string, LucideIcon][] = [
  ["/", "Dashboard", LayoutDashboard],
  ["/incidents", "Incidents", TicketCheck],
  ["/approvals", "Approvals", ClipboardCheck],
  ["/mes", "Shop floor", Factory],
  ["/analysis", "Analysis", BarChart3],
  ["/skills", "Agent skills", BookOpen],
  ["/audit", "Audit log", ScrollText],
];

interface Sys { llm_mode: string; model?: string | null; provider: string }

function SystemStatus() {
  const { data: sys, error } = useApi<Sys>("system", 30000);
  const ok = !!sys && !error;
  return (
    <div className="rounded-md border border-line bg-ink p-3">
      <div className="label mb-2">Agent</div>
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : error ? "bg-rose-500" : "bg-zinc-600"}`} />
        <Cpu className="h-4 w-4 text-zinc-500" />
        <span className="font-medium text-zinc-200">
          {error ? "Offline" : !sys ? "..." : sys.llm_mode === "llm" ? sys.provider : "Mock planner"}
        </span>
      </div>
      {sys?.llm_mode === "llm" && sys.model && <div className="mono mt-1 truncate text-zinc-500" title={sys.model}>{sys.model}</div>}
      {sys?.llm_mode === "mock" && <div className="mt-1 text-xs text-zinc-500">offline, rule-based</div>}
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
