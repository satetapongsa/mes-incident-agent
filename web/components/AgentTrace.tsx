"use client";
import { useState } from "react";
import type { Step } from "@/lib/api";
import { Badge, Json, RiskBadge } from "./ui";
import Markdown from "./Markdown";

const style: Record<string, { label: string; color: string; border: string }> = {
  thought: { label: "thought", color: "gray", border: "border-slate-700" },
  skill_loaded: { label: "skill loaded", color: "purple", border: "border-violet-600/60" },
  tool_call: { label: "tool call", color: "blue", border: "border-sky-700/60" },
  tool_result: { label: "tool result", color: "green", border: "border-emerald-800/60" },
  proposal: { label: "proposal", color: "orange", border: "border-orange-500/70" },
  verify: { label: "verify", color: "teal", border: "border-teal-600/60" },
  error: { label: "error", color: "red", border: "border-rose-700" },
  final: { label: "final", color: "amber", border: "border-amber-600/60" },
};

function Body({ s }: { s: Step }) {
  const c = s.content ?? {};
  const [open, setOpen] = useState(false);
  switch (s.step_type) {
    case "thought":
    case "error":
      return <p className="whitespace-pre-wrap text-sm text-slate-300">{c.text}</p>;
    case "skill_loaded":
      return (
        <div>
          <div className="text-sm">
            <span className="font-mono font-semibold text-violet-300">{c.skill}</span>
            <span className="ml-2 text-xs text-slate-500">({c.phase})</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{c.description}</p>
          {c.content && (
            <button className="mt-1 text-xs text-violet-300 hover:underline" onClick={() => setOpen(!open)}>
              {open ? "hide SKILL.md" : "show full SKILL.md (loaded into context)"}
            </button>
          )}
          {open && <div className="mt-2 max-h-80 overflow-auto rounded bg-slate-950 p-3"><Markdown text={c.content} /></div>}
        </div>
      );
    case "tool_call":
      return (
        <div className="text-sm">
          <span className="font-mono font-semibold text-sky-300">{c.tool}</span>
          {c.n && <span className="ml-2 text-xs text-slate-500">call {c.n}/{c.max}</span>}
          {c.phase === "verify" && <Badge color="teal" className="ml-2">verify</Badge>}
          <div className="mt-1"><Json value={c.args} /></div>
        </div>
      );
    case "tool_result":
      return (
        <div className="text-sm">
          <span className="font-mono text-emerald-300">{c.tool}</span>{" "}
          {c.ok ? <Badge color="green">ok</Badge> : <Badge color="red">error</Badge>}
          <button className="ml-2 text-xs text-slate-400 hover:underline" onClick={() => setOpen(!open)}>
            {open ? "hide" : "show"} result
          </button>
          {open && <div className="mt-1"><Json value={c.result} /></div>}
        </div>
      );
    case "proposal":
      return (
        <div className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-orange-300">{c.action_type}</span>
            <RiskBadge r={c.risk} />
            <Badge color="orange">action #{c.action_id} - waiting for human approval</Badge>
          </div>
          <p className="mt-1 text-slate-300">{c.reason}</p>
          <Json value={c.params} />
        </div>
      );
    case "verify":
      return (
        <p className="text-sm">
          {c.ok ? <Badge color="green">verified</Badge> : <Badge color="red">not verified</Badge>}{" "}
          <span className="text-slate-300">{c.text}</span>
        </p>
      );
    case "final":
      return (
        <div className="text-sm text-slate-300">
          <div className="flex flex-wrap gap-2">
            <Badge color={c.status === "Completed" || c.status === "Resolved" ? "green" : c.status === "Escalated" ? "purple" : "red"}>{c.status}</Badge>
            {c.skill_used && <Badge color="purple">{c.skill_used}</Badge>}
            {c.tool_calls !== undefined && <Badge>{c.tool_calls} tool calls</Badge>}
            {c.llm_mode && <Badge>{c.llm_mode}</Badge>}
          </div>
          {c.summary && <p className="mt-1">{c.summary}</p>}
          {c.root_cause && <p className="mt-1 text-xs text-slate-400">Root cause: {c.root_cause}</p>}
        </div>
      );
    default:
      return <Json value={c} />;
  }
}

export default function AgentTrace({ steps, running }: { steps: Step[]; running: boolean }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => {
        const st = style[s.step_type] ?? style.thought;
        return (
          <li key={`${s.run_id}-${s.step_no}`} className={`rounded-md border-l-4 ${st.border} bg-slate-950/60 px-3 py-2`}>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="font-mono">#{s.step_no}</span>
              <Badge color={st.color}>{st.label}</Badge>
              <span className="ml-auto">{new Date(s.created_at).toLocaleTimeString("en-GB")}</span>
            </div>
            <Body s={s} />
          </li>
        );
      })}
      {running && (
        <li className="flex items-center gap-2 px-3 py-2 text-sm text-amber-300">
          <span className="h-2 w-2 animate-ping rounded-full bg-amber-400" /> agent working...
        </li>
      )}
    </ol>
  );
}
