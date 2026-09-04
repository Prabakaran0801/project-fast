import fs from "fs";
import path from "path";
import os from "os";

function resolveCookieContent(raw: string): string | null {
  if (!raw) return null;
  if (raw.includes("# Netscape")) return raw;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    if (decoded.includes("# Netscape")) return decoded;
  } catch {}
  return null;
}

/**
 * Resolves a usable cookies.txt path for yt-dlp.
 * Priority: YTDLP_COOKIES env (Netscape raw or base64, written to /tmp)
 *        -> YTDLP_COOKIES as literal path
 *        -> local cookies.txt in project root
 * Vercel env text field can mangle tabs/newlines; base64 is safe.
 */
export function getCookiesPath(jobId: string): string | undefined {
  const rawCookies = process.env.YTDLP_COOKIES || "";
  const content = resolveCookieContent(rawCookies);

  if (content) {
    try {
      const p = path.join(os.tmpdir(), `cookies-${jobId}.txt`);
      fs.writeFileSync(p, content);
      console.log(`[cookies] wrote YTDLP_COOKIES (${content.length} bytes) to ${p}`);
      return p;
    } catch (e: any) {
      console.error(`[cookies] failed to write cookies for ${jobId}: ${e?.message}`);
      return undefined;
    }
  }

  if (rawCookies && fs.existsSync(/* turbopackIgnore: true */ rawCookies)) return rawCookies;
  if (rawCookies) {
    console.warn(`[cookies] YTDLP_COOKIES set but not valid Netscape/base64 and not a file path`);
    return undefined;
  }

  const localPath = path.join(process.cwd(), "cookies.txt");
  if (fs.existsSync(/* turbopackIgnore: true */ localPath)) return localPath;

  console.warn(`[cookies] no valid cookies source found for ${jobId} — YouTube may hit bot check`);
  return undefined;
}

export function getCookiesPathWorker(): string | undefined {
  const rawCookies = process.env.YTDLP_COOKIES || "";
  const content = resolveCookieContent(rawCookies);
  if (content) {
    const p = path.join(os.tmpdir(), `cookies-worker.txt`);
    try {
      fs.writeFileSync(p, content);
      return p;
    } catch {
      return undefined;
    }
  }
  if (rawCookies && fs.existsSync(/* turbopackIgnore: true */ rawCookies)) return rawCookies;
  const localPath = path.join(process.cwd(), "cookies.txt");
  return fs.existsSync(/* turbopackIgnore: true */ localPath) ? localPath : undefined;
}
