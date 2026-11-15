"use client";
import Link from "next/link";
import { useState } from "react";
import { type Action, ago, post, useUser } from "@/lib/api";
import { Badge, ErrorBox, Json, PriorityBadge, RiskBadge, StatusBadge } from "./ui";

interface ApproveResult {
  execute: { status: string; result: string };
  verify: { ok: boolean; resolved: boolean; escalated?: boolean; checks?: string[]; reason?: string } | null;
}

export default function ActionCard({ a, onDone, showIncident = true }: { a: Action; onDone?: () => void; showIncident?: boolean }) {
  const [user] = useUser();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<ApproveResult | null>(null);
  const [comment, setComment] = useState("");

  async function approve() {
    setBusy("approve");
    setErr(null);
    try {
      setRes(await post<ApproveResult>(`actions/${a.id}/approve`, { user }));
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function reject() {
    setBusy("reject");
    setErr(null);
    try {
      await post(`actions/${a.id}/reject`, { user, comment: comment || "rejected in web UI" });
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const pending = a.status === "Pending" && !res;
  return (
    <div className={`rounded-lg border ${pending ? "border-orange-500/60 bg-orange-950/10" : "border-slate-800 bg-slate-900/60"} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-slate-500">#{a.id}</span>
        <span className="font-mono font-semibold text-orange-300">{a.action_type}</span>
        <RiskBadge r={a.risk} />
        <StatusBadge s={a.status} />
        <span className="ml-auto text-xs text-slate-500">by {a.requested_by} · {ago(a.created_at)}</span>
      </div>
      {showIncident && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/incidents/${a.incident_id}`} className="font-mono text-amber-400 hover:underline">{a.incident_id}</Link>
          {a.incident_priority && <PriorityBadge p={a.incident_priority} />}
          <span className="text-slate-300">{a.incident_summary}</span>
        </div>
      )}
      <p className="mt-2 text-sm text-slate-300"><span className="text-slate-500">Reason: </span>{a.reason}</p>
      <div className="mt-2"><Json value={a.params} /></div>
      {a.result && <p className="mt-2 text-sm text-slate-400">Result: {a.result}</p>}
      {a.decided_by && <p className="mt-1 text-xs text-slate-500">Decided by {a.decided_by} · {ago(a.decided_at)}</p>}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-ok" disabled={!!busy} onClick={approve}>
            {busy === "approve" ? "Executing..." : `Approve & execute as ${user}`}
          </button>
          <input className="input flex-1" placeholder="reject comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-bad" disabled={!!busy} onClick={reject}>{busy === "reject" ? "..." : "Reject"}</button>
        </div>
      )}
      {err && <div className="mt-3"><ErrorBox error={err} /></div>}
      {res && (
        <div className="mt-3 space-y-1 rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
          <div><Badge color={res.execute.status === "Executed" ? "green" : "red"}>{res.execute.status}</Badge> {res.execute.result}</div>
          {res.verify && (
            <div>
              <Badge color={res.verify.ok ? "teal" : "red"}>{res.verify.ok ? "verified" : "verify failed"}</Badge>{" "}
              {res.verify.checks?.join("; ") ?? res.verify.reason}{" "}
              {res.verify.resolved && <Badge color="green">incident resolved</Badge>}
              {res.verify.escalated && <Badge color="purple">escalated - stays open for the team</Badge>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
