import fs from "fs";
import path from "path";

// Ensure yt-dlp binary path is correct on Vercel Linux vs local Windows
// Vercel cwd is /var/task, binary is at node_modules/yt-dlp-exec/bin/yt-dlp (linux) not yt-dlp.exe
// yt-dlp-exec uses YOUTUBE_DL_PATH env to override. We set it at runtime if missing.
let ensured = false;
export function ensureYtDlpPath(): string | undefined {
  if (ensured) return process.env.YOUTUBE_DL_PATH;
  ensured = true;
  try {
    // if already set via env, keep it
    if (process.env.YOUTUBE_DL_PATH && fs.existsSync(process.env.YOUTUBE_DL_PATH)) {
      console.log(`[yt-dlp] using env YOUTUBE_DL_PATH=${process.env.YOUTUBE_DL_PATH}`);
      return process.env.YOUTUBE_DL_PATH;
    }
    const candidates = [
      path.join(process.cwd(), "node_modules/yt-dlp-exec/bin/yt-dlp"),
      path.join(process.cwd(), "node_modules/yt-dlp-exec/bin/yt-dlp.exe"),
      "/var/task/node_modules/yt-dlp-exec/bin/yt-dlp",
      "/var/task/node_modules/yt-dlp-exec/bin/yt-dlp.exe",
      // fallback to constants path
      require("yt-dlp-exec/src/constants").YOUTUBE_DL_PATH,
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          // ensure executable
          try { fs.chmodSync(p, 0o755); } catch {}
          process.env.YOUTUBE_DL_PATH = p;
          console.log(`[yt-dlp] ensured binary at ${p} platform=${process.platform}`);
          return p;
        }
      } catch {}
    }
    console.warn(`[yt-dlp] binary not found in candidates: ${candidates.join(", ")}`);
    // try direct download fallback - log for diagnostics
    // Do not throw, let yt-dlp-exec try default
  } catch (e) {
    console.warn(`[yt-dlp] ensure failed: ${String(e).slice(0, 200)}`);
  }
  return process.env.YOUTUBE_DL_PATH;
}
