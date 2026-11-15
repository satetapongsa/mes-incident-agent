import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Thai } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const thai = IBM_Plex_Sans_Thai({ subsets: ["thai"], weight: ["400", "500", "600"], variable: "--font-thai" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "MES Incident Agent",
  description: "Incident handling for MES operations - simulated Remedy + Opcenter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${thai.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Sidebar />
        <div className="lg:pl-60">
          <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">{children}</main>
          <footer className="mx-auto max-w-[1400px] px-4 pb-6 text-xs text-zinc-600 lg:px-8">
            Demo system. Remedy and Opcenter are simulated (no vendor code). Every agent action needs human approval.
          </footer>
        </div>
      </body>
    </html>
  );
}
