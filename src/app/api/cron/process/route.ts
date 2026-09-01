import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { processSingleJob } from "@/lib/processJob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobs = await prisma.downloadJob.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: 3 });
  if (!jobs.length) return NextResponse.json({ processed: 0, message: "No queued jobs" });
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await processSingleJob(job.id, job.sourceUrl);
      processed++;
    } catch (err) {
      console.error(`[cron] ${job.id} failed`, err);
      try { await prisma.downloadJob.update({ where: { id: job.id }, data: { status: "FAILED" } }); } catch {}
      failed++;
    }
  }
  return NextResponse.json({ processed, failed, total: jobs.length });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
