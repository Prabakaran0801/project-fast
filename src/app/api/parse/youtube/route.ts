import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { youtubeHandler } from "@/lib/handlers/youtube";
import { youtubeThumbnail } from "@/lib/handlers/utils/thumbnail";

/**
 * Dedicated YouTube API – isolated from generic/cheerio logic
 * Same input as /api/parse but forces youtubeHandler (web→android best keeper)
 * Use when frontend knows URL is youtube.com / youtu.be
 */
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rl = await checkRateLimit(ip);
  if (!rl.success) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const { url } = await req.json().catch(() => ({ url: "" }));
  if (!url || !/youtube\.com|youtu\.be/.test(url)) return NextResponse.json({ error: "Not a YouTube URL, use /api/parse" }, { status: 400 });
  try {
    new URL(url);
  } catch { return NextResponse.json({ error: "Invalid URL" }, { status: 400 }); }
  const job = await prisma.downloadJob.create({ data: { sourceUrl: url, status: "PARSING", progress: 10 } });
  try {
    let detected = await youtubeHandler(url, job.id, []);
    const isFailed = detected.length === 0;
    if (isFailed) detected = [{ url, quality: "auto", ext: "mp4", thumbnail: youtubeThumbnail(url, ""), hasAudio: false, needsMerge: false, _failed: true, error: "youtube_blocked" }];
    const seen = new Set<string>();
    detected = detected.filter((d: any) => (seen.has(d.quality) ? false : (seen.add(d.quality), true)));
    detected.forEach((d: any) => { if (!d.thumbnail) d.thumbnail = youtubeThumbnail(url, d.thumbnail); });
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.downloadJob.update({ where: { id: job.id }, data: { detectedUrls: detected as any, status: isFailed ? "FAILED" : "COMPLETED", progress: 100, expiresAt } });
    return NextResponse.json({ jobId: job.id, status: isFailed ? "FAILED" : "COMPLETED", detectedUrls: detected });
  } catch (e: any) {
    await prisma.downloadJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
