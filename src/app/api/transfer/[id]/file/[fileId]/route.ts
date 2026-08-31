import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  try {
    const transfer = await prisma.transfer.findFirst({ where: { transferUrl: id }, include: { files: true } });
    if (!transfer || new Date(transfer.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Expired or not found" }, { status: 404 });
    }
    const file = transfer.files.find((f: any) => f.id === fileId);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

    // If R2 configured, redirect to presigned URL. In MVP, return file info and let client handle.
    // For now, return 302 to S3_PUBLIC_URL if set, otherwise JSON with s3Key
    const publicUrl = process.env.S3_PUBLIC_URL;
    if (publicUrl) {
      const url = `${publicUrl.replace(/\/$/, "")}/${file.s3Key}`;
      return NextResponse.redirect(url, 302);
    }
    // No R2 public URL — return info (in production you would generate presigned GET URL via @aws-sdk/s3-presigned)
    return NextResponse.json({ filename: file.filename, s3Key: file.s3Key, message: "Configure S3_PUBLIC_URL or presigned GET to enable direct download" });
  } catch (e) {
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
