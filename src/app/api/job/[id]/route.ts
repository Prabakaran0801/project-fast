import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

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
    const job = await prisma.downloadJob.findUnique({ where: { id } });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: "DB not configured. Set DATABASE_URL." }, { status: 503 });
  }
}
