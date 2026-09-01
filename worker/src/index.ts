import { Worker } from "bullmq";
import IORedis from "ioredis";
import * as cheerio from "cheerio";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import os from "os";
// Optional Sentry for worker — enabled if SENTRY_DSN set
try {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    // dynamic import so worker still runs without @sentry if removed
    import("@sentry/nextjs").then((Sentry: any) => {
      Sentry.init({ dsn, tracesSampleRate: 0.05, enabled: true });
      console.log("[worker] Sentry enabled");
    }).catch(() => {});
  }
} catch {}

const prisma = new PrismaClient();
const connection = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false }) : undefined;

if (!connection) {
  console.log("[worker] No REDIS_URL — worker idle. API will use mock mode. Set REDIS_URL=rediss://default:TOKEN@host:6379 to enable real queue.");
  process.exit(0);
}

console.log("[worker] Starting workers — yt-dlp-exec + cheerio + ytdl-core + ffmpeg merge");

function getS3() {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });
}

function pickAllFormats(info: any, max = 8) {
  const formats: any[] = info.formats || [];
  const isHls = (f: any) =>
    f.protocol === "m3u8" ||
    f.protocol === "m3u8_native" ||
    f.ext === "m3u8" ||
    String(f.url || "").includes(".m3u8") ||
    String(f.url || "").includes("manifest.googlevideo.com");
  // Group by height, keep best per height, prefer mp4, mark if needs merge (video-only)
  const byHeight = new Map<number, any>();
  for (const f of formats) {
    if (!f.url || !f.height || isHls(f)) continue;
    const h = f.height;
    const existing = byHeight.get(h);
    // Prefer muxed (has audio) over video-only, and mp4 over webm
    const score = (x: any) => (x.acodec !== "none" ? 2 : 0) + (x.ext === "mp4" ? 1 : 0);
    if (!existing || score(f) > score(existing)) byHeight.set(h, f);
  }
  const sorted = Array.from(byHeight.values())
    .sort((a, b) => b.height - a.height)
    .slice(0, max);
  // If no heights (rare), fallback to top formats
  const pool = sorted.length ? sorted : formats.filter((f) => f.url && !isHls(f)).slice(0, max);
  const title = (info.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";
  return pool.map((f: any) => ({
    format_id: f.format_id,
    url: f.url,
    quality: `${f.height}p`,
    height: f.height,
    ext: f.ext || "mp4",
    acodec: f.acodec,
    vcodec: f.vcodec,
    hasAudio: f.acodec !== "none",
    needsMerge: f.acodec === "none",
    title,
    size: f.filesize ? `${(f.filesize / 1024 / 1024).toFixed(1)} MB` : f.filesize_approx ? `~${(f.filesize_approx / 1024 / 1024).toFixed(1)} MB` : undefined,
    thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || "",
    duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, "0")}` : undefined,
  }));
}

async function mergeHighRes(url: string, targetHeight: number, jobId: string): Promise<string> {
  // Use yt-dlp to download bestvideo[height=target] + bestaudio and merge via ffmpeg, upload to R2
  const s3 = getS3();
  if (!s3) throw new Error("S3 not configured — set S3_* in .env to enable 1080p+ merging");
  const bucket = process.env.S3_BUCKET!;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `speeddl-${jobId}-`));
  const outPath = path.join(tmpDir, `${targetHeight}p.mp4`);
  console.log(`[merge] ${jobId} ${targetHeight}p -> yt-dlp download + ffmpeg merge to ${outPath}`);

  const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
  // Download bestvideo at height + bestaudio, merge to mp4
  await ytdlp(url, {
    format: `bestvideo[height=${targetHeight}][ext=mp4]+bestaudio/bestvideo[height=${targetHeight}]+bestaudio/best`,
    mergeOutputFormat: "mp4",
    output: outPath,
    noPlaylist: true,
    noWarnings: true,
  } as any);

  if (!fs.existsSync(outPath)) {
    // yt-dlp may output with different name if ext differs, find file
    const files = fs.readdirSync(tmpDir);
    const found = files.find((f) => f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".webm"));
    if (!found) throw new Error("Merge output not found");
    const foundPath = path.join(tmpDir, found);
    if (foundPath !== outPath) fs.renameSync(foundPath, outPath);
  }

  const body = fs.readFileSync(outPath);
  const key = `merged/${jobId}/${targetHeight}p-${Date.now()}.mp4`;
  // 30 min expiry for prod (was 60s testing)
  const TEST_EXPIRE_SEC = 30 * 60;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
      CacheControl: `public, max-age=${TEST_EXPIRE_SEC}`,
      Expires: new Date(Date.now() + TEST_EXPIRE_SEC * 1000),
    })
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const rawPublic = process.env.S3_PUBLIC_URL?.trim();
  const publicUrl = rawPublic && !rawPublic.includes("yourdomain.com") ? rawPublic.replace(/\/$/, "") : "";
  if (publicUrl) {
    const urlOut = `${publicUrl}/${key}`;
    console.log(`[merge] ${jobId} ${targetHeight}p uploaded to ${key} -> ${urlOut}`);
    return urlOut;
  }
  // No public URL — use R2.dev public URL (enable in Cloudflare: R2 bucket Settings -> Public Access -> Allow Access)
  const fallback = `https://${bucket}.r2.dev/${key}`;
  console.log(`[merge] ${jobId} ${targetHeight}p uploaded to ${key} -> ${fallback} (enable R2.dev public access if 404)`);
  return fallback;
}

const parseWorker = new Worker(
  "parse-queue",
  async (job: any) => {
    const { jobId, url } = job.data as { jobId: string; url: string };
    console.log(`[parse] ${jobId} -> ${url}`);
    await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "PARSING", progress: 10 } });

    try {
      let detected: any[] = [];
      let pageTitle = "";

      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          const html = await res.text();
          const $ = cheerio.load(html);
          pageTitle = $("title").first().text().trim().slice(0, 120);
          $("video source, video, meta[property='og:video'], meta[property='og:video:secure_url']").each((_, el) => {
            const src = $(el).attr("src") || $(el).attr("content") || $(el).attr("srcset");
            if (src && !src.startsWith("blob:")) {
              try {
                const abs = new URL(src, url).toString();
                const ext = abs.split(".").pop()?.split("?")[0] || "mp4";
                if (["mp4", "webm", "mov"].includes(ext)) detected.push({ url: abs, quality: "auto", ext, thumbnail: "", hasAudio: true, needsMerge: false });
              } catch {}
            }
          });
          if (detected.length) console.log(`[parse] cheerio found ${detected.length} sources for ${jobId}`);
        }
      } catch (e) {
        console.warn("[parse] cheerio crawl failed", String(e).slice(0, 200));
      }

      const needsYtdlp = detected.length === 0 || /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|vimeo\.com|twitch\.tv/.test(url);
      if (needsYtdlp) {
        try {
          const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
          const info: any = await ytdlp(url, {
            dumpSingleJson: true,
            noPlaylist: true,
            noWarnings: true,
            preferFreeFormats: true,
          } as any);
          const formats = pickAllFormats(info, 8);
          if (formats.length) {
            detected = formats;
            console.log(`[parse] yt-dlp found ${formats.length} formats for ${jobId} title="${(info.title || pageTitle).slice(0, 60)}" heights=${formats.map((f: any) => f.quality).join(",")}`);
          }
        } catch (e: any) {
          console.warn("[parse] yt-dlp-exec failed", String(e?.message || e).slice(0, 300));
        }
      }

      if (detected.length === 0 && /youtube\.com|youtu\.be/.test(url)) {
        try {
          const ytdl = await import("@distube/ytdl-core").then((m: any) => m.default || m);
          const info = await ytdl.getInfo(url);
          const formats = ytdl.filterFormats(info.formats, "videoandaudio");
          const title2 = (info.videoDetails.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";
          const best = formats
            .filter((f: any) => f.url)
            .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))
            .slice(0, 6)
            .map((f: any) => ({
              url: f.url,
              quality: f.qualityLabel || (f.height ? `${f.height}p` : "best"),
              height: f.height,
              ext: f.container || "mp4",
              hasAudio: true,
              needsMerge: false,
              title: title2,
              size: f.contentLength ? `${(Number(f.contentLength) / 1024 / 1024).toFixed(1)} MB` : undefined,
              thumbnail: info.videoDetails.thumbnails?.[0]?.url || "",
            }));
          if (best.length) detected = best;
        } catch (e) {
          console.warn("[parse] ytdl-core fallback failed", String(e).slice(0, 200));
        }
      }

      if (detected.length === 0) detected = [{ url, quality: "auto", ext: "mp4", thumbnail: "", hasAudio: true, needsMerge: false }];

      const seen = new Set<string>();
      detected = detected.filter((d: any) => (seen.has(d.quality) ? false : (seen.add(d.quality), true)));

      // 30 min expiry
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.downloadJob.update({
        where: { id: jobId },
        data: { detectedUrls: detected as any, status: "COMPLETED", progress: 100, expiresAt },
      });
      console.log(`[parse] ${jobId} completed with ${detected.length} sources expiresAt=${expiresAt.toISOString()}`);
    } catch (err) {
      console.error(`[parse] ${jobId} failed`, err);
      await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "FAILED" } });
      throw err;
    }
  },
  { connection, concurrency: 2 }
);

const downloadWorker = new Worker(
  "download-queue",
  async (job: any) => {
    const { jobId, url, height, sourceUrl, needsMerge } = job.data as { jobId: string; url: string; height?: number; sourceUrl?: string; needsMerge?: boolean };
    console.log(`[download] ${jobId} h=${height || "?"} needsMerge=${needsMerge} -> ${url.slice(0, 80)}`);
    await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "DOWNLOADING", progress: 15 } });
    try {
      if (needsMerge && sourceUrl && height) {
        // Granular progress to make UI feel fast
        await prisma.downloadJob.update({ where: { id: jobId }, data: { progress: 25 } });
        const mergedUrl = await (async () => {
          // Update progress during yt-dlp + ffmpeg stages
          const progressInterval = setInterval(async () => {
            try {
              const j = await prisma.downloadJob.findUnique({ where: { id: jobId } });
              const cur = j?.progress || 25;
              if (cur < 85) await prisma.downloadJob.update({ where: { id: jobId }, data: { progress: Math.min(85, cur + 7) } });
            } catch {}
          }, 3000);
          try {
            const urlOut = await mergeHighRes(sourceUrl, height!, jobId);
            clearInterval(progressInterval);
            return urlOut;
          } finally {
            clearInterval(progressInterval);
          }
        })();
        const exp30m = new Date(Date.now() + 30 * 60 * 1000);
        await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, fileUrl: mergedUrl, expiresAt: exp30m } });
        console.log(`[download] ${jobId} merged ${height}p -> ${mergedUrl.slice(0, 80)} expiresAt=${exp30m.toISOString()}`);
        return;
      }
      await prisma.downloadJob.update({ where: { id: jobId }, data: { progress: 75 } });
      await new Promise((r) => setTimeout(r, 400));
      await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, fileUrl: url, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    } catch (e) {
      console.error(`[download] ${jobId} failed, falling back to direct url`, e);
      await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, fileUrl: url, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    }
  },
  { connection, concurrency: 1 } // merge is heavy, concurrency 1
);

parseWorker.on("failed", (job: any, err: any) => console.error(`[parse] job ${job?.id} failed`, err));
downloadWorker.on("failed", (job: any, err: any) => console.error(`[download] job ${job?.id} failed`, err));

process.on("SIGTERM", async () => {
  await parseWorker.close();
  await downloadWorker.close();
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await parseWorker.close();
  await downloadWorker.close();
  await prisma.$disconnect();
  process.exit(0);
});
