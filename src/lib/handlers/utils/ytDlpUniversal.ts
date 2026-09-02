import { pickAllFormats } from "./pickAllFormats";
import { getYtDlpProxyArgs, getProxyUrl } from "./proxy";
import { ensureYtDlpPath, ensureYtDlpBinaryDownloaded } from "../../ensureYtDlp";

// Universal yt-dlp — no per-site logic, no instagram URL cleaning, no youtube client args
// Used by universalHandler for X, TikTok, pornhub, missav, vimeo, etc.
export async function ytDlpUniversal(url: string, jobId: string): Promise<any[] | null> {
  ensureYtDlpPath();
  const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
  const proxyArgs = getYtDlpProxyArgs();
  const proxyUrl = getProxyUrl();
  if (proxyUrl) console.log(`[ytDlpUniversal] proxy ${proxyUrl.replace(/:[^:/@]+@/, "://***@")} for ${jobId}`);
  for (const useFree of [true, false] as const) {
    try {
      const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...proxyArgs };
      if (useFree) (args as any).preferFreeFormats = true;
      const info: any = await ytdlp(url, args);
      const formats = pickAllFormats(info, 8);
      if (formats.length) {
        console.log(`[ytDlpUniversal] found ${formats.length} for ${jobId} ${url.slice(0, 40)} ${useFree ? "free" : ""}`);
        return formats;
      }
    } catch (e: any) {
      let full = String((e as any)?.stderr || (e as any)?.shortMessage || e?.message || e).slice(0, 600);
      if (full.includes("python3") || full.includes("No such file")) {
        console.log(`[ytDlpUniversal] python missing, downloading standalone for ${jobId}`);
        const dl = await ensureYtDlpBinaryDownloaded();
        if (dl) {
          try {
            const ytdlp2: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
            const args2: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...proxyArgs };
            if (useFree) (args2 as any).preferFreeFormats = true;
            const info2: any = await ytdlp2(url, args2);
            const fmts2 = pickAllFormats(info2, 8);
            if (fmts2.length) {
              console.log(`[ytDlpUniversal] retry-standalone found ${fmts2.length} for ${jobId}`);
              return fmts2;
            }
          } catch (e2: any) {
            full = String((e2 as any)?.stderr || e2?.message || e2).slice(0, 600);
          }
        }
      }
      const msg = String(e?.message || e).slice(0, 400);
      // show full stderr for pornhub diagnostics (e.g. "Redirection detected; video may be deleted")
      console.warn(`[ytDlpUniversal] failed for ${jobId} ${url.slice(0, 40)} ${useFree ? "free" : ""}`, full.slice(0, 300));
      if (msg.includes("429") || msg.includes("rate") || msg.includes("Try again")) {
        await new Promise((r) => setTimeout(r, 900));
        try {
          const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...proxyArgs };
          const info2: any = await ytdlp(url, args);
          const fmts2 = pickAllFormats(info2, 8);
          if (fmts2.length) {
            console.log(`[ytDlpUniversal] retry found ${fmts2.length} for ${jobId}`);
            return fmts2;
          }
        } catch {}
      }
    }
  }
  return null;
}
