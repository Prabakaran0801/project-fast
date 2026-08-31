import Link from "next/link";
import { Zap, Github } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/80 dark:bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 grid place-items-center">
            <Zap className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight text-sm">SPEED<span className="font-mono font-normal text-zinc-500">DL</span></span>
          <span className="hidden sm:inline-flex text-[10px] font-mono tracking-widest px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">BETA</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/history" className="text-sm font-mono text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-3 py-2">
            History
          </Link>
          <a href="https://github.com" target="_blank" rel="noreferrer" aria-label="GitHub" className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <Github className="h-4 w-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}
