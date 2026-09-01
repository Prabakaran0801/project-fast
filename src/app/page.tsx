"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { LinkInput } from "@/components/LinkInput";
import { VideoGrid, DetectedVideo } from "@/components/VideoGrid";
import { TransferDropzone } from "@/components/TransferDropzone";
import { pushJob } from "@/lib/offline-history";
import { InstallPrompt } from "@/components/InstallPrompt";

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [activeTab, setActiveTab] = useState("download");
  const [downloading, setDownloading] = useState<{
    quality: string;
    progress: number;
  } | null>(null);
  const [expiredVideo, setExpiredVideo] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Global cleanup on reload — deletes all expired /merged files from R2 (console logged server side)
  useEffect(() => {
    fetch("/api/cleanup", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.deleted > 0)
          console.log(
            `[cleanup] deleted ${d.deleted} expired R2 files on reload`,
            d,
          );
        else console.log("[cleanup] no expired files on reload", d);
      })
      .catch((e) => console.warn("[cleanup] failed", e));
  }, []);

  // Offline cache: persist completed jobs for history PWA
  useEffect(() => {
    if (!jobId || jobStatus !== "COMPLETED" || !videos.length) return;
    try {
      const first = videos[0] as any;
      pushJob({
        id: jobId,
        sourceUrl: first?.title || jobId,
        status: "COMPLETED",
        createdAt: new Date().toISOString(),
        thumbnail: first?.thumbnail,
      });
    } catch {}
  }, [jobStatus, jobId, videos]);

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
          const title =
            (data.detectedUrls?.[0]?.title as string) ||
            data.sourceUrl ||
            "Video";
          console.log(
            `[expired] Job ${jobId} expired — video: "${title}" at ${new Date().toISOString()}`,
          );
          console.warn(
            `EXPIRED: "${title}" was deleted after 1 min (testing). Re-paste to rebuild.`,
          );
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
          const title =
            (data.detectedUrls?.[0]?.title as string) ||
            data.sourceUrl ||
            "Video";
          console.log(
            `[expired] Job ${jobId} expired on initial fetch — video: "${title}"`,
          );
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
    <div
      suppressHydrationWarning
      className="min-h-screen bg-[#09090b] text-white flex flex-col"
    >
      <Header />
      <main className="flex-1 flex flex-col">
        <section className="relative overflow-hidden flex flex-col items-center">
          <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#09090b] pointer-events-none" />
          <div className="relative w-full mx-auto max-w-[1120px] px-4 sm:px-6 pt-12 sm:pt-16 pb-8 flex flex-col items-center">
            <div className="flex flex-col items-center text-center max-w-[720px] w-full mx-auto">
              <h1 className="text-[34px] sm:text-[52px] font-semibold tracking-[-0.04em] leading-[0.9] text-white text-center">
                Paste. Detect.
                <br />
                <span className="font-mono font-normal tracking-[-0.03em] text-zinc-400">
                  Download fast.
                </span>
              </h1>
              <p className="mt-4 text-[15px] leading-6 text-zinc-400 max-w-[560px] mx-auto text-center">
                Auto-detect videos from any URL. Direct CDN delivery — no
                bottleneck. Or send large files like MailTransfer — resumable,
                expiring, now with email.
              </p>
            </div>

            <div className="mt-8 w-full max-w-[760px] flex flex-col items-center">
              <div className="w-full flex flex-col items-center">
                <div
                  className="flex items-center justify-center gap-1 p-1 rounded-full bg-zinc-900 border border-zinc-800 w-fit"
                  role="tablist"
                  aria-label="Mode"
                >
                  <button
                    role="tab"
                    aria-selected={activeTab === "download"}
                    onClick={() => setActiveTab("download")}
                    className={`px-4 py-2 rounded-full text-xs font-mono tracking-[0.14em] transition-colors duration-150 min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${activeTab === "download" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-white"}`}
                  >
                    VIDEO DETECT
                  </button>
                  <button
                    role="tab"
                    aria-selected={activeTab === "transfer"}
                    onClick={() => setActiveTab("transfer")}
                    className={`px-4 py-2 rounded-full text-xs font-mono tracking-[0.14em] transition-colors duration-150 min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${activeTab === "transfer" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-white"}`}
                  >
                    SEND FILES
                  </button>
                </div>
                {activeTab === "download" && (
                  <div className="mt-6 w-full flex flex-col items-center">
                    <div className="w-full">
                      <LinkInput
                        onDetect={(id) => {
                          setJobId(id);
                          setVideos([]);
                          setParseError(null);
                        }}
                      />
                    </div>
                    <AnimatePresence>
                      {(jobStatus === "PARSING" || jobStatus === "QUEUED") && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="mt-4 w-full max-w-md"
                        >
                          <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1.5">
                            <span
                              className="flex items-center gap-1.5"
                              aria-live="polite"
                            >
                              {jobStatus === "PARSING"
                                ? "Scanning page for video sources..."
                                : "Queued — waiting for parser..."}{" "}
                              <span
                                className="inline-block h-2 w-2 rounded-full bg-white animate-pulse"
                                aria-hidden
                              />
                            </span>
                            <span>{jobProgress}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden relative">
                            <motion.div
                              className="h-full bg-white rounded-full relative overflow-hidden will-change-transform"
                              initial={{ width: "8%" }}
                              animate={{
                                width: `${Math.max(8, jobProgress)}%`,
                              }}
                              transition={{ duration: 0.7, ease: "easeOut" }}
                            >
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1.2s_infinite]" />
                            </motion.div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <AnimatePresence>
                      {downloading && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="mt-4 w-full max-w-md"
                        >
                          <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1.5">
                            <span
                              className="flex items-center gap-1.5"
                              aria-live="polite"
                            >
                              {downloading.progress < 85
                                ? `Merging ${downloading.quality} with audio...`
                                : `Uploading to R2...`}{" "}
                              <span
                                className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
                                aria-hidden
                              />
                            </span>
                            <span>{downloading.progress}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden relative">
                            <motion.div
                              className="h-full bg-emerald-500 rounded-full relative overflow-hidden will-change-transform"
                              animate={{ width: `${downloading.progress}%` }}
                              transition={{ duration: 0.7, ease: "easeOut" }}
                            >
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1.2s_infinite]" />
                            </motion.div>
                          </div>
                          <p className="text-[11px] font-mono text-zinc-500 mt-1 text-center">
                            {downloading.progress < 30
                              ? "Downloading video..."
                              : downloading.progress < 60
                                ? "Downloading audio + merging with ffmpeg..."
                                : downloading.progress < 85
                                  ? "Finalizing merge..."
                                  : "Uploading to R2 (fast CDN)..."}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <VideoGrid
                      videos={videos}
                      jobId={jobId}
                      onDownload={async (v) => {
                        if (!jobId) return;
                        if ((v as any)._failed) {
                          const err = (v as any).error || "";
                          if (err === "youtube_blocked") {
                            setParseError("YouTube blocked (datacenter IP). Fix: Save Netscape cookies to cookies.txt in project root (or set YTDLP_COOKIES in .env) → restart npm run dev. Or use piped fallback (auto). Check terminal for [processJob] yt-dlp (android) failed reason. Try: 1) https://test-videos.co.uk/vids/sintel/trailer.mp4 2) Different YouTube video");
                            return;
                          }
                          if (err === "blocked_or_unsupported") {
                            setParseError("This site is blocking downloads (missav/pornhub 403 or yt-dlp unsupported). Free fix: yt-dlp will auto-update on next deploy (Docker -U). Retrying will not help until deploy. Try: 1) Direct mp4 link https://test-videos.co.uk/vids/sintel/trailer.mp4 2) YouTube link 3) For missav/pornhub, check Render logs for [parse] yt-dlp (generic) failed - we now mark FAILED correctly, not fake COMPLETED.");
                            return;
                          }
                          setParseError("No downloadable formats found for this video. Try: 1) Direct mp4 link https://test-videos.co.uk/vids/sintel/trailer.mp4 (always works) 2) Different YouTube video (Shorts/live may require cookies) 3) Check terminal for [processJob] yt-dlp … failed reason.");
                          return;
                        }
                        const jobRes = await fetch(`/api/job/${jobId}`)
                          .then((r) => r.json())
                          .catch(() => null);
                        const sourceUrl = jobRes?.sourceUrl || "";
                        const title =
                          (jobRes?.detectedUrls?.[0]?.title as string) ||
                          sourceUrl.split("/").pop()?.slice(0, 30) ||
                          "video";
                        const height =
                          v.height || parseInt(v.quality) || undefined;
                        const shouldMerge = v.needsMerge; // any video-only needs audio merge, not just >720p
                        if (shouldMerge) {
                          setDownloading({ quality: v.quality, progress: 10 });
                          const res = await fetch("/api/download", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              jobId,
                              formatUrl: v.url,
                              height,
                              sourceUrl,
                              needsMerge: true,
                            }),
                          });
                          await res.json();
                          let tries = 0;
                          // Live poll every 800ms (was 2500ms dummy) – shows real backend 25→35→70→85→100
                          const poll = setInterval(async () => {
                            tries++;
                            const j = await fetch(`/api/job/${jobId}`).then((r) => r.json());
                            if (j.progress) setDownloading({ quality: v.quality, progress: j.progress });
                            const fileUrl = j.fileUrl;
                            if (fileUrl && j.status === "COMPLETED" && fileUrl !== v.url) {
                              clearInterval(poll);
                              // Real download with progress for merged R2 file too
                              try {
                                const resp = await fetch(fileUrl);
                                if (!resp.ok || !resp.body) throw new Error("fetch failed");
                                const total = Number(resp.headers.get("content-length") || 0);
                                const reader = resp.body.getReader();
                                let received = 0;
                                const chunks: Uint8Array[] = [];
                                while (true) {
                                  const { done, value } = await reader.read();
                                  if (done) break;
                                  if (value) {
                                    chunks.push(value);
                                    received += value.length;
                                    if (total) {
                                      const pct = Math.min(95, 85 + Math.round((received / total) * 10));
                                      setDownloading({ quality: v.quality, progress: pct });
                                    }
                                  }
                                }
                                const blob = new Blob(chunks as any);
                                const blobUrl = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = blobUrl;
                                a.download = `${title}.mp4`;
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                              } catch {
                                const a = document.createElement("a");
                                a.href = fileUrl;
                                a.download = "";
                                a.target = "_blank";
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                              }
                              setDownloading(null);
                            }
                            if (tries > 120 || j.status === "FAILED") {
                              clearInterval(poll);
                              setDownloading(null);
                            }
                          }, 800);
                          return;
                        }
                        // Direct muxed – YouTube/googlevideo must use anchor (CORS blocks fetch), proxy/twitter can use real fetch progress
                        setDownloading({ quality: v.quality, progress: 5 });
                        console.log(`[download] Direct muxed ${v.quality} -> ${v.url.slice(0, 80)}`);
                        await fetch("/api/download", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ jobId, formatUrl: v.url, height, sourceUrl, needsMerge: v.needsMerge }),
                        });
                        const needsProxy = /video\.twimg\.com|twimg\.com|fbcdn\.net/.test(v.url);
                        const directUrl = needsProxy ? `/api/download/proxy?url=${encodeURIComponent(v.url)}` : v.url;
                        const isGoogleVideo = /googlevideo\.com/.test(v.url);
                        // googlevideo has no CORS – use anchor 302 (instant), proxy has CORS via same-origin so real progress works
                        if (isGoogleVideo && !needsProxy) {
                          console.log(`[download] Triggering anchor for ${v.quality}: ${directUrl.slice(0, 100)}`);
                          setDownloading({ quality: v.quality, progress: 50 });
                          setTimeout(() => {
                            setDownloading(null);
                            const a = document.createElement("a");
                            a.href = directUrl;
                            a.target = "_blank";
                            a.rel = "noopener";
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            console.log(`[download] Started ${v.quality} download`);
                          }, 300);
                          return;
                        }
                        console.log(`[download] Fetching ${needsProxy ? "proxy stream" : "direct"} ${v.quality}: ${directUrl.slice(0, 100)}`);
                        try {
                          const resp = await fetch(directUrl);
                          if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
                          const total = Number(resp.headers.get("content-length") || 0);
                          const reader = resp.body.getReader();
                          let received = 0;
                          const chunks: Uint8Array[] = [];
                          while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value) {
                              chunks.push(value);
                              received += value.length;
                              if (total) {
                                const pct = Math.min(96, Math.round((received / total) * 100));
                                setDownloading({ quality: v.quality, progress: pct });
                              } else {
                                setDownloading({ quality: v.quality, progress: Math.min(85, 5 + Math.floor(received / 50000)) });
                              }
                            }
                          }
                          const blob = new Blob(chunks as any, { type: resp.headers.get("content-type") || "video/mp4" });
                          const blobUrl = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = blobUrl;
                          a.download = `${title}.mp4`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                          setDownloading(null);
                          console.log(`[download] Done ${v.quality} ${received} bytes`);
                        } catch (e) {
                          console.warn("[download] fetch progress failed, fallback to anchor", e);
                          setDownloading(null);
                          const a = document.createElement("a");
                          a.href = directUrl;
                          a.target = "_blank";
                          a.rel = "noopener";
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }
                      }}
                    />
                    <div className="w-full">
                      {parseError && (
                        <div className="mt-6 rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4 text-left">
                          <p className="text-sm font-medium text-amber-400">{typeof window !== "undefined" && window.location.hostname === "localhost" ? "Could not extract formats" : "YouTube blocked on Vercel Hobby"}</p>
                          <p className="text-xs font-mono text-amber-200/80 mt-1">{parseError}</p>
                          <p className="text-xs font-mono text-zinc-400 mt-3">Fix 1 — Quick demo: paste <button onClick={() => navigator.clipboard.writeText("https://test-videos.co.uk/vids/sintel/trailer.mp4")} className="underline">test mp4</button> • Works with preview + download.</p>
                          <p className="text-xs font-mono text-zinc-400 mt-1">Fix 2 — YouTube: {typeof window !== "undefined" && window.location.hostname === "localhost" ? "Save the Netscape cookies to cookies.txt in project root (or set YTDLP_COOKIES in .env) → restart npm run dev. Check terminal for [processJob] yt-dlp ... failed." : <>Install &ldquo;Get cookies.txt LOCALLY&rdquo; → Export youtube.com → copy content → Vercel Dashboard → Env → <code className="px-1 py-0.5 bg-zinc-800 rounded">YTDLP_COOKIES</code> → paste → Redeploy. Or use Fly.io worker — different IP, no cookies needed.</>}</p>
                          <button onClick={() => setParseError(null)} className="mt-3 h-8 px-4 rounded-full bg-zinc-800 text-white text-xs border border-zinc-700">Dismiss</button>
                        </div>
                      )}
                      {videos.length === 0 && jobStatus === "COMPLETED" && !parseError && (
                        <p className="mt-6 text-center text-sm font-mono text-zinc-500">
                          No videos detected. Try a direct video URL.
                        </p>
                      )}
                      {jobStatus === "EXPIRED" && (
                        <div className="mt-6 w-full rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4 text-center">
                          <p className="text-sm font-mono text-amber-400">
                            Video expired — “{expiredVideo || "this video"}” was
                            deleted after 30 min. Re-paste to rebuild.
                          </p>
                          <button
                            onClick={() => {
                              setJobId(null);
                              setVideos([]);
                              setJobStatus(null);
                              setExpiredVideo(null);
                            }}
                            className="mt-3 h-8 px-4 rounded-full bg-amber-500 text-zinc-900 text-xs font-medium"
                          >
                            Re-parse
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {activeTab === "transfer" && (
                  <div className="mt-6 w-full">
                    <TransferDropzone />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {expiredVideo && jobStatus === "EXPIRED" && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm grid place-items-center z-50 p-4"
          onClick={() => setExpiredVideo(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#121214] border border-zinc-800 p-6 text-center shadow-xl"
          >
            <div className="mx-auto w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 grid place-items-center mb-3">
              ⏰
            </div>
            <h3 className="text-sm font-semibold text-white">Video expired</h3>
            <p className="text-xs font-mono text-zinc-400 mt-1 break-all">
              “{expiredVideo}” was deleted after 30 min.
            </p>
            <p className="text-[11px] font-mono text-zinc-500 mt-2">
              R2 object expired + DB status EXPIRED. Re-paste the link to
              rebuild.
            </p>
            <div className="flex gap-2 justify-center mt-4">
              <button
                onClick={() => setExpiredVideo(null)}
                className="h-8 px-4 rounded-full bg-zinc-800 text-white text-xs font-medium border border-zinc-700"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setExpiredVideo(null);
                  setJobId(null);
                  setVideos([]);
                  setJobStatus(null);
                }}
                className="h-8 px-4 rounded-full bg-white text-zinc-900 text-xs font-medium"
              >
                Re-parse
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-zinc-800 py-6 mt-auto pb-safe">
        <div className="mx-auto max-w-[1120px] px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-zinc-500">
          <span className="text-center text-white sm:text-left">
            © 2026 MEDIAMOVER • PWA ready for Mobile and Desktop •{" "}
          </span>
          <span className="flex items-center justify-center gap-2 shrink-0">
            <span className="px-2 py-1  text-white text-[11px]">
              Terms & conditions
            </span>
          </span>
        </div>
      </footer>
      <InstallPrompt />
    </div>
  );
}
