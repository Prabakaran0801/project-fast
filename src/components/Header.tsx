import Link from "next/link";
import { Zap, Github, Clock3 } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/70 backdrop-blur-xl">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 h-[56px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="font-semibold tracking-[-0.02em] text-[14px] text-white">
            SPEED
            <span className="font-mono font-normal ml-1 text-zinc-400">DL</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="/history"
            className="inline-flex items-center gap-1.5 text-[13px] font-mono tracking-wide text-zinc-400 hover:text-white px-3 py-2 rounded-full hover:bg-zinc-800 transition-colors"
          >
            <Clock3 className="h-3.5 w-3.5" /> History
          </Link>
        </nav>
      </div>
    </header>
  );
}
