import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "MES Incident Agent",
  description: "Agentic AI for MES operations - simulated Remedy + Opcenter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-6 text-xs text-slate-600">
          Demo system. Remedy and Opcenter are simulated - no vendor code. Agent actions always need human approval.
        </footer>
      </body>
    </html>
  );
}
