"use client";
import { useState } from "react";
import {
  AlertOctagon, BadgeCheck, BookOpen, ChevronDown, ChevronRight, CircleCheck, CircleX, Flag, Hand, Loader2, MessageSquareText,
  Wrench, type LucideIcon,
} from "lucide-react";
import type { Step } from "@/lib/api";
import { Badge, Json, RiskBadge } from "./ui";
import Markdown from "./Markdown";

const STYLE: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  thought: { label: "Reasoning", icon: MessageSquareText, color: "text-zinc-400" },
  skill_loaded: { label: "Skill loaded", icon: BookOpen, color: "text-violet-400" },
  tool_call: { label: "Tool call", icon: Wrench, color: "text-sky-400" },
  tool_result: { label: "Tool result", icon: CircleCheck, color: "text-emerald-400" },
  proposal: { label: "Proposal", icon: Hand, color: "text-accent" },
  verify: { label: "Verify", icon: BadgeCheck, color: "text-teal-400" },
  error: { label: "Notice", icon: AlertOctagon, color: "text-rose-400" },
  final: { label: "Result", icon: Flag, color: "text-zinc-200" },
};

function Toggle({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200" onClick={onClick}>
      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function Body({ s }: { s: Step }) {
  const c = s.content ?? {};
  const [open, setOpen] = useState(false);
  switch (s.step_type) {
    case "thought":
    case "error":
      return <p className="whitespace-pre-wrap text-sm text-zinc-300">{c.text}</p>;
    case "skill_loaded":
      return (
        <div className="space-y-1">
          <div className="text-sm"><span className="mono font-medium text-violet-300">{c.skill}</span>
            <span className="ml-2 text-xs text-zinc-500">{c.phase === "triage" ? "triage" : "runbook"}</span></div>
          <p className="text-xs text-zinc-500">{c.description}</p>
          {c.content && <Toggle open={open} onClick={() => setOpen(!open)}>{open ? "Hide SKILL.md" : "Show SKILL.md"}</Toggle>}
          {open && <div className="max-h-80 overflow-auto rounded border border-line bg-ink p-3"><Markdown text={c.content} /></div>}
        </div>
      );
    case "tool_call":
      return (
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono font-medium text-sky-300">{c.tool}</span>
            {c.n && <span className="text-xs text-zinc-500">call {c.n} of {c.max}</span>}
            {c.phase === "verify" && <Badge color="teal">verify</Badge>}
          </div>
          <code className="mono block truncate text-zinc-500">{JSON.stringify(c.args)}</code>
        </div>
      );
    case "tool_result":
      return (
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="mono text-emerald-300">{c.tool}</span>
            {c.ok ? <Badge color="green">OK</Badge> : <Badge color="red"><CircleX className="h-3 w-3" /> error</Badge>}
            <Toggle open={open} onClick={() => setOpen(!open)}>data</Toggle>
          </div>
          {open && <Json value={c.result} />}
        </div>
      );
    case "proposal":
      return (
        <div className="space-y-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono font-medium text-accent">{c.action_type}</span>
            <RiskBadge r={c.risk} />
            <Badge color="orange">Action #{c.action_id} waiting for approval</Badge>
          </div>
          <p className="text-zinc-300">{c.reason}</p>
          <code className="mono block text-zinc-500">{JSON.stringify(c.params)}</code>
        </div>
      );
    case "verify":
      return (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {c.ok ? <Badge color="green">Verified</Badge> : <Badge color="red">Not verified</Badge>}
          <span className="text-zinc-300">{c.text}</span>
        </p>
      );
    case "final":
      return (
        <div className="space-y-1 text-sm text-zinc-300">
          <div className="flex flex-wrap gap-2">
            <Badge color={c.status === "Completed" || c.status === "Resolved" ? "green" : c.status === "Escalated" ? "purple" : "red"}>{c.status}</Badge>
            {c.skill_used && <Badge color="purple">{c.skill_used}</Badge>}
            {c.tool_calls !== undefined && <Badge>{c.tool_calls} tool calls</Badge>}
            {c.llm_mode && <Badge>{c.llm_mode === "llm" ? "LLM" : "mock"}</Badge>}
          </div>
          {c.summary && <p>{c.summary}</p>}
          {c.root_cause && <p className="text-xs text-zinc-500">Root cause: {c.root_cause}</p>}
        </div>
      );
    default:
      return <Json value={c} />;
  }
}

export default function AgentTrace({ steps, running }: { steps: Step[]; running: boolean }) {
  return (
    <ol className="relative space-y-0">
      {steps.map((s, i) => {
        const st = STYLE[s.step_type] ?? STYLE.thought;
        const Icon = s.step_type === "tool_result" && !s.content?.ok ? CircleX : st.icon;
        const last = i === steps.length - 1 && !running;
        return (
          <li key={`${s.run_id}-${s.step_no}`} className="relative flex gap-3 pb-3">
            {!last && <span className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-line" />}
            <div className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-raised ${st.color}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className={`min-w-0 flex-1 rounded-md border px-3 py-2 ${s.step_type === "proposal" ? "border-accent/50 bg-accent/5" : "border-line bg-ink"}`}>
              <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                <span className="font-medium text-zinc-400">{st.label}</span>
                <span className="mono">#{s.step_no}</span>
                <span className="ml-auto mono">{new Date(s.created_at).toLocaleTimeString("en-GB")}</span>
              </div>
              <Body s={s} />
            </div>
          </li>
        );
      })}
      {running && (
        <li className="flex items-center gap-3 pl-1 text-sm text-accent">
          <Loader2 className="h-5 w-5 animate-spin" /> Agent is working
        </li>
      )}
    </ol>
  );
}

const ACTION_TEXT: Record<string, string> = {
  release_lot_hold: "Release lot hold",
  set_equipment_state: "Set equipment state / recipe",
  reset_interface: "Reset equipment interface",
  grant_user_role: "Grant user role",
  escalate_to_group: "Escalate to support group",
};

/** One-glance summary of a run: what the agent found, what it proposes, and what the user should do next. */
export function RunSummary({ steps, running, pendingApproval }: { steps: Step[]; running: boolean; pendingApproval: boolean }) {
  if (running || steps.length === 0) return null;
  const finals = steps.filter((s) => s.step_type === "final").map((s) => s.content);
  const run = finals[0] ?? {};
  const last = finals[finals.length - 1] ?? {};
  const proposal = steps.find((s) => s.step_type === "proposal")?.content;
  const verified = steps.some((s) => s.step_type === "verify" && s.content?.ok);
  const secs = Math.max(0, Math.round((new Date(steps[steps.length - 1].created_at).getTime() - new Date(steps[0].created_at).getTime()) / 1000));

  let tone = "border-line bg-raised", Icon: LucideIcon = Flag, headline = "Run finished";
  if (last.status === "Resolved" || verified) {
    tone = "border-emerald-800 bg-emerald-950/30"; Icon = CircleCheck; headline = "Fixed and verified by the agent - ticket resolved";
  } else if (last.status === "Escalated") {
    tone = "border-violet-800 bg-violet-950/30"; Icon = Hand; headline = `Handed over to ${proposal?.params?.group_name ?? "the support group"}`;
  } else if (pendingApproval && proposal) {
    tone = "border-accent/60 bg-accent/[0.06]"; Icon = Hand; headline = "Waiting for your approval - see the proposed action above";
  } else if (run.status === "Failed" || run.status === "Timeout") {
    tone = "border-rose-900 bg-rose-950/30"; Icon = AlertOctagon; headline = `Run ${String(run.status).toLowerCase()} - check the notices below`;
  }

  return (
    <div className={`mb-4 rounded-md border p-4 ${tone}`}>
      <div className="flex items-center gap-2 font-semibold text-zinc-50"><Icon className="h-5 w-5" /> {headline}</div>
      <dl className="mt-3 grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[130px_1fr]">
        {run.root_cause && (<><dt className="text-zinc-500">Root cause</dt><dd className="text-zinc-200">{run.root_cause}</dd></>)}
        {proposal && (<><dt className="text-zinc-500">Proposed fix</dt>
          <dd className="text-zinc-200">{ACTION_TEXT[proposal.action_type] ?? proposal.action_type}
            <span className="mono ml-2 text-zinc-500">{Object.values(proposal.params ?? {}).filter((v) => typeof v === "string" && v.length < 40).join(", ")}</span></dd></>)}
        <dt className="text-zinc-500">Runbook</dt><dd className="mono text-zinc-300">{run.skill_used ?? "none (escalated)"}</dd>
        <dt className="text-zinc-500">Effort</dt>
        <dd className="text-zinc-400">{run.tool_calls ?? "-"} tool calls, {secs} s, {run.llm_mode === "llm" ? "LLM" : "mock planner"}</dd>
      </dl>
    </div>
  );
}
