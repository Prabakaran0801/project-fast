import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { isYoutube } from "@/lib/handlers";
import { runOneYoutubeStep } from "@/lib/handlers/youtubeStepper";
import { processSingleJob } from "@/lib/processJob";

export const maxDuration = 10;

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
    // Hobby fix: stale PARSING auto-reset + ensure we never return 500 HTML (causes SyntaxError An error o on frontend)
    // Use 12s so first retry happens after Vercel's 10s kill + next poll
    if (job.status === "PARSING") {
      const staleMs = Date.now() - new Date(job.updatedAt).getTime();
      if (staleMs > 12 * 1000) {
        console.warn(`[job] stale PARSING ${id} ${Math.round(staleMs/1000)}s → reset to QUEUED for retry`);
        try { await prisma.downloadJob.update({ where: { id }, data: { status: "QUEUED", progress: 0 } }); job.status = "QUEUED" as any; job.progress = 0; } catch (e) { console.warn(`[job] stale reset failed for ${id}`, String(e).slice(0,100)); }
      }
    }
    // Fallback inline if after() worker hasn't claimed job yet (Hobby without QStash)
    // after() in POST /api/parse triggers POST /api/worker/process in background
    if (job.status === "QUEUED") {
      const claimed = await prisma.downloadJob.updateMany({
        where: { id, status: "QUEUED" },
        data: { status: "PARSING", progress: 10, attemptIndex: 0, partialFormats: [] },
      });
      if (claimed.count > 0) {
        job.status = "PARSING" as any;
        job.progress = 10;
        (job as any).attemptIndex = 0;
        (job as any).partialFormats = [];
      } else {
        // Another poll already claimed it
        job.status = "PARSING" as any;
      }
    }

    if (job.status === "PARSING") {
      if (!isYoutube(job.sourceUrl)) {
        // Non-YouTube: keep existing fast-path full processSingleJob (typically quick)
        try {
          await processSingleJob(id, job.sourceUrl);
          job = (await prisma.downloadJob.findUnique({ where: { id } })) || job;
        } catch (e: any) {
          console.error(`[job] processSingleJob failed for ${id}`, String(e?.message || e).slice(0, 300));
          try { await prisma.downloadJob.update({ where: { id }, data: { status: "FAILED", progress: 100, detectedUrls: [{ url: job.sourceUrl, quality: "auto", ext: "mp4", thumbnail: "", hasAudio: false, needsMerge: false, _failed: true, error: "blocked_or_unsupported" } as any] } }); job = (await prisma.downloadJob.findUnique({ where: { id } })) || job; } catch {}
        }
      } else {
        // YouTube: advance exactly one step this poll — atomic claim via attemptIndex to avoid overlapping polls race
        const currentIndex = (job as any).attemptIndex ?? 0;
        const currentPartial = ((job as any).partialFormats as any[]) ?? [];

        // Claim this step atomically — only proceed if no other in-flight request has advanced past currentIndex
        const claim = await prisma.downloadJob.updateMany({
          where: { id, attemptIndex: currentIndex, status: "PARSING" },
          data: { attemptIndex: currentIndex },
        });
        if (claim.count === 0) {
          // Another concurrent poll already advanced this job
          return NextResponse.json(job);
        }

        try {
          const { formats, nextStepIndex, done } = await runOneYoutubeStep(
            job.sourceUrl,
            id,
            currentIndex,
            currentPartial
          );

          if (done) {
            const isFailed = formats.length === 0;
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
            const finalFormats = isFailed
              ? [{
                  url: job.sourceUrl, quality: "auto", ext: "mp4", thumbnail: "",
                  hasAudio: false, needsMerge: false, title: "video",
                  _failed: true, error: "youtube_blocked",
                } as any]
              : formats;

            await prisma.downloadJob.updateMany({
              where: { id, attemptIndex: currentIndex },
              data: { status: isFailed ? "FAILED" : "COMPLETED", progress: 100, detectedUrls: finalFormats, expiresAt, attemptIndex: nextStepIndex } as any,
            });
            job = (await prisma.downloadJob.findUnique({ where: { id } })) || job;
          } else {
            const progressPct = Math.min(80, 10 + nextStepIndex * 12);
            await prisma.downloadJob.updateMany({
              where: { id, attemptIndex: currentIndex },
              data: { attemptIndex: nextStepIndex, partialFormats: formats, progress: progressPct } as any,
            });
            job = (await prisma.downloadJob.findUnique({ where: { id } })) || job;
          }
        } catch (e: any) {
          console.warn(`[job] stepper failed for ${id} step ${currentIndex}`, String(e?.message || e).slice(0, 200));
        }
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
