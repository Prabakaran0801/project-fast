import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { S3Client, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const dynamic = "force-dynamic";

// Vercel Cron calls GET with Authorization: Bearer $CRON_SECRET — allow both
function verifyCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret set -> allow (dev)
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!verifyCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // Also purge expired transfers (DB + R2) — complements R2 lifecycle
    let transferDeleted = 0;
    try {
      const expiredTransfers = await prisma.transfer.findMany({
        where: { expiresAt: { lt: now } },
        include: { files: true },
        take: 20,
      });
      for (const tr of expiredTransfers) {
        // Best-effort delete R2 keys for each file (batch)
        const keys = tr.files.map((f: any) => ({ Key: f.s3Key }));
        if (keys.length && bucket) {
          try {
            if (keys.length === 1) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: keys[0].Key }));
            else await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
          } catch (e) {
            console.warn(`[r2] transfer ${tr.transferUrl} delete batch failed`, String(e).slice(0, 150));
          }
        }
        await prisma.transfer.delete({ where: { id: tr.id } }).catch(() => {});
        transferDeleted++;
      }
      if (transferDeleted) console.log(`[cleanup] purged ${transferDeleted} expired transfers`);
    } catch (e) {
      console.warn("[cleanup] transfer purge failed", String(e).slice(0, 200));
    }

    console.log(`[cleanup] done — deleted ${deleted} merged, ${transferDeleted} transfers, failed ${failed}, checked ${expiredJobs.length}`);
    return NextResponse.json({ deleted, failed, checked: expiredJobs.length, transferDeleted });
  } catch (e) {
    console.error("[cleanup] error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
