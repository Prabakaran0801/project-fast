import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { sendTransferEmail, sendSenderConfirmation } from "@/lib/email";
import { checkRateLimit } from "@/lib/ratelimit";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const schema = z.object({
  files: z.array(z.object({ name: z.string(), size: z.number(), type: z.string().optional() })).min(1).max(20),
  emails: z.array(z.string().email()).max(5).min(1, "At least one recipient required"),
  message: z.string().max(500).optional(),
  fromEmail: z.string().email({ message: "Sender email required" }),
  sendCopy: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
  const rl = await checkRateLimit(`transfer:${ip}`);
  if (!rl.success) return NextResponse.json({ error: "Rate limited. Try again later." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid files", details: parsed.error.issues }, { status: 400 });

  const { files, emails, message, fromEmail, sendCopy } = parsed.data;
  const allRecipients = [...(emails || [])];
  if (sendCopy && fromEmail && !allRecipients.includes(fromEmail)) allRecipients.push(fromEmail);

  const transferId = Math.random().toString(36).slice(2, 8);
  const transferUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin}/d/${transferId}`;

  // R2 presigned PUT for direct browser → R2 (501 on POST, so use PUT — bypasses server, 5GB, free egress)
  let uploadUrls: any[] = [];
  const s3Ready = !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY && process.env.S3_ENDPOINT);
  if (s3Ready) {
    try {
      const s3 = new S3Client({
        region: process.env.S3_REGION || "auto",
        endpoint: process.env.S3_ENDPOINT!,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
        // Disable checksum so presigned PUT doesn't require x-amz-checksum-crc32 header (R2 501 fix)
        requestChecksumCalculation: "WHEN_REQUIRED" as any,
        responseChecksumValidation: "WHEN_REQUIRED" as any,
      });
      const bucket = process.env.S3_BUCKET!;
      uploadUrls = await Promise.all(
        files.map(async (f) => {
          const key = `transfers/${transferId}/${f.name}`;
          const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: f.type || "application/octet-stream" } as any), { expiresIn: 3600, checksumAlgorithm: undefined as any } as any);
          return { filename: f.name, key, uploadUrl: url, method: "PUT" as const };
        })
      );
    } catch (e) {
      console.warn("[transfer] presigned PUT failed, fallback to mock", String(e).slice(0, 200));
      uploadUrls = files.map((f) => ({ filename: f.name, key: `transfers/${transferId}/${f.name}`, uploadUrl: null }));
    }
  } else {
    uploadUrls = files.map((f) => ({ filename: f.name, key: `transfers/${transferId}/${f.name}`, uploadUrl: null }));
  }

  let expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  let dbId = transferId;

  try {
    const transfer = await prisma.transfer.create({
      data: {
        transferUrl: transferId,
        senderEmail: fromEmail,
        expiresAt,
        files: {
          create: files.map((f) => ({
            filename: f.name,
            s3Key: `transfers/${transferId}/${f.name}`,
            size: BigInt(f.size),
            mimeType: f.type || "application/octet-stream",
          })),
        },
      },
    });
    dbId = transfer.id;
    expiresAt = transfer.expiresAt;
    console.log(`[transfer] created ${transferId} with ${files.length} files, presigned ${uploadUrls.length} URLs sender=${fromEmail}`);
  } catch (e) {
    console.warn("[transfer] DB create failed, using mock", String(e).slice(0, 200));
  }

  // Send emails via Nodemailer — receiver WeTransfer style + sender confirmation
  let emailResults: any[] = [];
  if (allRecipients.length) {
    const emailFiles = files.map((f) => ({ name: f.name, size: f.size }));
    const receiverResults = await Promise.allSettled(
      allRecipients.map((to) =>
        sendTransferEmail({ to, transferUrl, files: emailFiles, expiresAt, message, fromEmail: fromEmail! })
      )
    );
    emailResults = receiverResults.map((r, i) => ({
      to: allRecipients[i],
      status: r.status === "fulfilled" ? "sent" : "failed",
      error: r.status === "rejected" ? String((r as PromiseRejectedResult).reason) : undefined,
    }));
    // Sender confirmation (your transfer sent successfully with file name)
    if (fromEmail && !allRecipients.includes(fromEmail)) {
      try {
        const c = await sendSenderConfirmation({ to: fromEmail, transferUrl, files: emailFiles, expiresAt, recipient: emails![0] || allRecipients[0] });
        emailResults.push({ to: fromEmail, status: "sent", note: "sender confirmation", messageId: (c as any).messageId });
      } catch (e) {
        emailResults.push({ to: fromEmail, status: "failed", error: String(e) });
      }
    } else if (fromEmail) {
      // fromEmail already in recipients, add confirmation note
      emailResults.push({ to: fromEmail, status: "sent", note: "sender confirmation (already recipient)" });
    }
  }

  console.log(`[transfer] ${transferId} emailResults:`, emailResults.map((r: any) => `${r.to}:${r.status}`).join(", "));
  return NextResponse.json({ transferId: dbId, transferUrl, uploadUrls, expiresAt, emailResults });
}
