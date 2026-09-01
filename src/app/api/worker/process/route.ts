import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { processSingleJob } from "@/lib/processJob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  // Allow internal after() calls without auth, plus cron Bearer
  if (auth === `Bearer ${secret}`) return true;
  // Internal call from after() will have no auth but same origin — allow if no secret check
  return !auth;
}

export async function POST(req: NextRequest) {
  // Internal worker triggered by after() — no auth needed, but cron also allowed
  if (!verifyCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const jobId = body.jobId as string | undefined;
  const url = body.url as string | undefined;

  if (jobId && url) {
    try {
      const job = await prisma.downloadJob.findUnique({ where: { id: jobId } });
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status !== "QUEUED" && job.status !== "PARSING") {
        return NextResponse.json({ status: job.status, message: "Already processed" });
      }
      await processSingleJob(jobId, url);
      return NextResponse.json({ ok: true, jobId });
    } catch (e) {
      console.error(`[worker] ${jobId} failed`, e);
      try { await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "FAILED" } }); } catch {}
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // Cron sweep: process up to 3 QUEUED jobs (once/day Hobby)
  const jobs = await prisma.downloadJob.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: 3 });
  if (!jobs.length) return NextResponse.json({ processed: 0 });
  let ok = 0;
  for (const j of jobs) {
    try { await processSingleJob(j.id, j.sourceUrl); ok++; } catch (e) { console.warn(`[worker] cron ${j.id} failed`, String(e).slice(0,150)); }
  }
  return NextResponse.json({ processed: ok, total: jobs.length });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
