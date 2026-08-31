import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import prisma from "@/lib/prisma";

const schema = z.object({ jobId: z.string(), formatUrl: z.string().url(), height: z.number().optional(), sourceUrl: z.string().url().optional(), needsMerge: z.boolean().optional() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  // Fetch sourceUrl for high-res merge if not provided
  let sourceUrl = parsed.data.sourceUrl;
  if (!sourceUrl) {
    try {
      const job = await prisma.downloadJob.findUnique({ where: { id: parsed.data.jobId } });
      sourceUrl = job?.sourceUrl || undefined;
    } catch {}
  }

  const queue = getQueue(QUEUE_NAMES.DOWNLOAD);
  if (queue) {
    await queue.add("download", { jobId: parsed.data.jobId, url: parsed.data.formatUrl, height: parsed.data.height, sourceUrl, needsMerge: parsed.data.needsMerge }, { attempts: 2 });
    return NextResponse.json({ status: "DOWNLOADING", jobId: parsed.data.jobId });
  }

  return NextResponse.json({ status: "COMPLETED", fileUrl: parsed.data.formatUrl });
}
