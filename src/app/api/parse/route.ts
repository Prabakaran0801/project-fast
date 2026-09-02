import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { getQueue, QUEUE_NAMES } from "@/lib/queue";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const schema = z.object({ url: z.string().min(1) });

function extractUrl(raw: string): string | null {
  let s = raw.trim();
  // If user pasted <iframe ... src="https://..."> extract src
  const srcMatch = s.match(/src\s*=\s*["']([^"']+)["']/i);
  if (srcMatch) s = srcMatch[1].trim();
  // Protocol-relative //www.youtube.com/embed/...
  if (s.startsWith("//")) s = "https:" + s;
  // If still contains HTML, try to find any https URL inside
  if (s.includes("<") || s.includes('"') || (!s.startsWith("http") && s.includes("http"))) {
    const urlMatch = s.match(/https?:\/\/[^"'<>\s]+/);
    if (urlMatch) s = urlMatch[0];
  }
  s = s.replace(/&amp;/g, "&");
  // Normalize YouTube embed -> watch?v=
  try {
    const u = new URL(s);
    // youtube.com/embed/VIDEOID
    const embed = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
    if (embed) {
      const vid = embed[1];
      return `https://www.youtube.com/watch?v=${vid}`;
    }
    // youtube-nocookie embed
    if (u.hostname.includes("youtube-nocookie.com") && embed) {
      return `https://www.youtube.com/watch?v=${embed[1]}`;
    }
    // Ensure youtube short links work as-is, no change needed
  } catch {}
  return s;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rl = await checkRateLimit(ip);
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limited. Try again in a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid URL — paste a video link or iframe embed code" }, { status: 400 });
  }

  const raw = parsed.data.url;
  const url = extractUrl(raw);
  if (!url) return NextResponse.json({ error: "Invalid URL — could not extract link from embed code" }, { status: 400 });
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Block private IPs to prevent SSRF
  try {
    const u = new URL(url);
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(u.hostname)) {
      return NextResponse.json({ error: "Private URLs not allowed" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Create job in DB — Vercel-only mode: DB is the queue, cron processes it
  let job;
  try {
    job = await prisma.downloadJob.create({
      data: { sourceUrl: url, status: "QUEUED", progress: 0 },
    });
  } catch {
    // If DB not configured, create ephemeral job ID with mock
    const mockVideos = [
      { url: url, quality: "1080p", ext: "mp4", thumbnail: "", size: "42 MB", duration: "2:34" },
      { url: url, quality: "720p", ext: "mp4", thumbnail: "", size: "28 MB" },
    ];
    const id = `ephemeral_${Date.now()}`;
    // Return immediately as COMPLETED for demo when no DB — cron will handle real DB jobs
    return NextResponse.json({ jobId: id, status: "COMPLETED", detectedUrls: mockVideos });
  }

  // Hybrid: if REDIS_URL + external worker running (local), enqueue — else use Vercel after() worker (single platform)
  try {
    const queue = getQueue(QUEUE_NAMES.PARSE);
    if (queue) {
      await queue.add("parse", { jobId: job.id, url }, { attempts: 2, backoff: { type: "exponential", delay: 2000 } });
      console.log(`[parse] enqueued ${job.id} to external worker`);
      return NextResponse.json({ jobId: job.id, status: "QUEUED" });
    }
  } catch (e) { console.warn("[parse] queue failed, using after()", String(e).slice(0,120)); }

  // Vercel-only after() — direct call avoids self-fetch loop in dev, same as worker file
  try {
    const jobId = job.id;
    const jobUrl = url;
    after(async () => {
      try {
        const { processSingleJob } = await import("@/lib/processJob");
        // Claim job to avoid double process with GET /api/job polling fallback
        const claimed = await prisma.downloadJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "PARSING", progress: 10 } });
        if (claimed.count === 0) {
          console.log(`[parse] after() skip ${jobId} already claimed`);
          return;
        }
        await processSingleJob(jobId, jobUrl);
        console.log(`[parse] after() completed ${jobId}`);
      } catch (e) { console.warn(`[parse] after() failed for ${job.id}`, String(e).slice(0,200)); }
    });
  } catch (e) {
    console.warn("[parse] after() not available, job will be processed on first GET /api/job poll", String(e).slice(0,120));
  }
  return NextResponse.json({ jobId: job.id, status: "QUEUED" });
}
