import fs from "fs";
import path from "path";

export function getCookiesPath(jobId: string): string | undefined {
  const rawCookies = process.env.YTDLP_COOKIES || "";
  if (rawCookies && rawCookies.includes("# Netscape")) {
    try {
      const p = path.join("/tmp", `cookies-${jobId}.txt`);
      fs.writeFileSync(p, rawCookies);
      console.log(`[cookies] wrote YTDLP_COOKIES to ${p}`);
      return p;
    } catch {}
  } else if (rawCookies) return rawCookies;
  else if (fs.existsSync(path.join(process.cwd(), "cookies.txt"))) return path.join(process.cwd(), "cookies.txt");
  return undefined;
}

// worker variant (simpler, no tmp write)
export function getCookiesPathWorker(): string | undefined {
  return process.env.YTDLP_COOKIES || (fs.existsSync(path.join(process.cwd(), "cookies.txt")) ? path.join(process.cwd(), "cookies.txt") : undefined);
}
