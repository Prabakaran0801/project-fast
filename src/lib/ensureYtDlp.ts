import fs from "fs";
import path from "path";

// Ensure yt-dlp binary path is correct on Vercel Linux vs local Windows
// Vercel cwd is /var/task or /ROOT, binary is at node_modules/yt-dlp-exec/bin/yt-dlp (linux) not yt-dlp.exe
// yt-dlp-exec uses YOUTUBE_DL_PATH env to override. We set it at runtime if missing.
// CRITICAL: yt-dlp-exec caches binaryPath at first require (create(require('./constants').YOUTUBE_DL_PATH))
// so we must patch require cache on warm lambdas.
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
    // include /ROOT variant seen on Vercel (cwd /ROOT in logs) + standalone linux binary (no python needed)
    const candidates = [
      path.join(process.cwd(), "node_modules/yt-dlp-exec/bin/yt-dlp_linux"),
      path.join(process.cwd(), "node_modules/yt-dlp-exec/bin/yt-dlp"),
      path.join(process.cwd(), "node_modules/yt-dlp-exec/bin/yt-dlp.exe"),
      "/var/task/node_modules/yt-dlp-exec/bin/yt-dlp_linux",
      "/var/task/node_modules/yt-dlp-exec/bin/yt-dlp",
      "/var/task/node_modules/yt-dlp-exec/bin/yt-dlp.exe",
      "/ROOT/node_modules/yt-dlp-exec/bin/yt-dlp_linux",
      "/ROOT/node_modules/yt-dlp-exec/bin/yt-dlp",
      "/ROOT/node_modules/yt-dlp-exec/bin/yt-dlp.exe",
      path.join(__dirname, "../../node_modules/yt-dlp-exec/bin/yt-dlp_linux"),
      path.join(__dirname, "../../node_modules/yt-dlp-exec/bin/yt-dlp"),
      // fallback to constants path
      (() => { try { return require("yt-dlp-exec/src/constants").YOUTUBE_DL_PATH; } catch { return undefined; } })() as string,
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          // ensure executable
          try { fs.chmodSync(p, 0o755); } catch {}
          process.env.YOUTUBE_DL_PATH = p;
          // also patch already-loaded constants module so subsequent yt-dlp-exec calls use correct path even if cached
          try {
            const c: any = require("yt-dlp-exec/src/constants");
            if (c) { c.YOUTUBE_DL_PATH = p; c.YOUTUBE_DL_DIR = path.dirname(p); }
          } catch {}
          // patch main module's cached binaryPath by clearing cache and re-creating
          try {
            delete require.cache[require.resolve("yt-dlp-exec/src/index.js")];
            delete require.cache[require.resolve("yt-dlp-exec")];
          } catch {}
          console.log(`[yt-dlp] ensured binary at ${p} platform=${process.platform} cwd=${process.cwd()}`);
          return p;
        }
      } catch {}
    }
    console.warn(`[yt-dlp] binary not found in candidates: ${candidates.join(", ")}`);
    // Try to use python fallback if available (Vercel rarely has python3, but check)
    try {
      const { execSync } = require("child_process");
      const py = (() => {
        try { execSync("python3 --version", { stdio: "ignore" }); return "python3"; } catch {}
        try { execSync("python --version", { stdio: "ignore" }); return "python"; } catch {}
        return null;
      })();
      if (py) console.log(`[yt-dlp] python found: ${py}, will try yt-dlp script`);
    } catch {}
  } catch (e) {
    console.warn(`[yt-dlp] ensure failed: ${String(e).slice(0, 200)}`);
  }
  return process.env.YOUTUBE_DL_PATH;
}

// Also try to download yt-dlp_linux at build time if missing (for Vercel)
// This is called at runtime if binary still missing and tries to fetch standalone
export async function ensureYtDlpBinaryDownloaded(): Promise<string | undefined> {
  const existing = ensureYtDlpPath();
  if (existing) return existing;
  // Try to download yt-dlp_linux to /tmp (writable on Vercel)
  const tmpPath = path.join("/tmp", "yt-dlp_linux");
  try {
    if (fs.existsSync(tmpPath)) {
      try { fs.chmodSync(tmpPath, 0o755); } catch {}
      process.env.YOUTUBE_DL_PATH = tmpPath;
      console.log(`[yt-dlp] using cached /tmp binary at ${tmpPath}`);
      return tmpPath;
    }
    console.log(`[yt-dlp] downloading standalone yt-dlp_linux to ${tmpPath}...`);
    const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpPath, buf, { mode: 0o755 });
    try { fs.chmodSync(tmpPath, 0o755); } catch {}
    process.env.YOUTUBE_DL_PATH = tmpPath;
    try {
      const c: any = require("yt-dlp-exec/src/constants");
      if (c) { c.YOUTUBE_DL_PATH = tmpPath; c.YOUTUBE_DL_DIR = "/tmp"; }
    } catch {}
    try {
      delete require.cache[require.resolve("yt-dlp-exec/src/index.js")];
      delete require.cache[require.resolve("yt-dlp-exec")];
    } catch {}
    console.log(`[yt-dlp] downloaded standalone binary ${buf.length} bytes to ${tmpPath}`);
    return tmpPath;
  } catch (e: any) {
    console.warn(`[yt-dlp] download failed: ${String(e?.message || e).slice(0, 300)}`);
    return undefined;
  }
}
