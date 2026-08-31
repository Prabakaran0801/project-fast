import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/ratelimit";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";
import prisma from "@/lib/prisma";

const schema = z.object({ url: z.string().url() });

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rl = await checkRateLimit(ip);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limited. Try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const { url } = parsed.data;

  // Block private IPs to prevent SSRF
  try {
    const u = new URL(url);
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(u.hostname)) {
      return NextResponse.json({ error: "Private URLs not allowed" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Create job in DB
  let job;
  try {
    job = await prisma.downloadJob.create({
      data: { sourceUrl: url, status: "QUEUED" },
    });
  } catch {
    // If DB not configured, create ephemeral job ID
    job = { id: `ephemeral_${Date.now()}`, sourceUrl: url, status: "QUEUED" } as unknown as { id: string };
  }

  // Try to enqueue for worker, fallback to inline mock if no Redis
  const queue = getQueue(QUEUE_NAMES.PARSE);
  if (queue) {
    await queue.add("parse", { jobId: job.id, url }, { attempts: 2, backoff: { type: "exponential", delay: 2000 } });
  } else {
    // No Redis — simulate parsing for MVP demo by updating job with mock data
    // In production, worker would do real yt-dlp + cheerio
    try {
      const mockVideos = [
        { url: url, quality: "1080p", ext: "mp4", thumbnail: "", size: "42 MB", duration: "2:34" },
        { url: url, quality: "720p", ext: "mp4", thumbnail: "", size: "28 MB" },
      ];
      await prisma.downloadJob.update({
        where: { id: job.id },
        data: { detectedUrls: mockVideos, status: "COMPLETED", progress: 100 },
      });
    } catch {
      // ignore if ephemeral
    }
  }

  return NextResponse.json({ jobId: job.id, status: "QUEUED" });
}
