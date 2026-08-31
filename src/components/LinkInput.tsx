"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Link2, Loader2, Terminal } from "lucide-react";

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
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="relative group">
        <div className="relative flex items-center">
          <div className="absolute left-4 text-zinc-400">
            <Link2 className="h-4 w-4" />
          </div>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste any website or video URL..."
            className="pl-11 pr-32 h-14 text-[15px] bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm focus-visible:ring-zinc-900 font-mono"
          />
          <Button
            type="submit"
            disabled={loading || !url.trim()}
            className="absolute right-1.5 h-11 px-6 rounded-xl font-medium"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? "Detecting" : "Detect"}
          </Button>
        </div>
      </form>
      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400 font-mono flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5" /> {error}
        </p>
      )}
      <p className="mt-3 text-center text-xs text-zinc-500 font-mono">
        Supports YouTube, TikTok, Instagram, Vimeo, Twitter & 1000+ sites via yt-dlp
      </p>
    </div>
  );
}
