"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, CircleCheck, CircleX, Loader2, ShieldCheck, Users, X } from "lucide-react";
import { type Action, ago, post, useUser } from "@/lib/api";
import { Badge, ErrorBox, PriorityBadge, RiskBadge, StatusBadge } from "./ui";

interface ApproveResult {
  execute: { status: string; result: string };
  verify: { ok: boolean; resolved: boolean; escalated?: boolean; checks?: string[]; reason?: string } | null;
}

const ACTION_LABEL: Record<string, string> = {
  release_lot_hold: "Release lot hold",
  set_equipment_state: "Set equipment state / recipe",
  reset_interface: "Reset equipment interface",
  grant_user_role: "Grant user role",
  escalate_to_group: "Escalate to support group",
};

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
      await post(`actions/${a.id}/reject`, { user, comment: comment || "Rejected in web UI" });
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const pending = a.status === "Pending" && !res;
  const Icon = a.action_type === "escalate_to_group" ? Users : ShieldCheck;
  return (
    <div className={`rounded-md border ${pending ? "border-accent/50 bg-accent/[0.04]" : "border-line bg-ink"} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className={`h-5 w-5 ${pending ? "text-accent" : "text-zinc-500"}`} />
        <span className="font-semibold text-zinc-100">{ACTION_LABEL[a.action_type] ?? a.action_type}</span>
        <span className="mono text-zinc-500">#{a.id}</span>
        <RiskBadge r={a.risk} />
        <StatusBadge s={a.status} />
        <span className="ml-auto text-xs text-zinc-500">proposed by {a.requested_by}, {ago(a.created_at)}</span>
      </div>
      {showIncident && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/incidents/${a.incident_id}`} className="mono text-accent hover:underline">{a.incident_id}</Link>
          {a.incident_priority && <PriorityBadge p={a.incident_priority} />}
          <span className="text-zinc-300">{a.incident_summary}</span>
        </div>
      )}

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[120px_1fr]">
        <dt className="label pt-0.5">Reason</dt>
        <dd className="text-zinc-300">{a.reason}</dd>
        <dt className="label pt-0.5">Parameters</dt>
        <dd className="flex flex-wrap gap-1.5">
          {Object.entries(a.params ?? {}).map(([k, v]) => (
            <span key={k} className="rounded border border-line bg-raised px-2 py-0.5 text-xs">
              <span className="text-zinc-500">{k}:</span> <span className="mono text-zinc-200">{String(v)}</span>
            </span>
          ))}
        </dd>
        {a.result && (<><dt className="label pt-0.5">Result</dt><dd className="text-zinc-400">{a.result}</dd></>)}
        {a.decided_by && (<><dt className="label pt-0.5">Decided by</dt><dd className="text-zinc-400">{a.decided_by}, {ago(a.decided_at)}</dd></>)}
      </dl>

      {pending && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button className="btn-ok" disabled={!!busy} onClick={approve}>
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve and execute
          </button>
          <input className="input min-w-[180px] flex-1" placeholder="Reason for rejecting (optional)" value={comment}
                 onChange={(e) => setComment(e.target.value)} />
          <button className="btn-bad" disabled={!!busy} onClick={reject}>
            {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject
          </button>
          <span className="w-full text-xs text-zinc-500">Recorded in the audit log as <span className="text-zinc-300">{user}</span>.</span>
        </div>
      )}
      {err && <div className="mt-3"><ErrorBox error={err} /></div>}
      {res && (
        <div className="mt-3 space-y-1.5 rounded-md border border-line bg-raised p-3 text-sm">
          <div className="flex items-center gap-2">
            {res.execute.status === "Executed" ? <CircleCheck className="h-4 w-4 text-emerald-400" /> : <CircleX className="h-4 w-4 text-rose-400" />}
            <span>{res.execute.result}</span>
          </div>
          {res.verify && (
            <div className="flex flex-wrap items-center gap-2">
              {res.verify.ok ? <CircleCheck className="h-4 w-4 text-teal-400" /> : <CircleX className="h-4 w-4 text-rose-400" />}
              <span className="text-zinc-300">Agent check: {res.verify.checks?.join("; ") ?? res.verify.reason}</span>
              {res.verify.resolved && <Badge color="green">Incident resolved</Badge>}
              {res.verify.escalated && <Badge color="purple">Escalated, stays open for the team</Badge>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
