import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";

const schema = z.object({ jobId: z.string(), formatUrl: z.string().url() });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const queue = getQueue(QUEUE_NAMES.DOWNLOAD);
  if (queue) {
    await queue.add("download", { jobId: parsed.data.jobId, url: parsed.data.formatUrl });
    return NextResponse.json({ status: "DOWNLOADING", jobId: parsed.data.jobId });
  }

  // Mock: redirect to source URL directly (in prod, worker would proxy to R2 and return presigned URL)
  return NextResponse.json({ status: "COMPLETED", fileUrl: parsed.data.formatUrl });
}
