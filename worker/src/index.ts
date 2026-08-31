import { Worker } from "bullmq";
import IORedis from "ioredis";
import * as cheerio from "cheerio";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const connection = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null }) : undefined;

if (!connection) {
  console.log("[worker] No REDIS_URL — worker idle. API will use mock mode. Set REDIS_URL to enable real queue.");
  process.exit(0);
}

console.log("[worker] Starting workers...");

// Parser worker: cheerio + yt-dlp (mocked if yt-dlp not installed)
const parseWorker = new Worker(
  "parse-queue",
  async (job) => {
    const { jobId, url } = job.data as { jobId: string; url: string };
    console.log(`[parse] ${jobId} -> ${url}`);
    await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "PARSING", progress: 10 } });

    try {
      // Try to fetch page and extract videos via cheerio
      let detected: any[] = [];
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
        const html = await res.text();
        const $ = cheerio.load(html);
        $("video source, video, meta[property='og:video']").each((_, el) => {
          const src = $(el).attr("src") || $(el).attr("content") || $(el).attr("srcset");
          if (src) {
            try {
              const abs = new URL(src, url).toString();
              detected.push({ url: abs, quality: "auto", ext: abs.split(".").pop()?.split("?")[0] || "mp4", thumbnail: "" });
            } catch {}
          }
        });
        // Also find m3u8 links
        const m3u8Matches = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
        if (m3u8Matches) m3u8Matches.forEach((m) => detected.push({ url: m, quality: "HLS", ext: "m3u8" }));
      } catch (e) {
        console.warn("[parse] cheerio crawl failed", e);
      }

      // Fallback: if cheerio found nothing, use yt-dlp-exec if available (lazy import to avoid hard dep)
      if (detected.length === 0) {
        try {
          // @ts-ignore - optional dep
          const { execa } = await import("execa");
          const { stdout } = await execa("yt-dlp", ["--dump-json", "--no-playlist", url], { timeout: 15000 });
          const info = JSON.parse(stdout);
          const formats = (info.formats || []).slice(-3).map((f: any) => ({
            url: f.url,
            quality: f.height ? `${f.height}p` : f.format_id,
            ext: f.ext,
            size: f.filesize ? `${(f.filesize / 1024 / 1024).toFixed(1)} MB` : undefined,
          }));
          detected = formats.length ? formats : [{ url: info.url || url, quality: "best", ext: info.ext || "mp4" }];
        } catch {
          // yt-dlp not available — keep cheerio results or mock
          if (detected.length === 0) detected = [{ url, quality: "auto", ext: "mp4" }];
        }
      }

      await prisma.downloadJob.update({
        where: { id: jobId },
        data: { detectedUrls: detected, status: "COMPLETED", progress: 100 },
      });
      console.log(`[parse] ${jobId} completed with ${detected.length} sources`);
    } catch (err) {
      console.error(`[parse] ${jobId} failed`, err);
      await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "FAILED" } });
      throw err;
    }
  },
  { connection, concurrency: 3 }
);

const downloadWorker = new Worker(
  "download-queue",
  async (job) => {
    const { jobId, url } = job.data;
    console.log(`[download] ${jobId} -> ${url}`);
    // In production: stream url -> S3/R2 via @aws-sdk/client-s3 PutObject, then save presigned URL
    // MVP: just mark completed
    await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "DOWNLOADING", progress: 50 } });
    await new Promise((r) => setTimeout(r, 800));
    await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, fileUrl: url } });
  },
  { connection, concurrency: 2 }
);

parseWorker.on("failed", (job, err) => console.error(`[parse] job ${job?.id} failed`, err));
downloadWorker.on("failed", (job, err) => console.error(`[download] job ${job?.id} failed`, err));

process.on("SIGTERM", async () => {
  await parseWorker.close();
  await downloadWorker.close();
  await prisma.$disconnect();
  process.exit(0);
});
