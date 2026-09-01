import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

const schema = z.object({ jobId: z.string(), formatUrl: z.string().url(), height: z.number().optional(), sourceUrl: z.string().url().optional(), needsMerge: z.boolean().optional() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  // Vercel-only: no ffmpeg merge worker — return direct URL immediately.
  // High-res 1080p+ that needsMerge is served via 302 redirect to googlevideo.com (fast, no R2 upload)
  // If you need merged R2 files, keep Fly/Cloud Run worker; on Vercel Hobby ffmpeg is unavailable.
  try {
    await prisma.downloadJob.update({
      where: { id: parsed.data.jobId },
      data: { status: "COMPLETED", progress: 100, fileUrl: parsed.data.formatUrl, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
  } catch {}

  return NextResponse.json({ status: "COMPLETED", fileUrl: parsed.data.formatUrl });
}
