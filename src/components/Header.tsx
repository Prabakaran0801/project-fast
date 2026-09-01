import Link from "next/link";
import { Clock3 } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/70 backdrop-blur-xl supports-[backdrop-filter]:bg-zinc-950/60">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 h-[56px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group rounded-full px-2 py-1 -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20">
          <span className="font-semibold tracking-[-0.02em] text-[14px] text-white">
            SPEED
            <span className="font-mono font-normal ml-1 text-zinc-400">DL</span>
          </span>
          <span className="hidden sm:inline-flex text-[10px] font-mono tracking-[0.14em] text-zinc-500 border border-zinc-800 rounded-full px-2 py-0.5">PWA</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="/history"
            aria-label="View history"
            className="inline-flex items-center gap-1.5 text-[13px] font-mono tracking-wide text-zinc-400 hover:text-white px-3 py-2 min-h-[36px] rounded-full hover:bg-zinc-800 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden /> History
          </Link>
        </nav>
      </div>
    </header>
  );
}
