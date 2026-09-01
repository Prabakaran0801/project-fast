import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";

const schema = z.object({ jobId: z.string(), formatUrl: z.string().url(), height: z.number().optional(), sourceUrl: z.string().url().optional(), needsMerge: z.boolean().optional() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { jobId, formatUrl, height, sourceUrl, needsMerge } = parsed.data;

  // If hasAudio=true (muxed) or no merge needed — direct download, no R2 (hybrid fast path)
  if (!needsMerge) {
    try {
      await prisma.downloadJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", progress: 100, fileUrl: formatUrl, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
      });
    } catch {}
    return NextResponse.json({ status: "COMPLETED", fileUrl: formatUrl });
  }

  // TikTok/X are muxed - skip merge (instagram needs merge for audio, keep it)
  if (needsMerge && sourceUrl && /tiktok\.com|twitter\.com|x\.com/.test(sourceUrl)) {
    try {
      await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "COMPLETED", progress: 100, fileUrl: formatUrl, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    } catch {}
    console.log(`[download] skip merge for social ${jobId} -> direct`);
    return NextResponse.json({ status: "COMPLETED", fileUrl: formatUrl });
  }
  // needsMerge=true (video-only like YouTube 1080p) — enqueue to BullMQ download-queue for ffmpeg merge -> R2 (worker/src/index.ts:308)
  // This works on Render single container (worker + Next together) or standalone worker; falls back to direct if no REDIS_URL
  try {
    const queue = getQueue(QUEUE_NAMES.DOWNLOAD);
    if (queue && sourceUrl && height) {
      // Mark as DOWNLOADING and enqueue
      await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "DOWNLOADING", progress: 15, fileUrl: formatUrl } });
      await queue.add("download", { jobId, url: formatUrl, height, sourceUrl, needsMerge: true }, { attempts: 1 });
      console.log(`[download] enqueued ${jobId} ${height}p merge to download-queue`);
      return NextResponse.json({ status: "DOWNLOADING", progress: 15 });
    }
  } catch (e) {
    console.warn("[download] queue enqueue failed, falling back to direct", String(e).slice(0, 120));
  }

  // Fallback: no Redis/worker — return direct (will be silent video but better than hanging)
  try {
    await prisma.downloadJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", progress: 100, fileUrl: formatUrl, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
  } catch {}
  return NextResponse.json({ status: "COMPLETED", fileUrl: formatUrl });
}
