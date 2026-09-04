import { Worker } from "bullmq";
import IORedis from "ioredis";
import * as cheerio from "cheerio";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";

// Proxy support for ISP-blocked sites (pornhub.org in India) — YTDLP_PROXY / HTTPS_PROXY
function getProxyUrl(): string | undefined {
  const raw = process.env.YTDLP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  if (!raw?.trim()) return undefined;
  try { new URL(raw.trim()); return raw.trim(); } catch { return undefined; }
}
function getProxyDispatcher(): any | undefined {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return undefined;
  try {
    const { ProxyAgent } = require("undici");
    return new ProxyAgent(proxyUrl);
  } catch { return undefined; }
}
function getYtDlpProxyArgs(): Record<string, string> {
  const p = getProxyUrl();
  return p ? { proxy: p } : {};
}

// Keepalive http for standalone worker (Fly/Railway). On Render single container, Next.js owns PORT=3000 — worker uses 3001 or WORKER_PORT
// Local dev: Next.js on :3000, worker on :3001 (avoid EADDRINUSE)
const keepPort = Number(process.env.WORKER_PORT || 3001);
const isCombinedRender = process.env.PORT === "3000" && !process.env.WORKER_PORT;
function startKeepAlive(port: number, label: string) {
  const srv = http.createServer((_, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("mediamover worker ok"); });
  srv.on("error", (err: any) => {
    if (err?.code === "EADDRINUSE") {
      console.warn(`[keepalive] :${port} in use (${label}) — skip (worker still runs)`);
    } else {
      console.error(`[keepalive] failed :${port}`, err);
    }
  });
  srv.listen(port, () => console.log(`[keepalive] worker http :${port} (${label})`));
}
if (isCombinedRender) {
  startKeepAlive(keepPort, "combined mode, Next is :3000");
} else {
  startKeepAlive(keepPort, "UptimeRobot");
}
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
  const isStoryboard = (f: any) => f.ext === "mhtml" || f.protocol === "mhtml" || String(f.format_id || "").startsWith("sb") || String(f.format_note || "").toLowerCase().includes("storyboard");
  // Group by height, keep best per height, prefer mp4, mark if needs merge (video-only)
  const byHeight = new Map<number, any>();
  for (const f of formats) {
    if (!f.url || !f.height || isHls(f)) continue;
    if (isStoryboard(f)) continue;
    if (f.height < 144) continue;
    if (f.ext === "mhtml") continue;
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

async function mergeHighRes(url: string, targetHeight: number, jobId: string, onProgress?: (p: number) => void): Promise<string> {
  // Use yt-dlp to download bestvideo[height=target] + bestaudio and merge via ffmpeg, upload to R2
  const s3 = getS3();
  if (!s3) throw new Error("S3 not configured — set S3_* in .env to enable 1080p+ merging");
  const bucket = process.env.S3_BUCKET!;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `mediamover-${jobId}-`));
  const outPath = path.join(tmpDir, `${targetHeight}p.mp4`);
  console.log(`[merge] ${jobId} ${targetHeight}p -> yt-dlp download + ffmpeg merge to ${outPath}`);

  const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
  // Real progress: try to parse yt-dlp --newline output, fallback to timing
  onProgress?.(40);
  // Download bestvideo at height + bestaudio, merge to mp4
  await ytdlp(url, {
    format: `bestvideo[height=${targetHeight}][ext=mp4]+bestaudio/bestvideo[height=${targetHeight}]+bestaudio/best`,
    mergeOutputFormat: "mp4",
    output: outPath,
    noPlaylist: true,
    noWarnings: true,
  } as any);
  onProgress?.(70);

  if (!fs.existsSync(outPath)) {
    // yt-dlp may output with different name if ext differs, find file
    const files = fs.readdirSync(tmpDir);
    const found = files.find((f) => f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".webm"));
    if (!found) throw new Error("Merge output not found");
    const foundPath = path.join(tmpDir, found);
    if (foundPath !== outPath) fs.renameSync(foundPath, outPath);
  }

  onProgress?.(80);
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
  onProgress?.(90);
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

      // --- robust cheerio crawl (fpo.xxx / wowxxx need full browser headers + 15s timeout + retry) ---
      const cheerioHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: (() => { try { return new URL(url).origin + "/"; } catch { return "https://www.fpo.xxx/"; } })(),
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      };
      const proxyUrl = getProxyUrl();
      const proxyDispatcher = getProxyDispatcher();
      if (proxyUrl) console.log(`[parse] proxy enabled for ${jobId} ${proxyUrl.replace(/:[^:/@]+@/, "://***@")}`);
      async function fetchHtml(target: string, timeoutMs: number) {
        const opts: any = { headers: cheerioHeaders, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) };
        if (proxyDispatcher) opts.dispatcher = proxyDispatcher;
        return fetch(target, opts);
      }
      for (let attempt = 0; attempt < 2 && detected.length === 0; attempt++) {
        try {
          const res = await fetchHtml(url, 15000);
          if (!res.ok) {
            console.warn(`[parse] cheerio http ${res.status} ${res.headers.get("cf-mitigated") || ""} for ${jobId}`);
            if (attempt === 0 && (res.status === 403 || res.status === 429 || res.status === 503)) {
              await new Promise((r) => setTimeout(r, 800));
              continue;
            }
            break;
          }
          const html = await res.text();
          const $ = cheerio.load(html);
          pageTitle = $("title").first().text().trim().slice(0, 120);
          $("video source, video, meta[property='og:video'], meta[property='og:video:secure_url'], source[src], [data-src], [data-video-url]").each((_, el) => {
            const src = $(el).attr("src") || $(el).attr("content") || $(el).attr("srcset") || $(el).attr("data-src") || $(el).attr("data-video-url");
            if (src && !src.startsWith("blob:") && !src.startsWith("data:")) {
              try {
                const abs = new URL(src, url).toString();
                const ext = abs.split(".").pop()?.split("?")[0]?.toLowerCase() || "mp4";
                if (["mp4", "webm", "mov", "m3u8"].includes(ext)) detected.push({ url: abs, quality: "auto", ext, thumbnail: "", hasAudio: true, needsMerge: false });
              } catch {}
            }
          });
          if (detected.length === 0) {
            const patterns = [
              /["']contentUrl["']\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
              /["']video_url["']\s*:\s*["']([^"']+)["']/gi,
              /source\s*src\s*=\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
              /https?:\/\/[^"' \s]+\.(?:mp4|m3u8)[^"' \s]*/gi,
            ];
            const seenUrl = new Set<string>();
            for (const re of patterns) {
              let m: RegExpExecArray | null;
              re.lastIndex = 0;
              while ((m = re.exec(html)) !== null) {
                const raw = m[1] || m[0];
                const cleaned = raw.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
                if (!cleaned || seenUrl.has(cleaned) || cleaned.startsWith("blob:")) continue;
                seenUrl.add(cleaned);
                try {
                  const abs = new URL(cleaned, url).toString();
                  const ext = abs.split(".").pop()?.split("?")[0]?.toLowerCase() || "mp4";
                  if (["mp4", "webm", "mov", "m3u8"].includes(ext)) {
                    detected.push({ url: abs, quality: "auto", ext, thumbnail: "", hasAudio: true, needsMerge: false });
                    if (detected.length >= 3) break;
                  }
                } catch {}
              }
              if (detected.length) break;
            }
            if (detected.length) console.log(`[parse] cheerio regex found ${detected.length} for ${jobId} (attempt ${attempt + 1})`);
          }
          if (detected.length) console.log(`[parse] cheerio found ${detected.length} sources for ${jobId} (attempt ${attempt + 1})`);
          break;
        } catch (e: any) {
          const isTimeout = e?.name === "TimeoutError" || String(e).includes("TimeoutError") || String(e).includes("aborted");
          console.warn(`[parse] cheerio ${isTimeout ? "timeout" : "failed"} ${jobId} attempt ${attempt + 1}`, String(e).slice(0, 220));
          if (isTimeout && attempt === 0) {
            await new Promise((r) => setTimeout(r, 900));
            continue;
          }
          break;
        }
      }

      const isYoutube = /youtube\.com|youtu\.be/.test(url);
      const isInstagram = /instagram\.com/.test(url);
      const isUniversal = !isYoutube && !isInstagram && !/\.(mp4|webm|mov)(\?|$)/i.test(url);

      // FROZEN: YouTube — default (visionos full DASH) first, then multi-client fallback
      // NOTE: as of yt-dlp 2026, web/ios/tv clients are bot-blocked (null/403); default client returns full catalog
      if (isYoutube) {
        let best: any[] = detected;
        const clients = ["default", "web", "android", "ios", "tv"];
        // yt-dlp auto-reads HTTP(S)_PROXY from env; strip them when running without a proxy, else a
        // dead proxy in .env (402) hijacks all traffic -> youtube_blocked
        const stripProxyEnv = () => {
          const next: Record<string, string | undefined> = { ...process.env };
          for (const k of ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "no_proxy", "NO_PROXY"]) delete next[k];
          return next;
        };
        for (const withCookies of [false, true] as const) {
          const cookiesPath = process.env.YTDLP_COOKIES || (fs.existsSync(path.join(process.cwd(), "cookies.txt")) ? path.join(process.cwd(), "cookies.txt") : undefined);
          if (withCookies && !cookiesPath) continue;
          for (const client of clients) {
            for (const useFree of [true, false] as const) {
              try {
                const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
                const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...(cookiesPath ? { cookies: cookiesPath } : {}) };
                if (useFree) (args as any).preferFreeFormats = true;
                if (client !== "web" && client !== "default") args.extractorArgs = `youtube:player_client=${client}`;
                // no-proxy first (default client) with env stripped; execa merges env so set extendEnv:false
                const info: any = await Promise.race([
                  ytdlp(url, args, { env: stripProxyEnv(), extendEnv: false }),
                  new Promise((_, rej) => setTimeout(() => rej(new Error("yt-dlp timeout")), 22000)),
                ]);
                const formats = pickAllFormats(info, 8);
                if (formats.length > best.length) {
                  best = formats;
                  console.log(`[parse] yt-dlp (${client}${cookiesPath ? "+cookies" : ""}${useFree ? " free" : ""}) found ${formats.length} for ${jobId} title="${(info.title || pageTitle).slice(0, 60)}" heights=${formats.map((f: any) => f.quality).join(",")}`);
                }
                if (best.length >= 4) break;
              } catch (e: any) {
                console.warn(`[parse] yt-dlp (${client}${useFree ? " free" : ""}) failed`, String(e?.message || e).slice(0, 180));
              }
            }
            if (best.length >= 4) break;
          }
          if (best.length >= 4) break;
        }
        if (best.length) detected = best;
      } else if (isInstagram) {
        // FROZEN: Instagram — generic with cleaned URL retry (preserve exact logic)
        const urlsToTry = [url];
        try {
          const u = new URL(url);
          if (u.hostname.includes("instagram.com")) {
            u.search = "";
            const clean = u.toString();
            if (clean !== url) urlsToTry.push(clean);
          }
        } catch {}
        let found: any[] | null = null;
        for (const tryUrl of urlsToTry) {
          for (const useFree of [true, false] as const) {
            try {
              const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
              const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...getYtDlpProxyArgs() } as any;
              if (useFree) (args as any).preferFreeFormats = true;
              const info: any = await ytdlp(tryUrl, args);
              const formats = pickAllFormats(info, 8);
              if (formats.length) {
                found = formats;
                console.log(`[parse] yt-dlp (instagram) found ${formats.length} for ${jobId} ${tryUrl.slice(0, 40)} ${useFree ? "free" : ""} title="${(info.title || pageTitle).slice(0, 40)}" heights=${formats.map((f: any) => f.quality).join(",")}`);
                break;
              }
            } catch (e: any) {
              const msg = String(e?.message || e);
              console.warn(`[parse] yt-dlp (instagram) failed ${tryUrl.slice(0, 40)} ${useFree ? "free" : ""}`, msg.slice(0, 180));
              if (msg.includes("429") || msg.includes("rate")) await new Promise((r) => setTimeout(r, 900));
            }
          }
          if (found) break;
        }
        if (found) detected = found;
        else console.warn(`[parse] yt-dlp (instagram) no formats for ${url.slice(0, 60)} keeping cheerio=${detected.length}`);
      } else if (isUniversal) {
        // Universal — X, TikTok, pornhub, missav, fpo.xxx, wowxxx, vimeo, twitch, etc.
        // Isolated: ytDlpUniversal (no per-site logic, no instagram clean, generic extractor)
        const isWeak = detected.length === 0 || detected.every((d: any) => d.quality === "auto");
        const shouldTryYtDlp = detected.length === 0 || isWeak || /twitter\.com|x\.com|tiktok\.com/.test(url);
        if (shouldTryYtDlp) {
          let found: any[] | null = null;
          for (const useFree of [true, false] as const) {
            try {
              const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
              const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...getYtDlpProxyArgs() } as any;
              if (useFree) (args as any).preferFreeFormats = true;
              const info: any = await ytdlp(url, args);
              const formats = pickAllFormats(info, 8);
              if (formats.length) {
                found = formats;
                console.log(`[parse] yt-dlp (universal) found ${formats.length} for ${jobId} ${url.slice(0, 40)} ${useFree ? "free" : ""} title="${(info.title || pageTitle).slice(0, 40)}" heights=${formats.map((f: any) => f.quality).join(",")}`);
                break;
              }
            } catch (e: any) {
              const full = String((e as any)?.stderr || (e as any)?.shortMessage || e?.message || e).slice(0, 600);
              const msg = String(e?.message || e);
              console.warn(`[parse] yt-dlp (universal) failed ${url.slice(0, 40)} ${useFree ? "free" : ""}`, full.slice(0, 320));
              if (msg.includes("429") || msg.includes("rate") || msg.includes("Try again")) {
                await new Promise((r) => setTimeout(r, 900));
                try {
                  const ytdlp2: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
                  const info2: any = await ytdlp2(url, { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...getYtDlpProxyArgs() } as any);
                  const fmts2 = pickAllFormats(info2, 8);
                  if (fmts2.length) {
                    found = fmts2;
                    console.log(`[parse] yt-dlp (universal) retry found ${fmts2.length} for ${jobId}`);
                    break;
                  }
                } catch {}
              }
            }
          }
          if (found) detected = found;
          else if (detected.length === 0) console.warn(`[parse] yt-dlp (universal) no formats for ${url.slice(0, 60)}`);
        }
      }

      // Free Piped fallback for YouTube datacenter IP (Replit/Render bot) — no cookies/proxy, like local
      if (detected.length === 0 && /youtube\.com|youtu\.be/.test(url)) {
        try {
          const idMatch = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
          const vid = idMatch ? idMatch[1] : null;
          if (vid) {
            const pipedHosts = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de"];
            for (const host of pipedHosts) {
              try {
                const r = await fetch(`${host}/streams/${vid}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
                if (!r.ok) continue;
                const pj: any = await r.json();
                const streams: any[] = [...(pj.videoStreams || []), ...(pj.audioStreams || [])];
                const mapped = streams
                  .filter((s: any) => s.url)
                  .map((s: any) => ({
                    url: s.url,
                    quality: s.quality || (s.height ? `${s.height}p` : "best"),
                    height: s.height || parseInt(s.quality) || undefined,
                    ext: (s.mimeType || "video/mp4").split("/")[1]?.split(";")[0] || "mp4",
                    hasAudio: !!s.audioTrackName || s.mimeType?.includes("audio") || false,
                    needsMerge: false,
                    title: (pj.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video",
                    size: s.bitrate ? `${(s.bitrate / 8000 / 1024).toFixed(1)} MB` : undefined,
                    thumbnail: pj.thumbnailUrl || "",
                  }))
                  .filter((v: any) => v.height)
                  .sort((a: any, b: any) => b.height - a.height)
                  .slice(0, 8);
                if (mapped.length) {
                  detected = mapped;
                  console.log(`[parse] piped ${host} found ${mapped.length} for ${jobId} vid=${vid}`);
                  break;
                }
              } catch {}
            }
          }
        } catch (e) {
          console.warn("[parse] piped fallback failed", String(e).slice(0, 180));
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

      const isFailed = detected.length === 0;
      const errCode = isYoutube ? "youtube_blocked" : "blocked_or_unsupported";
      if (isFailed) detected = [{ url, quality: "auto", ext: "mp4", thumbnail: isYoutube ? `https://img.youtube.com/vi/${url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || ""}/hqdefault.jpg` : "", hasAudio: false, needsMerge: false, _failed: true, error: errCode }];

      const seen = new Set<string>();
      detected = detected.filter((d: any) => (seen.has(d.quality) ? false : (seen.add(d.quality), true)));
      // unify with processJob.ts: _failed flag + hasAudio:false so frontend shows_retry (worker previously hasAudio:true hid failure)

      // 30 min expiry
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.downloadJob.update({
        where: { id: jobId },
        data: { detectedUrls: detected as any, status: isFailed ? "FAILED" : "COMPLETED", progress: 100, expiresAt },
      });
      if (isFailed) console.warn(`[parse] ${jobId} failed - no formats isYoutube=${isYoutube} ${isYoutube ? "youtube needs cookies" : "missav/pornhub blocked"}`);
      else console.log(`[parse] ${jobId} completed with ${detected.length} sources expiresAt=${expiresAt.toISOString()}`);
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
        // TikTok/X are muxed - skip merge (instagram needs merge for audio to avoid silent video)
        if (/tiktok\.com|twitter\.com|x\.com/.test(sourceUrl)) {
          console.log(`[download] ${jobId} skip merge for social (muxed) -> direct`);
          await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, fileUrl: url, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
          return;
        }
        // Real progress milestones (not dummy interval)
        await prisma.downloadJob.update({ where: { id: jobId }, data: { progress: 25 } });
        console.log(`[download] ${jobId} yt-dlp start ${height}p`);
        const mergedUrl = await (async () => {
          // Update to 35 when yt-dlp starts, 65 after download, 85 after ffmpeg/upload
          await prisma.downloadJob.update({ where: { id: jobId }, data: { progress: 35 } });
          const timeoutMs = 90000;
          const urlOut = await Promise.race([
            (async () => {
              const out = await mergeHighRes(sourceUrl, height!, jobId, async (p: number) => {
                // mergeHighRes can report 35->70 for download, 70->85 for merge
                try { await prisma.downloadJob.update({ where: { id: jobId }, data: { progress: p } }); } catch {}
              });
              return out;
            })(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("merge timeout 90s")), timeoutMs)),
          ]);
          await prisma.downloadJob.update({ where: { id: jobId }, data: { progress: 85 } });
          return urlOut;
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
  { connection, concurrency: 2 } // was 1 - bump to 2 so instagram doesn't block queue
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
