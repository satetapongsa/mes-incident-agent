"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardCheck, Factory, ScrollText, Workflow, X, type LucideIcon } from "lucide-react";

const STEPS: [LucideIcon, string, string, string, string][] = [
  [Factory, "1. A problem happens", "Use the failure simulator on the shop floor, or open a ticket in Incidents.", "/mes", "Shop floor"],
  [Workflow, "2. The agent analyses", "Open the ticket and press Run agent (or switch on Auto mode in the sidebar).", "/incidents", "Incidents"],
  [ClipboardCheck, "3. You approve", "The agent only proposes a fix. Approve or reject it.", "/approvals", "Approvals"],
  [ScrollText, "4. Fixed and recorded", "The agent re-checks the MES, resolves the ticket, every step is in the audit log.", "/audit", "Audit log"],
];

export default function HowItWorks() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(localStorage.getItem("mia_hide_guide") === "1"), []);
  if (hidden) return null;
  return (
    <section className="card mb-5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="card-t">How it works</h2>
        <button className="btn-ghost h-8 w-8 px-0" aria-label="Hide guide"
                onClick={() => { localStorage.setItem("mia_hide_guide", "1"); setHidden(true); }}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STEPS.map(([Icon, title, text, href, link]) => (
          <li key={title} className="flex gap-3 rounded-md border border-line bg-ink p-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded bg-raised"><Icon className="h-4 w-4 text-accent" /></div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-100">{title}</div>
              <p className="mt-0.5 text-sm text-zinc-500">{text}</p>
              <Link href={href} className="mt-1 inline-block text-sm text-accent hover:underline">{link}</Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
