"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Link2, Loader2, AlertCircle } from "lucide-react";

export function LinkInput({ onDetect }: { onDetect: (jobId: string, url: string) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function extractUrl(raw: string): string {
    let s = raw.trim();
    const srcMatch = s.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) s = srcMatch[1].trim();
    if (s.startsWith("//")) s = "https:" + s;
    if (s.includes("<") || s.includes('"') || (!s.startsWith("http") && s.includes("http"))) {
      const m = s.match(/https?:\/\/[^"'<>\s]+/);
      if (m) s = m[0];
    }
    s = s.replace(/&amp;/g, "&");
    try {
      const u = new URL(s);
      const embed = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (embed) return `https://www.youtube.com/watch?v=${embed[1]}`;
    } catch {}
    return s;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    const cleaned = extractUrl(url);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse");
      onDetect(data.jobId, cleaned);
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
            placeholder="Paste video URL or iframe embed code..."
            aria-label="Video URL"
            className="pl-11 pr-[128px] h-14 text-[14px] bg-zinc-900 border-zinc-700 rounded-2xl shadow-sm font-mono placeholder:text-zinc-500 text-white focus-visible:ring-2 focus-visible:ring-white/20"
          />
          <motion.div className="absolute right-1.5" whileTap={{ scale: 0.98 }} transition={{ duration: 0.15, ease: "easeOut" }}>
            <Button
              type="submit"
              disabled={loading || !url.trim()}
              className="h-11 px-6 rounded-xl font-medium bg-white text-zinc-900 hover:bg-zinc-200 shadow-sm disabled:opacity-50 motion-safe"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? "Detecting" : "Detect"}
            </Button>
          </motion.div>
        </div>
      </form>
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="mt-3 flex items-center gap-2 text-sm text-red-400 font-mono bg-red-950/30 border border-red-900 rounded-xl px-3 py-2"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </motion.div>
        )}
      </AnimatePresence>
      <p className="mt-3 text-center text-[11px] font-mono tracking-wide text-zinc-500">
        Supports YouTube, TikTok, Instagram, Vimeo, Twitter & 1000+ sites via yt-dlp
      </p>
    </div>
  );
}
