import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Process up to 3 QUEUED jobs per cron tick (Vercel Hobby 60s limit)
  const jobs = await prisma.downloadJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: 3,
  });

  if (!jobs.length) return NextResponse.json({ processed: 0, message: "No queued jobs" });

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const url = job.sourceUrl;
    try {
      await prisma.downloadJob.update({ where: { id: job.id }, data: { status: "PARSING", progress: 10 } });
      let detected: any[] = [];
      let pageTitle = "";

      // 1. Cheerio crawl for generic <video> tags
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(8000),
        });
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
        }
      } catch (e) {
        console.warn(`[cron] cheerio failed for ${job.id}`, String(e).slice(0, 150));
      }

      // 2. Piped fallback for YouTube — pure JS, no yt-dlp binary needed on Vercel
      if (detected.length === 0 && /youtube\.com|youtu\.be/.test(url)) {
        try {
          const idMatch = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
          const vid = idMatch ? idMatch[1] : null;
          if (vid) {
            const pipedHosts = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de"];
            for (const host of pipedHosts) {
              try {
                const r = await fetch(`${host}/streams/${vid}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(7000) });
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
                    title: (pj.title || pageTitle).replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video",
                    size: s.bitrate ? `${(s.bitrate / 8000 / 1024).toFixed(1)} MB` : undefined,
                    thumbnail: pj.thumbnailUrl || "",
                  }))
                  .filter((v: any) => v.height)
                  .sort((a: any, b: any) => b.height - a.height)
                  .slice(0, 8);
                if (mapped.length) {
                  detected = mapped;
                  console.log(`[cron] piped ${host} found ${mapped.length} for ${job.id}`);
                  break;
                }
              } catch {}
            }
          }
        } catch (e) {
          console.warn(`[cron] piped failed for ${job.id}`, String(e).slice(0, 150));
        }
      }

      // 3. ytdl-core fallback — pure JS, works on Vercel
      if (detected.length === 0 && /youtube\.com|youtu\.be/.test(url)) {
        try {
          const ytdl: any = await import("@distube/ytdl-core").then((m: any) => m.default || m);
          const info = await (ytdl as any).getInfo(url);
          const formats = (ytdl as any).filterFormats(info.formats, "videoandaudio");
          const title2 = (info.videoDetails.title || pageTitle).replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";
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
          console.warn(`[cron] ytdl-core failed for ${job.id}`, String(e).slice(0, 150));
        }
      }

      if (detected.length === 0) detected = [{ url, quality: "auto", ext: "mp4", thumbnail: "", hasAudio: true, needsMerge: false }];
      const seen = new Set<string>();
      detected = detected.filter((d: any) => (seen.has(d.quality) ? false : (seen.add(d.quality), true)));

      // Vercel-only: never needsMerge (no ffmpeg) — return direct URLs with 302 on download
      detected.forEach((d: any) => (d.needsMerge = false));

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.downloadJob.update({
        where: { id: job.id },
        data: { detectedUrls: detected as any, status: "COMPLETED", progress: 100, expiresAt },
      });
      processed++;
      console.log(`[cron] ${job.id} completed ${detected.length} qualities`);
    } catch (err) {
      console.error(`[cron] ${job.id} failed`, err);
      try {
        await prisma.downloadJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
      } catch {}
      failed++;
    }
  }

  return NextResponse.json({ processed, failed, total: jobs.length });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
