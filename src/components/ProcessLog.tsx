"use client";
import { useEffect, useRef } from "react";
import { Copy, Trash2, Terminal } from "lucide-react";

export type LogEntry = {
  time: string;
  level: "info" | "warn" | "error" | "ok";
  route: string;
  msg: string;
};

const levelColor: Record<LogEntry["level"], string> = {
  info: "text-zinc-400",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

const routeColor = (r: string) => {
  if (r.includes("/api/parse")) return "bg-violet-500/20 text-violet-300 border-violet-500/30";
  if (r.includes("/api/job")) return "bg-sky-500/20 text-sky-300 border-sky-500/30";
  if (r.includes("/api/download")) return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  if (r.includes("R2")) return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  if (r.includes("client ffmpeg")) return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
  if (r.includes("/api/transfer")) return "bg-pink-500/20 text-pink-300 border-pink-500/30";
  return "bg-zinc-800 text-zinc-300 border-zinc-700";
};

export function ProcessLog({
  logs,
  onClear,
}: {
  logs: LogEntry[];
  onClear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  async function copyAll() {
    const text = logs.map((l) => `[${l.time}] [${l.route}] ${l.msg}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  if (!logs.length) return null;

  return (
    <div className="mt-6 w-full rounded-2xl border border-zinc-800 bg-[#0f0f12] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2 text-xs font-mono tracking-[0.12em] text-zinc-300">
          <span className="h-7 w-7 rounded-lg bg-zinc-800 border border-zinc-700 grid place-items-center">
            <Terminal className="h-3.5 w-3.5" />
          </span>
          PROCESS LOG
          <span className="ml-2 px-2 py-0.5 rounded-full bg-white text-zinc-900 text-[10px] font-medium tracking-[0.14em]">
            LIVE
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={copyAll}
            className="h-7 px-2.5 rounded-full bg-zinc-800 border border-zinc-700 text-[11px] font-mono text-zinc-300 hover:text-white flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
          <button
            onClick={onClear}
            className="h-7 px-2.5 rounded-full bg-zinc-800 border border-zinc-700 text-[11px] font-mono text-zinc-300 hover:text-white flex items-center gap-1"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        </div>
      </div>
      <div
        ref={ref}
        className="max-h-[280px] overflow-auto p-3 font-mono text-[11px] leading-[1.7] bg-[#0a0a0c] scroll-smooth"
        aria-live="polite"
      >
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2 py-0.5">
            <span className="shrink-0 text-zinc-600">{l.time}</span>
            <span className={`shrink-0 px-1.5 py-0 rounded border text-[10px] leading-4 ${routeColor(l.route)}`}>
              {l.route}
            </span>
            <span className={`${levelColor[l.level]} break-all`}>{l.msg}</span>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 border-t border-zinc-800 text-[10px] font-mono text-zinc-500 flex items-center justify-between">
        <span>
          Showing <span className="text-zinc-300">{logs.length}</span> steps • auto-scroll on new log
        </span>
        <span className="text-zinc-600">local = prod • single Vercel deploy</span>
      </div>
    </div>
  );
}
