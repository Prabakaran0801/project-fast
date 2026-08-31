"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Link2, Loader2, AlertCircle } from "lucide-react";

export function LinkInput({ onDetect }: { onDetect: (jobId: string, url: string) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse");
      onDetect(data.jobId, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-center">
          <div className="absolute left-4 text-zinc-500 pointer-events-none">
            <Link2 className="h-4 w-4" />
          </div>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste any website or video URL..."
            className="pl-11 pr-[128px] h-14 text-[14px] bg-zinc-900 border-zinc-700 rounded-2xl shadow-sm font-mono placeholder:text-zinc-500 text-white"
          />
          <Button
            type="submit"
            disabled={loading || !url.trim()}
            className="absolute right-1.5 h-11 px-6 rounded-xl font-medium bg-white text-zinc-900 hover:bg-zinc-200 shadow-sm disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? "Detecting" : "Detect"}
          </Button>
        </div>
      </form>
      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-400 font-mono bg-red-950/30 border border-red-900 rounded-xl px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] font-mono tracking-wide text-zinc-500">
        Supports YouTube, TikTok, Instagram, Vimeo, Twitter & 1000+ sites via yt-dlp
      </p>
    </div>
  );
}
