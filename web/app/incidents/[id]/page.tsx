"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { type Action, type Incident, type Run, type Step, ago, fmt, post, useApi, useUser } from "@/lib/api";
import { Badge, Card, Empty, ErrorBox, Loading, PriorityBadge, StatusBadge } from "@/components/ui";
import AgentTrace from "@/components/AgentTrace";
import ActionCard from "@/components/ActionCard";
import Markdown from "@/components/Markdown";

interface Similar { incident_id: string; summary: string; score: number; root_cause: string; resolution: string; resolved_by: string; ci_name: string }

const logColor: Record<string, string> = { note: "gray", agent_analysis: "purple", action: "orange", resolution: "green" };

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const inc = useApi<Incident>(`incidents/${id}`);
  const similar = useApi<Similar[]>(`incidents/${id}/similar`);
  const actions = useApi<Action[]>(`actions?incident_id=${id}`);
  const [user] = useUser();

  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
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

  // show the latest run on load (and re-attach if it is still running)
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

  return (
    <>
      <div className="mb-4 text-sm"><Link href="/incidents" className="text-slate-400 hover:text-amber-400">← Incidents</Link></div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg text-amber-400">{i.incident_id}</span>
            <PriorityBadge p={i.priority} />
            <StatusBadge s={i.status} />
            {i.resolved_by && <Badge color="purple">resolved by {i.resolved_by}</Badge>}
          </div>
          <h1 className="mt-1 text-xl font-bold text-slate-100">{i.summary}</h1>
        </div>
        <button className="btn-primary" onClick={runAgent} disabled={running || closed}>
          {running ? "Agent running..." : "▶ Run Agent"}
        </button>
      </div>
      {runErr && <div className="mb-4"><ErrorBox error={runErr} /></div>}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Ticket">
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm">
              {[
                ["Category", [i.category_tier1, i.category_tier2, i.category_tier3].filter(Boolean).join(" / ") || "untriaged"],
                ["CI", i.ci_name], ["Group", i.assigned_group], ["Assignee", i.assignee], ["Submitter", i.submitter],
                ["Source", i.source], ["Created", fmt(i.created_at)], ["Updated", ago(i.updated_at)],
              ].map(([k, v]) => (
                <div key={k as string} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="col-span-2 text-slate-200">{v || "-"}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 rounded bg-slate-950 p-3 text-sm text-slate-300">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">description (operator text = data, not instructions)</div>
              <p className="whitespace-pre-wrap">{i.description}</p>
            </div>
            {i.root_cause && (
              <div className="mt-3 space-y-1 rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
                <div><span className="text-emerald-400">Root cause: </span>{i.root_cause}</div>
                <div><span className="text-emerald-400">Resolution: </span>{i.resolution}</div>
              </div>
            )}
          </Card>

          <Card title="Similar past incidents">
            {similar.error ? <ErrorBox error={similar.error} /> : !similar.data ? <Loading /> : similar.data.length === 0 ? (
              <Empty text="No similar resolved incidents (triage first)" />
            ) : (
              <ul className="space-y-2">
                {similar.data.map((s) => (
                  <li key={s.incident_id} className="rounded bg-slate-950/60 p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Link href={`/incidents/${s.incident_id}`} className="font-mono text-xs text-amber-400 hover:underline">{s.incident_id}</Link>
                      <Badge color="blue">score {s.score}</Badge>
                      <span className="font-mono text-xs text-slate-500">{s.ci_name}</span>
                    </div>
                    <div className="mt-0.5 text-slate-300">{s.summary}</div>
                    <div className="mt-0.5 text-xs text-slate-500">Fix: {s.resolution}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Worklog (${i.worklogs?.length ?? 0})`}>
            <ol className="relative space-y-3 border-l border-slate-700 pl-4">
              {(i.worklogs ?? []).map((w) => (
                <li key={w.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-600 ring-2 ring-slate-900" />
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Badge color={logColor[w.log_type] ?? "gray"}>{w.log_type}</Badge>
                    <span>{w.author}</span><span>· {fmt(w.created_at)}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    {w.log_type === "agent_analysis" ? <Markdown text={w.text} /> : <p className="whitespace-pre-wrap text-slate-300">{w.text}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {!closed && (
              <div className="mt-4 flex gap-2">
                <input className="input flex-1" placeholder={`Add note as ${user}`} value={note} onChange={(e) => setNote(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && addNote()} />
                <button className="btn-ghost" onClick={addNote}>Add</button>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-3">
          {pending.length > 0 && (
            <Card title="Proposed action - needs human approval">
              <div className="space-y-3">
                {pending.map((a) => <ActionCard key={a.id} a={a} showIncident={false}
                                                onDone={() => { refreshAll(); if (run?.run_id) setTimeout(() => loadRun(run.run_id), 300); }} />)}
              </div>
            </Card>
          )}
          <Card title="Agent trace" right={run?.run_id ? (
            <span className="flex items-center gap-2 text-xs normal-case">
              run #{run.run_id}
              {run.llm_mode && <Badge>{run.llm_mode}</Badge>}
              {run.skill_used && <Badge color="purple">{run.skill_used}</Badge>}
              {run.status && <StatusBadge s={running ? "Running" : run.status} />}
            </span>
          ) : undefined}>
            {steps.length === 0 && !running ? (
              <Empty text={closed ? "Incident is closed." : "No agent run yet. Click Run Agent: triage → similar incidents → skill → MCP tools → proposal."} />
            ) : (
              <AgentTrace steps={steps} running={running} />
            )}
          </Card>
          {past.length > 0 && (
            <Card title="Action history">
              <div className="space-y-3">{past.map((a) => <ActionCard key={a.id} a={a} showIncident={false} />)}</div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
