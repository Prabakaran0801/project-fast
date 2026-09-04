import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { universalHandler } from "@/lib/handlers/universal";
import { youtubeThumbnail } from "@/lib/handlers/utils/thumbnail";

/**
 * Dedicated universal API — isolated from youtube/instagram frozen logic
 * Handles: X (twitter/x.com), TikTok, pornhub, missav, fpo.xxx, wowxxx, vimeo, twitch, etc.
 * Same contract as /api/parse but forces universalHandler (cheerio -> ytDlpUniversal -> direct)
 * Use when URL is NOT youtube and NOT instagram
 */
export const maxDuration = 10;
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rl = await checkRateLimit(ip);
  if (!rl.success) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const { url } = await req.json().catch(() => ({ url: "" }));
  if (!url) return NextResponse.json({ error: "Missing URL" }, { status: 400 });
  if (/youtube\.com|youtu\.be/.test(url)) return NextResponse.json({ error: "YouTube URL — use /api/parse/youtube" }, { status: 400 });
  if (/instagram\.com/.test(url)) return NextResponse.json({ error: "Instagram URL — use /api/parse/social (frozen instagram path)" }, { status: 400 });
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  const job = await prisma.downloadJob.create({ data: { sourceUrl: url, status: "PARSING", progress: 10 } });
  try {
    const { detected: routed, pageTitle } = await universalHandler(url, job.id);
    let detected = routed;
    const isFailed = detected.length === 0;
    if (isFailed) detected = [{ url, quality: "auto", ext: "mp4", thumbnail: youtubeThumbnail(url, ""), hasAudio: false, needsMerge: false, title: pageTitle || "video", _failed: true, error: "blocked_or_unsupported" } as any];
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
