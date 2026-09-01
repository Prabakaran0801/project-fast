import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { processSingleJob } from "@/lib/processJob";

export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Handle ephemeral IDs (when DB not configured)
  if (id.startsWith("ephemeral_")) {
    return NextResponse.json({
      id,
      status: "COMPLETED",
      progress: 100,
      detectedUrls: [
        { url: "https://example.com/video.mp4", quality: "1080p", ext: "mp4", size: "42 MB", duration: "2:34" },
        { url: "https://example.com/video_720.mp4", quality: "720p", ext: "mp4", size: "28 MB" },
      ],
      fileUrl: null,
    });
  }

  try {
    let job = await prisma.downloadJob.findUnique({ where: { id } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    // Fallback inline if after() worker hasn't claimed job yet (Hobby without QStash)
    // after() in POST /api/parse triggers POST /api/worker/process in background
    if (job.status === "QUEUED") {
      try {
        // Guard against thundering herd: try to claim job via status PARSING
        const claimed = await prisma.downloadJob.updateMany({ where: { id, status: "QUEUED" }, data: { status: "PARSING", progress: 10 } });
        if (claimed.count > 0) {
          await processSingleJob(id, job.sourceUrl);
          job = (await prisma.downloadJob.findUnique({ where: { id } })) || job;
        } else {
          // Another request is already processing — return PARSING so frontend keeps polling
          job.status = "PARSING" as any;
          job.progress = 10;
          return NextResponse.json(job);
        }
      } catch (e) {
        console.warn(`[job] inline process failed for ${id}`, String(e).slice(0, 200));
        // Fall through to return current job state
      }
    }
    // Auto-expire for testing (1 min) — if expiresAt passed, mark EXPIRED and delete R2 /merged file
    const isExpiredTime = job.expiresAt && new Date(job.expiresAt) < new Date();
    if (isExpiredTime && job.status !== "EXPIRED") {
      try {
        await prisma.downloadJob.update({ where: { id }, data: { status: "EXPIRED" } });
        job.status = "EXPIRED" as any;
      } catch {}
    }
    // Delete R2 object if expired and it was a merged file (idempotent — safe to retry)
    if (isExpiredTime) {
      const fileUrl = (job as any).fileUrl as string | null;
      if (fileUrl && fileUrl.includes("/merged/")) {
        try {
          const endpoint = process.env.S3_ENDPOINT;
          const accessKeyId = process.env.S3_ACCESS_KEY_ID;
          const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
          const bucket = process.env.S3_BUCKET;
          if (endpoint && accessKeyId && secretAccessKey && bucket) {
            const s3 = new S3Client({ region: process.env.S3_REGION || "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
            // Extract key: https://pub-xxx.r2.dev/merged/... -> merged/...
            let key: string | null = null;
            try {
              const u = new URL(fileUrl);
              key = u.pathname.replace(/^\//, "");
            } catch {
              const idx = fileUrl.indexOf("/merged/");
              if (idx !== -1) key = fileUrl.slice(idx + 1);
            }
            if (key) {
              await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
              console.log(`[r2] deleted expired ${key} for job ${id}`);
            }
          }
        } catch (e) {
          console.warn(`[r2] delete failed for job ${id}`, String(e).slice(0, 200));
        }
      }
    }
    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: "DB not configured. Set DATABASE_URL." }, { status: 503 });
  }
}
