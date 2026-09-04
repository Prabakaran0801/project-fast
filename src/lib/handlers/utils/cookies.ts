import fs from "fs";
import path from "path";

/**
 * Resolves a usable cookies.txt path for yt-dlp.
 * Priority: YTDLP_COOKIES env (Netscape format, written to /tmp) 
 *        -> YTDLP_COOKIES as literal path 
 *        -> local cookies.txt in project root
 */
export function getCookiesPath(jobId: string): string | undefined {
  const rawCookies = process.env.YTDLP_COOKIES || "";

  if (rawCookies.includes("# Netscape")) {
    try {
      const p = path.join("/tmp", `cookies-${jobId}.txt`);
      fs.writeFileSync(p, rawCookies);
      console.log(`[cookies] wrote YTDLP_COOKIES (${rawCookies.length} bytes) to ${p}`);
      return p;
    } catch (e: any) {
      console.error(`[cookies] failed to write cookies for ${jobId}: ${e?.message}`);
      return undefined;
    }
  }

  if (rawCookies) {
    if (fs.existsSync(rawCookies)) return rawCookies;
    console.warn(`[cookies] YTDLP_COOKIES set but not Netscape format and not a valid path`);
    return undefined;
  }

  const localPath = path.join(process.cwd(), "cookies.txt");
  if (fs.existsSync(localPath)) return localPath;

  console.warn(`[cookies] no cookies source found — YouTube requests will likely hit bot check`);
  return undefined;
}

export function getCookiesPathWorker(): string | undefined {
  const rawCookies = process.env.YTDLP_COOKIES || "";
  if (rawCookies.includes("# Netscape")) {
    const p = path.join("/tmp", `cookies-worker.txt`);
    try {
      fs.writeFileSync(p, rawCookies);
      return p;
    } catch {
      return undefined;
    }
  }
  if (rawCookies && fs.existsSync(rawCookies)) return rawCookies;
  const localPath = path.join(process.cwd(), "cookies.txt");
  return fs.existsSync(localPath) ? localPath : undefined;
}
