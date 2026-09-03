import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

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
  // Single deploy (local=prod): no external worker for merge — return direct
  // For 1080p video-only, frontend will get silent video; use 720p muxed for audio on single deploy
  // If you need 1080p+audio merge, run `npm run worker` locally with REDIS, but prod single deploy stays direct for parity
  console.log(`[download] single deploy direct for ${jobId} ${height || "?"}p needsMerge=${needsMerge}`);
  try {
    await prisma.downloadJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", progress: 100, fileUrl: formatUrl, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
  } catch {}
  return NextResponse.json({ status: "COMPLETED", fileUrl: formatUrl });
}
