import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";

const schema = z.object({
  files: z.array(z.object({ name: z.string(), size: z.number(), type: z.string().optional() })).min(1).max(20),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid files" }, { status: 400 });

  const transferId = Math.random().toString(36).slice(2, 8);
  const transferUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin}/d/${transferId}`;

  // If S3 is configured, return presigned URLs for direct upload (mocked in MVP)
  const hasS3 = !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID);
  const uploadUrls = parsed.data.files.map((f) => ({
    filename: f.name,
    // In production: generate presigned POST via @aws-sdk/s3-presigned-post
    uploadUrl: hasS3 ? `https://s3.mock/${f.name}?presigned` : null,
  }));

  try {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const transfer = await prisma.transfer.create({
      data: {
        transferUrl: transferId,
        expiresAt,
        files: {
          create: parsed.data.files.map((f) => ({
            filename: f.name,
            s3Key: `transfers/${transferId}/${f.name}`,
            size: BigInt(f.size),
            mimeType: f.type || "application/octet-stream",
          })),
        },
      },
    });
    return NextResponse.json({ transferId: transfer.id, transferUrl, uploadUrls, expiresAt });
  } catch {
    // DB not configured — return mock
    return NextResponse.json({ transferId, transferUrl, uploadUrls, expiresAt: new Date(Date.now() + 7 * 86400000) });
  }
}
