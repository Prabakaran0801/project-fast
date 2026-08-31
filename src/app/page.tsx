"use client";
import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { LinkInput } from "@/components/LinkInput";
import { VideoGrid, DetectedVideo } from "@/components/VideoGrid";
import { TransferDropzone } from "@/components/TransferDropzone";
import { Card, CardContent } from "@/components/ui/card";
import { Zap, Shield, Globe, ArrowRight, Sparkles } from "lucide-react";

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [activeTab, setActiveTab] = useState("download");
  const [downloading, setDownloading] = useState<{ quality: string; progress: number } | null>(null);
  const [expiredVideo, setExpiredVideo] = useState<string | null>(null);

  // Global cleanup on reload — deletes all expired /merged files from R2 (console logged server side)
  useEffect(() => {
    fetch("/api/cleanup", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.deleted > 0) console.log(`[cleanup] deleted ${d.deleted} expired R2 files on reload`, d);
        else console.log("[cleanup] no expired files on reload", d);
      })
      .catch((e) => console.warn("[cleanup] failed", e));
  }, []);

  useEffect(() => {
    if (!jobId) return;
    setJobStatus("PARSING");
    setJobProgress(10);
    setExpiredVideo(null);
    let completedSeen = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/job/${jobId}`);
        const data = await res.json();
        setJobStatus(data.status);
        setJobProgress(data.progress ?? 0);
        if (data.detectedUrls) setVideos(data.detectedUrls as DetectedVideo[]);
        if (data.fileUrl && downloading) setDownloading(null);
        if (data.status === "COMPLETED") completedSeen = true;
        if (data.status === "EXPIRED") {
          const title = (data.detectedUrls?.[0]?.title as string) || data.sourceUrl || "Video";
          console.log(`[expired] Job ${jobId} expired — video: "${title}" at ${new Date().toISOString()}`);
          console.warn(`EXPIRED: "${title}" was deleted after 1 min (testing). Re-paste to rebuild.`);
          setExpiredVideo(title);
          clearInterval(interval);
        }
        if (data.status === "FAILED") clearInterval(interval);
        // Keep polling after COMPLETED to detect 1 min expiry — stop after 3 min
        if (completedSeen && data.status === "COMPLETED") {
          // continue polling for expiry
        }
      } catch {}
    }, 1200);
    fetch(`/api/job/${jobId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.detectedUrls) setVideos(data.detectedUrls);
        setJobStatus(data.status);
        setJobProgress(data.progress ?? 0);
        if (data.status === "EXPIRED") {
          const title = (data.detectedUrls?.[0]?.title as string) || data.sourceUrl || "Video";
          console.log(`[expired] Job ${jobId} expired on initial fetch — video: "${title}"`);
          setExpiredVideo(title);
        }
      });
    // Safety: clear after 4 min to avoid infinite poll
    const timeout = setTimeout(() => clearInterval(interval), 4 * 60 * 1000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [jobId]);

  return (
    <div suppressHydrationWarning className="min-h-screen bg-[#09090b] text-white">
      <Header />
      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#09090b] pointer-events-none" />
          <div className="relative mx-auto max-w-[1120px] px-4 sm:px-6 pt-12 sm:pt-16 pb-8">
            <div className="text-center max-w-[720px] mx-auto">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 shadow-sm mb-5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-mono tracking-[0.14em] text-zinc-400">HIGH-SPEED ENGINE • TUS • R2 CDN</span>
                <span className="hidden sm:inline-flex ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-white text-zinc-900">v0.1 • BETA</span>
              </div>
              <h1 className="text-[34px] sm:text-[52px] font-semibold tracking-[-0.04em] leading-[0.9] text-white">
                Paste. Detect.
                <br />
                <span className="font-mono font-normal tracking-[-0.03em] text-zinc-400">Download fast.</span>
              </h1>
              <p className="mt-4 text-[15px] leading-6 text-zinc-400 max-w-[560px] mx-auto">
                Auto-detect videos from any URL. Direct CDN delivery — no bottleneck. Or send large files like WeTransfer — resumable, expiring, now with email.
              </p>
              <div className="mt-3 flex items-center justify-center gap-2 text-[11px] font-mono tracking-wide text-zinc-500">
                <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3" /> 1000+ sites</span>
                <span className="h-3 w-px bg-zinc-700" />
                <span>yt-dlp + cheerio</span>
                <span className="h-3 w-px bg-zinc-700" />
                <span>Presigned R2</span>
              </div>
            </div>

            <div className="mt-8 max-w-[760px] mx-auto">
              <div className="w-full">
                <div className="flex items-center gap-1 p-1 rounded-full bg-zinc-900 border border-zinc-800 w-fit mx-auto">
                  <button
                    onClick={() => setActiveTab("download")}
                    className={`px-4 py-2 rounded-full text-xs font-mono tracking-[0.14em] transition-colors ${activeTab === "download" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-white"}`}
                  >
                    VIDEO DETECT
                  </button>
                  <button
                    onClick={() => setActiveTab("transfer")}
                    className={`px-4 py-2 rounded-full text-xs font-mono tracking-[0.14em] transition-colors ${activeTab === "transfer" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-white"}`}
                  >
                    SEND FILES
                  </button>
                </div>
                {activeTab === "download" && (
                  <div className="mt-6">
                    <LinkInput
                      onDetect={(id) => {
                        setJobId(id);
                        setVideos([]);
                      }}
                    />
                    {(jobStatus === "PARSING" || jobStatus === "QUEUED") && (
                      <div className="mt-4 max-w-md mx-auto">
                        <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1.5">
                          <span className="flex items-center gap-1.5">{jobStatus === "PARSING" ? "Scanning page for video sources..." : "Queued — waiting for parser..."} <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" /></span>
                          <span>{jobProgress}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden relative">
                          <div className="h-full bg-white rounded-full transition-all duration-700 ease-out relative overflow-hidden" style={{ width: `${Math.max(8, jobProgress)}%` }}>
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1.2s_infinite]" />
                          </div>
                        </div>
                      </div>
                    )}
                    {downloading && (
                      <div className="mt-4 max-w-md mx-auto">
                        <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1.5">
                          <span className="flex items-center gap-1.5">
                            {downloading.progress < 85 ? `Merging ${downloading.quality} with audio...` : `Uploading to R2...`} <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          </span>
                          <span>{downloading.progress}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden relative">
                          <div className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out relative overflow-hidden" style={{ width: `${downloading.progress}%` }}>
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1.2s_infinite]" />
                          </div>
                        </div>
                        <p className="text-[11px] font-mono text-zinc-500 mt-1 text-center">
                          {downloading.progress < 30 ? "Downloading video..." : downloading.progress < 60 ? "Downloading audio + merging with ffmpeg..." : downloading.progress < 85 ? "Finalizing merge..." : "Uploading to R2 (fast CDN)..."}
                        </p>
                      </div>
                    )}
                    <VideoGrid
                      videos={videos}
                      jobId={jobId}
                      onDownload={async (v) => {
                        if (!jobId) return;
                        const jobRes = await fetch(`/api/job/${jobId}`).then((r) => r.json()).catch(() => null);
                        const sourceUrl = jobRes?.sourceUrl || "";
                        const title = (jobRes?.detectedUrls?.[0]?.title as string) || sourceUrl.split("/").pop()?.slice(0, 30) || "video";
                        const height = v.height || parseInt(v.quality) || undefined;
                        const shouldMerge = v.needsMerge; // any video-only needs audio merge, not just >720p
                        if (shouldMerge) {
                          setDownloading({ quality: v.quality, progress: 10 });
                          const res = await fetch("/api/download", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ jobId, formatUrl: v.url, height, sourceUrl, needsMerge: true }),
                          });
                          await res.json();
                          let tries = 0;
                          const poll = setInterval(async () => {
                            tries++;
                            const j = await fetch(`/api/job/${jobId}`).then((r) => r.json());
                            if (j.progress) setDownloading({ quality: v.quality, progress: j.progress });
                            const fileUrl = j.fileUrl;
                            if (fileUrl && j.status === "COMPLETED" && fileUrl !== v.url) {
                              clearInterval(poll);
                              setDownloading(null);
                              const a = document.createElement("a");
                              a.href = fileUrl;
                              a.download = "";
                              a.target = "_blank";
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                            }
                            if (tries > 50 || j.status === "FAILED") {
                              clearInterval(poll);
                              setDownloading(null);
                            }
                          }, 2500);
                          return;
                        }
                        setDownloading({ quality: v.quality, progress: 50 });
                        console.log(`[download] Hybrid 302 — direct muxed ${v.quality} -> ${v.url.slice(0, 80)} (Cloudflare Cache 1h, no R2)`);
                        await fetch("/api/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, formatUrl: v.url, height, sourceUrl, needsMerge: v.needsMerge }) });
                        // Hybrid: direct redirect to googlevideo via 302 (proxy now 302) — fast + free, no R2
                        const directUrl = v.url;
                        console.log(`[download] Triggering 302 download for ${v.quality}: ${directUrl.slice(0, 100)}`);
                        setTimeout(() => {
                          setDownloading(null);
                          // Use direct URL for fastest path (Cloudflare caches googlevideo); proxy 302 also works: `/api/download/proxy?url=...`
                          const a = document.createElement("a");
                          a.href = directUrl;
                          a.target = "_blank";
                          a.rel = "noopener";
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          console.log(`[download] Started ${v.quality} download`);
                        }, 300);
                      }}
                    />
                    {videos.length === 0 && jobStatus === "COMPLETED" && (
                      <p className="mt-6 text-center text-sm font-mono text-zinc-500">No videos detected. Try a direct video URL.</p>
                    )}
                    {jobStatus === "EXPIRED" && (
                      <div className="mt-6 rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4 text-center">
                        <p className="text-sm font-mono text-amber-400">Video expired — “{expiredVideo || "this video"}” was deleted after 1 min (testing). Re-paste to rebuild.</p>
                        <button onClick={() => { setJobId(null); setVideos([]); setJobStatus(null); setExpiredVideo(null); }} className="mt-3 h-8 px-4 rounded-full bg-amber-500 text-zinc-900 text-xs font-medium">Re-parse</button>
                      </div>
                    )}
                  </div>
                )}
                {activeTab === "transfer" && (
                  <div className="mt-6">
                    <TransferDropzone />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1120px] px-4 sm:px-6 pb-14">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="group bg-[#121214] border-zinc-800 rounded-2xl shadow-sm hover:border-zinc-700 transition-all">
              <CardContent className="p-6">
                <div className="h-10 w-10 rounded-xl bg-white text-zinc-900 grid place-items-center mb-4">
                  <Globe className="h-[18px] w-[18px]" />
                </div>
                <h3 className="font-semibold text-[14px] tracking-[-0.01em] text-white">Auto-Detect any URL</h3>
                <p className="text-[13px] text-zinc-400 mt-1.5 leading-5">Paste a page link — we crawl with cheerio + yt-dlp and list every playable source with quality.</p>
                <span className="inline-flex items-center gap-1 text-xs font-mono mt-4 text-white group-hover:gap-1.5 transition-all">
                  1000+ sites <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
            <Card className="group bg-[#121214] border-zinc-800 rounded-2xl shadow-sm hover:border-zinc-700 transition-all">
              <CardContent className="p-6">
                <div className="h-10 w-10 rounded-xl bg-white text-zinc-900 grid place-items-center mb-4">
                  <Zap className="h-[18px] w-[18px]" />
                </div>
                <h3 className="font-semibold text-[14px] tracking-[-0.01em] text-white">Direct Download</h3>
                <p className="text-[13px] text-zinc-400 mt-1.5 leading-5">High-speed CDN redirect. No server bottleneck — your file streams straight from R2/S3.</p>
                <span className="inline-flex items-center gap-1 text-xs font-mono mt-4 text-white group-hover:gap-1.5 transition-all">
                  302 CDN <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
            <Card className="group bg-[#121214] border-zinc-800 rounded-2xl shadow-sm hover:border-zinc-700 transition-all">
              <CardContent className="p-6">
                <div className="h-10 w-10 rounded-xl bg-white text-zinc-900 grid place-items-center mb-4">
                  <Shield className="h-[18px] w-[18px]" />
                </div>
                <h3 className="font-semibold text-[14px] tracking-[-0.01em] text-white">Send + Email</h3>
                <p className="text-[13px] text-zinc-400 mt-1.5 leading-5">Resumable TUS uploads, shareable link expires in 7 days. New: email link directly via SMTP.</p>
                <span className="inline-flex items-center gap-1 text-xs font-mono mt-4 text-white group-hover:gap-1.5 transition-all">
                  5GB • TUS • SMTP <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-900/40">
            <p className="text-xs font-mono text-zinc-400 text-center sm:text-left">
              <span className="text-white font-medium">No secrets in frontend.</span> All keys server-only • Rate limited • SSRF protected • Free DB: Supabase
            </p>
            <div className="flex items-center gap-2 text-[11px] font-mono tracking-[0.14em] text-zinc-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> SYSTEM OPERATIONAL
            </div>
          </div>
        </section>
      </main>

      {expiredVideo && jobStatus === "EXPIRED" && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm grid place-items-center z-50 p-4" onClick={() => setExpiredVideo(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-[#121214] border border-zinc-800 p-6 text-center shadow-xl">
            <div className="mx-auto w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 grid place-items-center mb-3">⏰</div>
            <h3 className="text-sm font-semibold text-white">Video expired</h3>
            <p className="text-xs font-mono text-zinc-400 mt-1 break-all">“{expiredVideo}” was deleted after 1 min (testing mode).</p>
            <p className="text-[11px] font-mono text-zinc-500 mt-2">R2 object expired + DB status EXPIRED. Re-paste the link to rebuild.</p>
            <div className="flex gap-2 justify-center mt-4">
              <button onClick={() => setExpiredVideo(null)} className="h-8 px-4 rounded-full bg-zinc-800 text-white text-xs font-medium border border-zinc-700">Close</button>
              <button onClick={() => { setExpiredVideo(null); setJobId(null); setVideos([]); setJobStatus(null); }} className="h-8 px-4 rounded-full bg-white text-zinc-900 text-xs font-medium">Re-parse</button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-zinc-800 py-6">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-zinc-500">
          <span>© 2026 SPEEDDL — Minimalist developer tool. Next.js + Supabase + R2 + Nodemailer.</span>
          <span className="flex items-center gap-2">
            <span className="px-2 py-1 rounded-full bg-white text-zinc-900 text-[11px]">v0.1.0-beta</span>
            <span>Free tier ready</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
