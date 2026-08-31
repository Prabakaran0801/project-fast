import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const now = new Date();
    // Find all expired jobs with merged files
    const expiredJobs = await prisma.downloadJob.findMany({
      where: { expiresAt: { lt: now }, fileUrl: { contains: "/merged/" } },
      take: 100,
    });

    if (!expiredJobs.length) {
      console.log("[cleanup] no expired merged files to delete");
      return NextResponse.json({ deleted: 0, message: "No expired files" });
    }

    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const bucket = process.env.S3_BUCKET;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      console.warn("[cleanup] S3 not configured");
      return NextResponse.json({ error: "S3 not configured" }, { status: 500 });
    }

    const s3 = new S3Client({ region: process.env.S3_REGION || "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
    let deleted = 0;
    let failed = 0;

    for (const job of expiredJobs) {
      const fileUrl = job.fileUrl as string;
      let key: string | null = null;
      try {
        const u = new URL(fileUrl);
        key = u.pathname.replace(/^\//, "");
      } catch {
        const idx = fileUrl.indexOf("/merged/");
        if (idx !== -1) key = fileUrl.slice(idx + 1);
      }
      if (!key) continue;
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        console.log(`[r2] deleted expired ${key} for job ${job.id} (cleanup)`);
        deleted++;
        // Mark EXPIRED and clear fileUrl to avoid re-delete
        await prisma.downloadJob.update({ where: { id: job.id }, data: { status: "EXPIRED" } });
      } catch (e) {
        console.warn(`[r2] delete failed for job ${job.id} key ${key}`, String(e).slice(0, 200));
        failed++;
      }
    }

    console.log(`[cleanup] done — deleted ${deleted}, failed ${failed}, checked ${expiredJobs.length}`);
    return NextResponse.json({ deleted, failed, checked: expiredJobs.length });
  } catch (e) {
    console.error("[cleanup] error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
