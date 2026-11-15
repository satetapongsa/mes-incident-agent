"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApi, useUser } from "@/lib/api";

const links = [
  ["/", "Dashboard"],
  ["/incidents", "Incidents"],
  ["/approvals", "Approvals"],
  ["/mes", "MES"],
  ["/analysis", "Analysis"],
  ["/skills", "Skills"],
  ["/audit", "Audit"],
];

interface Sys { llm_mode: string; model?: string | null; provider: string }

export default function Nav() {
  const path = usePathname();
  const { data: sys, error } = useApi<Sys>("system", 30000);
  const { data: kpi } = useApi<{ pending_approvals: number }>("analytics/kpis", 15000);
  const [user, setUser] = useUser();
  const [open, setOpen] = useState(false);

  const mode = error ? (
    <span className="rounded bg-rose-900/60 px-2 py-0.5 text-xs text-rose-200">agent offline</span>
  ) : sys ? (
    sys.llm_mode === "llm" ? (
      <span className="rounded bg-violet-600/30 px-2 py-0.5 text-xs font-semibold text-violet-200 ring-1 ring-violet-500/50" title={sys.model ?? ""}>
        LLM: Grok {sys.model ? `(${sys.model})` : ""}
      </span>
    ) : (
      <span className="rounded bg-slate-700/60 px-2 py-0.5 text-xs font-semibold text-slate-200 ring-1 ring-slate-500/50" title="Rule-based planner, works offline">
        LLM: Mock
      </span>
    )
  ) : null;

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-100">
          <span className="grid h-7 w-7 place-items-center rounded bg-amber-500 text-sm font-black text-slate-950">MI</span>
          <span className="hidden whitespace-nowrap lg:inline">MES Incident Agent</span>
        </Link>
        <button className="btn-ghost ml-auto md:hidden" onClick={() => setOpen(!open)} aria-label="menu">☰</button>
        <nav className={`${open ? "flex" : "hidden"} absolute left-0 right-0 top-12 flex-col gap-1 border-b border-slate-800 bg-slate-950 p-3 md:static md:flex md:flex-row md:border-0 md:bg-transparent md:p-0`}>
          {links.map(([href, label]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)}
                className={`whitespace-nowrap rounded px-2.5 py-1.5 text-sm ${active ? "bg-slate-800 text-amber-400" : "text-slate-300 hover:bg-slate-800/60"}`}>
                {label}
                {href === "/approvals" && kpi && kpi.pending_approvals > 0 && (
                  <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-slate-950">{kpi.pending_approvals}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-3 whitespace-nowrap md:flex">
          {mode}
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Name written to the audit log when you approve">
            <span className="hidden xl:inline">acting as</span>
            <input className="input w-28 py-1 text-xs" value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
        </div>
      </div>
    </header>
  );
}
