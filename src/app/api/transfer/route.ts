import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { sendTransferEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/ratelimit";

const schema = z.object({
  files: z.array(z.object({ name: z.string(), size: z.number(), type: z.string().optional() })).min(1).max(20),
  emails: z.array(z.string().email()).max(5).optional(),
  message: z.string().max(500).optional(),
  fromEmail: z.string().email().optional(),
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

  const hasS3 = !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID);
  const uploadUrls = files.map((f) => ({
    filename: f.name,
    uploadUrl: hasS3 ? `https://s3.mock/${f.name}?presigned` : null,
  }));

  let expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  let dbId = transferId;

  try {
    const transfer = await prisma.transfer.create({
      data: {
        transferUrl: transferId,
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
  } catch {
    // DB not configured — keep mock ids
  }

  // Send emails via Nodemailer (if SMTP configured and recipients provided)
  let emailResults: any[] = [];
  if (allRecipients.length) {
    const emailFiles = files.map((f) => ({ name: f.name, size: f.size }));
    const results = await Promise.allSettled(
      allRecipients.map((to) =>
        sendTransferEmail({ to, transferUrl, files: emailFiles, expiresAt, message, fromEmail })
      )
    );
    emailResults = results.map((r, i) => ({
      to: allRecipients[i],
      status: r.status === "fulfilled" ? "sent" : "failed",
      error: r.status === "rejected" ? String((r as PromiseRejectedResult).reason) : undefined,
    }));
  }

  return NextResponse.json({ transferId: dbId, transferUrl, uploadUrls, expiresAt, emailResults });
}
