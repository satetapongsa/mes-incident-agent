"use client";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { Card, ErrorBox, Loading, PageTitle } from "@/components/ui";
import Markdown from "@/components/Markdown";

interface SkillMeta { name: string; description: string; steps: string[] }
interface SkillFull extends SkillMeta { body: string; raw: string }

export default function Skills() {
  const list = useApi<SkillMeta[]>("skills");
  const [sel, setSel] = useState<string | null>(null);
  const skill = useApi<SkillFull>(sel ? `skills/${sel}` : null);

  useEffect(() => {
    if (!sel && list.data?.length) setSel(list.data.find((s) => s.name === "lot-hold-stuck")?.name ?? list.data[0].name);
  }, [list.data, sel]);

  return (
    <>
      <PageTitle title="Agent Skills" sub="Runbooks in agent/skills/<name>/SKILL.md. The agent first sees only name + description, picks one, then loads the full file." />
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Catalog (${list.data?.length ?? 0})`}>
          {!list.data ? <Loading /> : (
            <ul className="space-y-1.5">
              {list.data.map((s) => (
                <li key={s.name}>
                  <button onClick={() => setSel(s.name)}
                          className={`w-full rounded-md p-2 text-left ${sel === s.name ? "bg-slate-800 ring-1 ring-amber-500/60" : "hover:bg-slate-800/50"}`}>
                    <div className="font-mono text-sm text-amber-300">{s.name}</div>
                    <div className="mt-0.5 line-clamp-3 text-xs text-slate-400">{s.description}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={sel ?? "SKILL.md"} className="lg:col-span-2">
          {!sel ? null : skill.error ? <ErrorBox error={skill.error} /> : !skill.data || skill.data.name !== sel ? <Loading /> : (
            <>
              <div className="mb-3 rounded border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-400">
                ---<br />name: {skill.data.name}<br />description: {skill.data.description}<br />---
              </div>
              <Markdown text={skill.data.body} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
