"use client";
import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { LinkInput } from "@/components/LinkInput";
import { VideoGrid, DetectedVideo } from "@/components/VideoGrid";
import { TransferDropzone } from "@/components/TransferDropzone";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap, Shield, Gauge, Globe, ArrowRight, Loader2 } from "lucide-react";

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [jobStatus, setJobStatus] = useState<string | null>(null);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    setJobStatus("PARSING");
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/job/${jobId}`);
        const data = await res.json();
        setJobStatus(data.status);
        if (data.detectedUrls) setVideos(data.detectedUrls as DetectedVideo[]);
        if (data.status === "COMPLETED" || data.status === "FAILED") clearInterval(interval);
      } catch {}
    }, 1500);
    // Initial fetch
    fetch(`/api/job/${jobId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.detectedUrls) setVideos(data.detectedUrls);
        setJobStatus(data.status);
      });
    return () => clearInterval(interval);
  }, [jobId]);

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#09090b]">
      <Header />
      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-8">
          <div className="text-center max-w-3xl mx-auto">
            <Badge variant="secondary" className="font-mono text-[11px] tracking-widest mb-4 px-3 py-1 rounded-full">
              <Gauge className="h-3 w-3 mr-1.5" /> HIGH-SPEED ENGINE • TUS RESUMABLE • R2 CDN
            </Badge>
            <h1 className="text-[32px] sm:text-[48px] font-semibold tracking-tight leading-[0.95] text-zinc-900 dark:text-white">
              Paste. Detect.
              <br />
              <span className="font-mono font-normal text-zinc-500">Download fast.</span>
            </h1>
            <p className="mt-4 text-[15px] leading-6 text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
              Auto-detect videos from any URL. Direct high-speed delivery via CDN. Or send large files like WeTransfer — resumable, expiring links.
            </p>
          </div>

          <div className="mt-10">
            <Tabs defaultValue="download" className="max-w-3xl mx-auto">
              <TabsList className="grid w-full grid-cols-2 max-w-sm mx-auto rounded-xl bg-zinc-100 dark:bg-zinc-900 p-1 h-11">
                <TabsTrigger value="download" className="rounded-lg font-mono text-xs tracking-widest data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800">
                  VIDEO DETECT
                </TabsTrigger>
                <TabsTrigger value="transfer" className="rounded-lg font-mono text-xs tracking-widest data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-800">
                  SEND FILES
                </TabsTrigger>
              </TabsList>
              <TabsContent value="download" className="mt-6">
                <LinkInput
                  onDetect={(id) => {
                    setJobId(id);
                    setVideos([]);
                  }}
                />
                {jobStatus === "PARSING" && (
                  <div className="mt-6 flex items-center justify-center gap-2 text-sm font-mono text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Scanning page for video sources...
                  </div>
                )}
                {jobStatus === "QUEUED" && (
                  <div className="mt-6 flex items-center justify-center gap-2 text-sm font-mono text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Queued — waiting for parser...
                  </div>
                )}
                <VideoGrid
                  videos={videos}
                  onDownload={async (v) => {
                    if (!jobId) return;
                    await fetch("/api/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, formatUrl: v.url }) });
                    window.open(v.url, "_blank");
                  }}
                />
                {videos.length === 0 && jobStatus === "COMPLETED" && (
                  <p className="mt-6 text-center text-sm font-mono text-zinc-500">No videos detected. Try a direct video URL.</p>
                )}
              </TabsContent>
              <TabsContent value="transfer" className="mt-6">
                <TransferDropzone />
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {/* Features bento */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl">
              <CardContent className="p-6">
                <div className="h-9 w-9 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 grid place-items-center mb-3">
                  <Globe className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">Auto-Detect any URL</h3>
                <p className="text-sm text-zinc-500 mt-1 leading-5">Paste a page link — we crawl with cheerio + yt-dlp and list every playable source.</p>
                <span className="inline-flex items-center gap-1 text-xs font-mono mt-3 text-zinc-900 dark:text-white">
                  1000+ sites <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl">
              <CardContent className="p-6">
                <div className="h-9 w-9 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 grid place-items-center mb-3">
                  <Zap className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">Direct Download</h3>
                <p className="text-sm text-zinc-500 mt-1 leading-5">High-speed CDN redirect. No server bottleneck — your file comes straight from R2/S3.</p>
                <span className="inline-flex items-center gap-1 text-xs font-mono mt-3 text-zinc-900 dark:text-white">
                  302 CDN <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-2xl">
              <CardContent className="p-6">
                <div className="h-9 w-9 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 grid place-items-center mb-3">
                  <Shield className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">WeTransfer-style Send</h3>
                <p className="text-sm text-zinc-500 mt-1 leading-5">Resumable TUS uploads. Shareable link expires in 7 days. No account needed.</p>
                <span className="inline-flex items-center gap-1 text-xs font-mono mt-3 text-zinc-900 dark:text-white">
                  5GB • TUS <ArrowRight className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white/50 dark:bg-zinc-900/50">
            <p className="text-xs font-mono text-zinc-500 text-center sm:text-left">
              <span className="text-zinc-900 dark:text-white font-medium">No secrets in frontend.</span> All keys server-only • Rate limited • SSRF protected • Free DB: Supabase
            </p>
            <div className="flex items-center gap-2 text-[11px] font-mono tracking-widest text-zinc-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> SYSTEM OPERATIONAL
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-zinc-500">
          <span>© 2026 SPEEDDL — Minimalist developer tool. Built with Next.js + Supabase + R2.</span>
          <span className="flex items-center gap-2">
            <span className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">v0.1.0-beta</span>
            <span>Free tier ready</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

// Minimal Tabs component inline to avoid extra deps
function Tabs({ defaultValue, className, children }: { defaultValue: string; className?: string; children: React.ReactNode }) {
  const [active, setActive] = useState(defaultValue);
  return <div className={className} data-active={active}>{Array.isArray(children) ? children.map((child: any) => {
    if (child?.props?.value) {
      const isActive = child.props.value === active;
      if (child.type?.displayName === "TabsList") {
        return (
          <div key="list" className={child.props.className}>
            {Array.isArray(child.props.children) ? child.props.children.map((trigger: any) => (
              <button
                key={trigger.props.value}
                onClick={() => setActive(trigger.props.value)}
                className={`${trigger.props.className} ${trigger.props.value === active ? "bg-white dark:bg-zinc-800 shadow-sm" : ""}`}
              >
                {trigger.props.children}
              </button>
            )) : null}
          </div>
        );
      }
      if (child.props.value && !isActive) return null;
      return <div key={child.props.value}>{child.props.children}</div>;
    }
    return child;
  }) : children}</div>;
}
function TabsList({ className, children }: { className?: string; children: React.ReactNode }) { return <div className={className}>{children}</div>; }
function TabsTrigger({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) { return <button data-value={value} className={className}>{children}</button>; }
function TabsContent({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) { return <div data-value={value} className={className}>{children}</div>; }
