"use client";
import { ClipboardCheck, History, ShieldCheck } from "lucide-react";
import { type Action, useApi } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, PageTitle } from "@/components/ui";
import ActionCard from "@/components/ActionCard";

export default function Approvals() {
  const pending = useApi<Action[]>("actions?status=Pending", 8000);
  const all = useApi<Action[]>("actions", 15000);
  const recent = (all.data ?? []).filter((a) => a.status !== "Pending").slice(0, 15);
  const reload = () => { pending.reload(); all.reload(); };

  return (
    <>
      <PageTitle title="Approvals" icon={ClipboardCheck}
                 sub="Nothing changes on the shop floor until a person approves. Approve runs the action, then the agent checks the result." />
      <Card title={`Waiting for approval (${pending.data?.length ?? 0})`} icon={ShieldCheck}>
        {pending.error ? <ErrorBox error={pending.error} onRetry={pending.reload} /> : !pending.data ? <Loading /> :
          pending.data.length === 0 ? <Empty icon={ClipboardCheck} text="No actions waiting. Run the agent on an incident to get a proposal." /> : (
            <div className="space-y-3">{pending.data.map((a) => <ActionCard key={a.id} a={a} onDone={reload} />)}</div>
          )}
      </Card>
      <Card title="Recently decided" icon={History} className="mt-4">
        {all.error ? <ErrorBox error={all.error} /> : !all.data ? <Loading /> : recent.length === 0 ? <Empty text="Nothing decided yet" /> : (
          <div className="space-y-3">{recent.map((a) => <ActionCard key={a.id} a={a} />)}</div>
        )}
      </Card>
    </>
  );
}
