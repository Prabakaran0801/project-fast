import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export async function sendTransferEmail(opts: {
  to: string;
  transferUrl: string;
  files: { name: string; size: number }[];
  expiresAt: Date;
  message?: string;
  fromEmail?: string;
}) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP not configured, skipping send to", opts.to);
    return { skipped: true };
  }
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER!;
  const filesList = opts.files.map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`).join(", ");
  const subject = `Files via SpeedDL: ${opts.files.length} file(s) shared`;
  const html = `
    <div style="font-family: ui-monospace, SFMono-Regular, monospace; max-width: 560px; margin: 0 auto; background: #fcfcfc; border: 1px solid #e8e8ea; border-radius: 16px; overflow: hidden;">
      <div style="background: #0a0a0b; color: #fff; padding: 20px 24px;">
        <div style="font-size: 12px; letter-spacing: 0.14em; opacity: 0.7;">SPEEDDL • SECURE TRANSFER</div>
        <div style="font-size: 20px; font-weight: 600; margin-top: 6px; letter-spacing: -0.02em;">Your files are ready to download</div>
      </div>
      <div style="padding: 24px; background: #fff;">
        <p style="font-size: 14px; color: #18181b; line-height: 1.6; margin: 0 0 12px;">${opts.message ? opts.message.replace(/\n/g, "<br/>") : "Someone shared files with you via SpeedDL."}</p>
        <p style="font-size: 12px; font-family: monospace; color: #71717a; margin: 0 0 16px;">${filesList}</p>
        <a href="${opts.transferUrl}" style="display: inline-block; background: #0a0a0b; color: #fff; padding: 12px 20px; border-radius: 999px; text-decoration: none; font-size: 13px; font-weight: 500;">Download files →</a>
        <p style="font-size: 12px; color: #71717a; margin: 16px 0 0;">Link: <a href="${opts.transferUrl}" style="color: #0a0a0b;">${opts.transferUrl}</a></p>
        <p style="font-size: 11px; font-family: monospace; color: #9f9fa9; margin-top: 12px;">Expires: ${opts.expiresAt.toLocaleString()} • 7-day auto-delete</p>
        ${opts.fromEmail ? `<p style="font-size: 12px; color: #71717a; margin-top: 12px;">From: ${opts.fromEmail}</p>` : ""}
      </div>
      <div style="padding: 12px 24px; background: #f4f4f5; font-size: 11px; font-family: monospace; color: #71717a; text-align: center;">No secrets in frontend • Sent via Nodemailer • SpeedDL</div>
    </div>
  `;
  const text = `Your files are ready: ${opts.transferUrl}\nFiles: ${filesList}\nExpires: ${opts.expiresAt.toLocaleString()}\n${opts.message || ""}`;

  try {
    await transporter.verify();
  } catch (e) {
    console.error("[email] transporter verify failed", e);
  }

  const info = await transporter.sendMail({
    from,
    to: opts.to,
    subject,
    text,
    html,
    replyTo: opts.fromEmail || undefined,
  });
  console.log("[email] sent", info.messageId, "to", opts.to);
  return { messageId: info.messageId };
}
