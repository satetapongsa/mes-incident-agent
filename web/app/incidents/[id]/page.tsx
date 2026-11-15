"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Bot, CheckCircle2, ClipboardCheck, FileText, History, Loader2, MessageSquarePlus, Play, Search, Send, Workflow, Wrench, X,
} from "lucide-react";
import { type Action, type Incident, type Run, type Step, ago, fmt, post, useApi, useUser } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Field, Loading, PriorityBadge, StatusBadge } from "@/components/ui";
import AgentTrace, { RunSummary } from "@/components/AgentTrace";
import ActionCard from "@/components/ActionCard";
import Markdown from "@/components/Markdown";

interface Similar { incident_id: string; summary: string; score: number; root_cause: string; resolution: string; ci_name: string }

const logColor: Record<string, string> = { note: "gray", agent_analysis: "purple", action: "orange", resolution: "green" };
const logLabel: Record<string, string> = { note: "Note", agent_analysis: "Agent analysis", action: "Action", resolution: "Resolution" };

function ManualResolve({ id, onDone, onClose }: { id: string; onDone: () => void; onClose: () => void }) {
  const [user] = useUser();
  const [rc, setRc] = useState("");
  const [res, setRes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await post(`incidents/${id}/resolve`, { root_cause: rc, resolution: res, resolved_by: "human", user });
      onDone();
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Resolve manually" icon={Wrench}
          right={<button className="btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Root cause"><textarea className="input w-full" rows={2} required value={rc} onChange={(e) => setRc(e.target.value)} /></Field>
        <Field label="Resolution (what was done)"><textarea className="input w-full" rows={2} required value={res} onChange={(e) => setRes(e.target.value)} /></Field>
        <div className="flex items-center gap-3">
          <button className="btn-ok" disabled={busy || !rc.trim() || !res.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Resolve as {user}
          </button>
          <span className="text-xs text-zinc-500">Saved as resolved by a human.</span>
        </div>
        {err && <ErrorBox error={err} />}
      </form>
    </Card>
  );
}

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const inc = useApi<Incident>(`incidents/${id}`);
  const similar = useApi<Similar[]>(`incidents/${id}/similar`);
  const actions = useApi<Action[]>(`actions?incident_id=${id}`);
  const [user] = useUser();

  const [run, setRun] = useState<(Run & { live?: boolean }) | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const refreshAll = useCallback(() => {
    inc.reload();
    similar.reload();
    actions.reload();
  }, [inc, similar, actions]);

  const loadRun = useCallback(async (runId: number) => {
    const r = await fetch(`/api/runs/${runId}`, { cache: "no-store" }).then((x) => x.json());
    setRun(r);
    setSteps(r.steps ?? []);
    return r as Run & { live?: boolean };
  }, []);

  const stream = useCallback((runId: number) => {
    esRef.current?.close();
    setSteps([]);
    setRunning(true);
    const es = new EventSource(`/api/runs/${runId}/stream`);
    esRef.current = es;
    es.addEventListener("step", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as Step;
      setSteps((prev) => (prev.some((p) => p.step_no === s.step_no) ? prev : [...prev, s]));
    });
    es.addEventListener("done", () => {
      es.close();
      setRunning(false);
      loadRun(runId);
      refreshAll();
    });
    es.onerror = () => {
      es.close();
      setRunning(false);
      loadRun(runId);
    };
  }, [loadRun, refreshAll]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const runs: Run[] = await fetch(`/api/incidents/${id}/runs`, { cache: "no-store" }).then((x) => x.json());
        if (!cancelled && runs?.length) {
          const r = await loadRun(runs[0].run_id);
          if (r.live) stream(r.run_id);
        }
      } catch {
        /* no runs yet */
      }
    })();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runAgent() {
    setRunErr(null);
    try {
      const r = await post<{ run_id: number }>("runs", { incident_id: id });
      setRun({ run_id: r.run_id } as Run);
      stream(r.run_id);
    } catch (e) {
      setRunErr((e as Error).message);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    try {
      await post(`incidents/${id}/worklogs`, { author: user, log_type: "note", text: note });
      setNote("");
      inc.reload();
    } catch (e) {
      setRunErr((e as Error).message);
    }
  }

  if (inc.loading && !inc.data) return <Loading />;
  if (inc.error) return <ErrorBox error={inc.error} onRetry={inc.reload} />;
  const i = inc.data!;
  const closed = i.status === "Resolved" || i.status === "Closed";
  const pending = (actions.data ?? []).filter((a) => a.status === "Pending");
  const past = (actions.data ?? []).filter((a) => a.status !== "Pending");

  const info: [string, React.ReactNode][] = [
    ["Category", [i.category_tier1, i.category_tier2, i.category_tier3].filter(Boolean).join(" / ") || <span className="text-zinc-600">Not triaged</span>],
    ["Equipment / CI", i.ci_name ? <span className="mono">{i.ci_name}</span> : "-"],
    ["Support group", i.assigned_group || "-"],
    ["Submitted by", i.submitter],
    ["Source", i.source],
    ["Opened", fmt(i.created_at)],
    ["Last update", ago(i.updated_at)],
  ];

  return (
    <>
      <Link href="/incidents" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Incidents
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-base text-accent">{i.incident_id}</span>
            <PriorityBadge p={i.priority} />
            <StatusBadge s={i.status} />
            {i.resolved_by === "agent_approved" && <Badge color="purple"><Bot className="h-3.5 w-3.5" /> Resolved with agent</Badge>}
          </div>
          <h1 className="mt-1.5 text-xl font-semibold text-zinc-50">{i.summary}</h1>
        </div>
        {!closed && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setResolving(!resolving)}><Wrench className="h-4 w-4" /> Resolve manually</button>
            <button className="btn-primary" onClick={runAgent} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Agent running" : "Run agent"}
            </button>
          </div>
        )}
      </div>
      {runErr && <div className="mb-4"><ErrorBox error={runErr} /></div>}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Ticket" icon={FileText}>
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-sm">
              {info.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="text-zinc-200">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <div className="label mb-1.5">Description from operator</div>
              <p className="whitespace-pre-wrap rounded border border-line bg-ink p-3 text-sm text-zinc-300">{i.description || "-"}</p>
            </div>
            {i.root_cause && (
              <div className="mt-4 space-y-2 rounded border border-emerald-900 bg-emerald-950/30 p-3 text-sm">
                <div><div className="label text-emerald-500">Root cause</div><div className="mt-0.5 text-zinc-200">{i.root_cause}</div></div>
                <div><div className="label text-emerald-500">Resolution</div><div className="mt-0.5 text-zinc-200">{i.resolution}</div></div>
              </div>
            )}
          </Card>

          <Card title="Similar resolved incidents" icon={Search}>
            {similar.error ? <ErrorBox error={similar.error} /> : !similar.data ? <Loading /> : similar.data.length === 0 ? (
              <Empty text="No similar resolved incidents" />
            ) : (
              <ul className="divide-y divide-line">
                {similar.data.map((s) => (
                  <li key={s.incident_id} className="py-2.5 first:pt-0 last:pb-0 text-sm">
                    <div className="flex items-center gap-2">
                      <Link href={`/incidents/${s.incident_id}`} className="mono text-accent hover:underline">{s.incident_id}</Link>
                      <span className="mono text-zinc-500">{s.ci_name}</span>
                      <span className="ml-auto text-xs text-zinc-500">match {s.score}%</span>
                    </div>
                    <div className="mt-0.5 text-zinc-200">{s.summary}</div>
                    <div className="mt-0.5 text-zinc-500">Fix: {s.resolution}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Work log (${i.worklogs?.length ?? 0})`} icon={History}>
            <ol className="space-y-3">
              {(i.worklogs ?? []).map((w) => (
                <li key={w.id} className="border-l-2 border-line pl-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <Badge color={logColor[w.log_type] ?? "gray"}>{logLabel[w.log_type] ?? w.log_type}</Badge>
                    <span className="text-zinc-400">{w.author}</span><span>{fmt(w.created_at)}</span>
                  </div>
                  <div className="mt-1.5 text-sm">
                    {w.log_type === "agent_analysis" ? <Markdown text={w.text} /> : <p className="whitespace-pre-wrap text-zinc-300">{w.text}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {!closed && (
              <div className="mt-4 flex gap-2">
                <div className="relative flex-1">
                  <MessageSquarePlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input className="input w-full pl-9" placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)}
                         onKeyDown={(e) => e.key === "Enter" && addNote()} />
                </div>
                <button className="btn-ghost" onClick={addNote} aria-label="Add note"><Send className="h-4 w-4" /></button>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-3">
          {resolving && !closed && <ManualResolve id={id} onDone={refreshAll} onClose={() => setResolving(false)} />}
          {pending.length > 0 && (
            <Card title="Proposed action - needs your approval" icon={ClipboardCheck}>
              <div className="space-y-3">
                {pending.map((a) => <ActionCard key={a.id} a={a} showIncident={false}
                                                onDone={() => { refreshAll(); if (run?.run_id) setTimeout(() => loadRun(run.run_id), 300); }} />)}
              </div>
            </Card>
          )}
          <Card title="Agent trace" icon={Workflow} right={run?.run_id ? (
            <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="mono">run {run.run_id}</span>
              {run.llm_mode && <Badge>{run.llm_mode === "llm" ? "LLM" : "mock"}</Badge>}
              {run.skill_used && <Badge color="purple">{run.skill_used}</Badge>}
              {run.status && <StatusBadge s={running ? "Running" : run.status} />}
            </span>
          ) : undefined}>
            {steps.length === 0 && !running ? (
              <Empty icon={Bot} text={closed ? "Incident is closed." : "Run the agent: triage, similar incidents, skill, MCP tools, then a proposal for you to approve."} />
            ) : (
              <>
                <RunSummary steps={steps} running={running} pendingApproval={pending.length > 0} />
                <AgentTrace steps={steps} running={running} />
              </>
            )}
          </Card>
          {past.length > 0 && (
            <Card title="Action history" icon={History}>
              <div className="space-y-3">{past.map((a) => <ActionCard key={a.id} a={a} showIncident={false} />)}</div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
