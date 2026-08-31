import Link from "next/link";
import { Zap, Github, Clock3 } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/70 backdrop-blur-xl">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 h-[56px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="h-8 w-8 rounded-xl bg-white text-zinc-900 grid place-items-center shadow-sm group-hover:scale-[1.02] transition-transform">
            <Zap className="h-[15px] w-[15px]" />
          </div>
          <span className="font-semibold tracking-[-0.02em] text-[14px] text-white">SPEED<span className="font-mono font-normal text-zinc-400">DL</span></span>
          <span className="hidden sm:inline-flex text-[10px] font-mono tracking-[0.14em] px-2 py-1 rounded-full bg-white text-zinc-900">BETA</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/history" className="inline-flex items-center gap-1.5 text-[13px] font-mono tracking-wide text-zinc-400 hover:text-white px-3 py-2 rounded-full hover:bg-zinc-800 transition-colors">
            <Clock3 className="h-3.5 w-3.5" /> History
          </Link>
          <span className="hidden sm:inline-block h-4 w-px bg-zinc-800 mx-1" />
          <a href="https://github.com" target="_blank" rel="noreferrer" aria-label="GitHub" className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            <Github className="h-4 w-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}
