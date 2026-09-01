import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { cheerioCrawl } from "@/lib/handlers/cheerio";
import { ytDlpGeneric } from "@/lib/handlers/ytDlpGeneric";
import { youtubeThumbnail } from "@/lib/handlers/utils/thumbnail";

/**
 * Dedicated social API – twitter|x|instagram|tiktok
 * Always prefers ytDlpGeneric over cheerio (cheerio gives 403 video.twimg.com bare links)
 * Isolated so instagram merge-skip and twitter proxy logic don't affect YouTube
 */
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rl = await checkRateLimit(ip);
  if (!rl.success) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const { url } = await req.json().catch(() => ({ url: "" }));
  if (!url || !/twitter\.com|x\.com|instagram\.com|tiktok\.com/.test(url)) return NextResponse.json({ error: "Not a social URL, use /api/parse" }, { status: 400 });
  try { new URL(url); } catch { return NextResponse.json({ error: "Invalid URL" }, { status: 400 }); }
  const job = await prisma.downloadJob.create({ data: { sourceUrl: url, status: "PARSING", progress: 10 } });
  try {
    const { detected: cheerioDetected, pageTitle } = await cheerioCrawl(url, job.id);
    let detected = cheerioDetected;
    // social always try ytDlpGeneric and prefer it
    const generic = await ytDlpGeneric(url, job.id);
    if (generic && generic.length) detected = generic;
    const isFailed = detected.length === 0;
    if (isFailed) detected = [{ url, quality: "auto", ext: "mp4", thumbnail: youtubeThumbnail(url, ""), hasAudio: false, needsMerge: false, _failed: true, error: "blocked_or_unsupported" }];
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
