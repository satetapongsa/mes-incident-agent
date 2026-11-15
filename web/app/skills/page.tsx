"use client";
import { useEffect, useState } from "react";
import { BookOpen, FileText, ListChecks } from "lucide-react";
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
      <PageTitle title="Agent skills" icon={BookOpen}
                 sub="Runbooks the agent follows. It first sees only the name and description, picks one, then reads the full runbook." />
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`Skills (${list.data?.length ?? 0})`} icon={ListChecks} pad={false}>
          {!list.data ? <div className="px-4"><Loading /></div> : (
            <ul className="divide-y divide-line">
              {list.data.map((s) => (
                <li key={s.name}>
                  <button onClick={() => setSel(s.name)}
                          className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${sel === s.name ? "border-accent bg-raised" : "border-transparent hover:bg-raised"}`}>
                    <div className="mono font-medium text-zinc-100">{s.name}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-zinc-500">{s.description}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={sel ?? "SKILL.md"} icon={FileText} className="xl:col-span-2">
          {!sel ? null : skill.error ? <ErrorBox error={skill.error} /> : !skill.data || skill.data.name !== sel ? <Loading /> : (
            <>
              <div className="mb-4 rounded border border-line bg-ink p-3 text-sm">
                <div className="label mb-1">When to use</div>
                <p className="text-zinc-300">{skill.data.description}</p>
              </div>
              <Markdown text={skill.data.body} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
