import nodemailer from "nodemailer";
import path from "path";
import fs from "fs";

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

function formatGB(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function formatExpiry(date: Date) {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function getLogoAttachment() {
  try {
    const p = path.join(process.cwd(), "public", "logo.svg");
    if (fs.existsSync(p)) return [{ filename: "logo.svg", path: p, cid: "mediamover-logo", contentType: "image/svg+xml" }];
  } catch {}
  return [];
}

function cardHtml(opts: { headline: string; sub?: string; files: { name: string; size: number }[]; expiresAt: Date; transferUrl: string }) {
  const totalBytes = opts.files.reduce((a, f) => a + f.size, 0);
  const countMeta = `${opts.files.length} item${opts.files.length > 1 ? "s" : ""}, ${formatGB(totalBytes)} in total &nbsp;·&nbsp; <span style="color:#c0392b;font-weight:600;">Expires on ${formatExpiry(opts.expiresAt)}</span>`;
  const filesBoxes = opts.files
    .map(
      (f) => `
              <tr>
                <td style="padding:0 40px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafafa;border-radius:8px;border:1px solid #e0e0e0;">
                    <tr>
                      <td style="padding:16px 18px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td width="40" valign="middle">
                              <div style="width:36px;height:36px;background-color:#161616;border-radius:7px;text-align:center;line-height:36px;color:#ffffff;font-size:15px;">▶</div>
                            </td>
                            <td valign="middle" style="padding-left:12px;">
                              <p style="margin:0;font-size:14px;color:#161616;font-weight:600;word-break:break-all;">${f.name}</p>
                              <p style="margin:2px 0 0 0;font-size:12px;color:#959595;">${formatGB(f.size)} · 1 item</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    )
    .join("");

  const subHtml = opts.sub ? `<p style="margin:6px 0 0 0;font-size:12px;color:#959595;">${opts.sub}</p>` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>File Transfer</title></head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);border:1px solid #e0e0e0;">
        <tr>
          <td style="padding:26px 0;border-bottom:1px solid #e0e0e0;" align="center">
            <img src="cid:mediamover-logo" alt="Mediamover" width="28" height="28" style="vertical-align:middle;border-radius:6px;display:inline-block;" />
            <span style="font-size:16px;font-weight:700;color:#161616;vertical-align:middle;letter-spacing:0.3px;margin-left:8px;">Mediamover</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 4px 40px;">
            <p style="margin:0;font-size:12px;letter-spacing:1.5px;color:#161616;text-transform:uppercase;font-weight:700;">Secure Transfer</p>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 40px 20px 40px;">
            <p style="margin:0;font-size:17px;color:#161616;line-height:1.5;">${opts.headline}</p>
            ${subHtml}
          </td>
        </tr>
        ${filesBoxes}
        <tr>
          <td style="padding:16px 40px 0 40px;">
            <p style="margin:0;font-size:12.5px;color:#959595;">${countMeta}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 40px 0 40px;">
            <div style="border-top:1px solid #e0e0e0;"></div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 0 40px;">
            <p style="margin:0 0 5px 0;font-size:13px;color:#161616;font-weight:600;">Download link</p>
            <a href="${opts.transferUrl}" target="_blank" style="font-size:13px;color:#161616;text-decoration:underline;word-break:break-all;">${opts.transferUrl}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 8px 40px;" align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="background-color:#161616;border-radius:3px;" align="center">
                  <a href="${opts.transferUrl}" target="_blank" style="display:block;padding:14px 0;font-size:14.5px;font-weight:600;color:#ffffff;text-decoration:none;">Download file</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 28px 40px;" align="center">
            <p style="margin:0 0 10px 0;font-size:11px;color:#959595;">Sent via Mediamover Secure Transfer</p>
            <p style="margin:0;font-size:11px;color:#959595;line-height:1.6;">
              To make sure our emails arrive, please add
              <a href="mailto:noreply@mediamover.com" style="color:#161616;text-decoration:underline;">noreply@mediamover.com</a>
              to <a href="#" style="color:#161616;text-decoration:underline;">your contacts</a>.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
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
  const from = process.env.EMAIL_FROM || `Mediamover <${process.env.SMTP_USER}>`;
  const sender = opts.fromEmail || process.env.SMTP_USER!;
  const filesList = opts.files.map((f) => `${f.name} (${formatGB(f.size)})`).join(", ");
  const subject = `${sender} sent you ${opts.files.length === 1 ? opts.files[0].name : `${opts.files.length} files`} via Mediamover`;
  const personalizedUrl = `${opts.transferUrl}${opts.transferUrl.includes("?") ? "&" : "?"}to=${encodeURIComponent(opts.to)}`;
  const headline = `<strong>${sender}</strong> sent you a file`;
  const sub = opts.message ? opts.message.replace(/\n/g, "<br/>") : undefined;
  const html = cardHtml({ headline, sub, files: opts.files, expiresAt: opts.expiresAt, transferUrl: personalizedUrl });
  const personalizedUrl2 = `${opts.transferUrl}${opts.transferUrl.includes("?") ? "&" : "?"}to=${encodeURIComponent(opts.to)}`;
  const text = `From: ${sender}\nTo: ${opts.to}\n${sender} sent you ${filesList}\nDownload: ${personalizedUrl2}\nExpires: ${formatExpiry(opts.expiresAt)} (4-day)\n${opts.message || ""}`;

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
    replyTo: sender,
    attachments: getLogoAttachment(),
  });
  console.log("[email] sent", info.messageId, "to", opts.to);
  return { messageId: info.messageId };
}

export async function sendSenderConfirmation(opts: {
  to: string;
  transferUrl: string;
  files: { name: string; size: number }[];
  expiresAt: Date;
  recipient: string;
}) {
  const transporter = getTransporter();
  if (!transporter) return { skipped: true };
  const from = process.env.EMAIL_FROM || `Mediamover <${process.env.SMTP_USER}>`;
  const filesList = opts.files.map((f) => `${f.name} (${formatGB(f.size)})`).join(", ");
  const subject = `You sent ${opts.files.length === 1 ? opts.files[0].name : `${opts.files.length} files`} to ${opts.recipient} — sent successfully`;
  const headline = `You sent <strong>${opts.files[0]?.name || "files"}</strong> to ${opts.recipient}`;
  const html = cardHtml({ headline, files: opts.files, expiresAt: opts.expiresAt, transferUrl: opts.transferUrl });
  const text = `You sent ${filesList} to ${opts.recipient}\nLink: ${opts.transferUrl}\nExpires: ${formatExpiry(opts.expiresAt)}`;
  const info = await transporter.sendMail({ from, to: opts.to, subject, text, html, attachments: getLogoAttachment() });
  console.log("[email] sender confirmation", info.messageId, "to", opts.to);
  return { messageId: info.messageId };
}

export async function sendDownloadNotification(opts: {
  to: string;
  recipient: string;
  transferUrl: string;
  files: { name: string; size: number }[];
  expiresAt: Date;
}) {
  const transporter = getTransporter();
  if (!transporter) return { skipped: true };
  const from = process.env.EMAIL_FROM || `Mediamover <${process.env.SMTP_USER}>`;
  const firstName = opts.files[0]?.name || "files";
  const subject = `${opts.recipient} downloaded ${firstName}`;
  const headline = `<strong>${opts.recipient}</strong> downloaded ${firstName}`;
  const html = cardHtml({ headline, files: opts.files, expiresAt: opts.expiresAt, transferUrl: opts.transferUrl });
  const text = `${opts.recipient} downloaded ${firstName}\nLink: ${opts.transferUrl}\nExpires: ${formatExpiry(opts.expiresAt)}`;
  const info = await transporter.sendMail({ from, to: opts.to, subject, text, html, replyTo: opts.recipient, attachments: getLogoAttachment() });
  console.log("[email] download notification", info.messageId, "to", opts.to, "recipient", opts.recipient);
  return { messageId: info.messageId };
}
