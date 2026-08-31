import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendDownloadNotification } from "@/lib/email";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  try {
    const transfer = await prisma.transfer.findFirst({ where: { transferUrl: id }, include: { files: true } });
    if (!transfer || new Date(transfer.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Expired or not found" }, { status: 404 });
    }
    const file = transfer.files.find((f: any) => f.id === fileId);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

    // Fire download notification to sender with actual downloader email (from ?to=) instead of Someone (::1)
    const senderEmail = (transfer as any).senderEmail as string | null;
    if (senderEmail) {
      const ip = _req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const downloaderEmail = _req.nextUrl.searchParams.get("to") || _req.headers.get("x-downloader-email") || "";
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const recipient = downloaderEmail && emailRegex.test(downloaderEmail) ? downloaderEmail : `Someone (${ip})`;
      const filesForMail = transfer.files.map((f: any) => ({ name: f.filename, size: Number(f.size) }));
      // Don't await — send in background
      console.log(`[download] ${file.filename} downloaded by ${recipient} — notifying sender ${senderEmail}`);
      sendDownloadNotification({
        to: senderEmail,
        recipient,
        transferUrl: `${process.env.NEXT_PUBLIC_SITE_URL || _req.nextUrl.origin}/d/${transfer.transferUrl}`,
        files: filesForMail,
        expiresAt: transfer.expiresAt,
      }).then(() => console.log(`[email] download notify sent to sender ${senderEmail} for ${file.filename} by ${recipient}`)).catch((e) => console.warn("[email] download notify failed", String(e).slice(0, 200)));
    }

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
