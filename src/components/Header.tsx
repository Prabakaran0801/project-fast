"use client";
import Link from "next/link";
import { Clock3, Download } from "lucide-react";
import { useEffect, useState } from "react";

export function Header() {
  const [deferred, setDeferred] = useState<any>(null);

  useEffect(() => {
    const h = (e: any) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  const onDownloadApp = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    } else {
      // iOS / already installed fallback — keep visible
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      alert(
        isIOS
          ? "iOS: Share → Add to Home Screen to install Mediamover"
          : "Use Chrome menu → Install app / Add to home screen",
      );
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/70 backdrop-blur-xl supports-[backdrop-filter]:bg-zinc-950/60">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 h-[56px] flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-3 group rounded-full px-2 py-1 -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="Mediamover"
            width={28}
            height={28}
            className="h-7 w-7 rounded-lg shrink-0"
          />
          <span className="font-semibold tracking-[-0.02em] text-[16px] text-white">
            MEDIA
            <span className="font-mono font-normal ml-1 text-zinc-400">
              MOVER
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1.5">
          <Link
            href="/history"
            aria-label="View history"
            className="inline-flex items-center gap-1.5 text-[13px] font-mono tracking-wide text-zinc-400 hover:text-white px-3 py-2 min-h-[36px] rounded-full hover:bg-zinc-800 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden /> History
          </Link>
          <button
            onClick={onDownloadApp}
            aria-label="Download app"
            className="inline-flex items-center gap-1.5 p-1 text-[13px] font-mono tracking-wide bg-white text-zinc-900 hover:bg-zinc-200 px-3.5 py-2 min-h-[36px] rounded-full shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />{" "}
            <span className="">Download App</span>
            {/* <span className="sm:hidden">App</span> */}
          </button>
        </nav>
      </div>
    </header>
  );
}
