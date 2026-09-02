import { pickAllFormats } from "./utils/pickAllFormats";
import { ensureYtDlpPath, ensureYtDlpBinaryDownloaded } from "../ensureYtDlp";

export async function ytDlpGeneric(url: string, jobId: string): Promise<any[] | null> {
  ensureYtDlpPath();
  const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
  // For instagram, try cleaned URL without tracking params (igsi etc) on retry
  const urlsToTry = [url];
  try {
    const u = new URL(url);
    if (u.hostname.includes("instagram.com")) {
      u.search = "";
      const clean = u.toString();
      if (clean !== url) urlsToTry.push(clean);
    }
  } catch {}
  for (const tryUrl of urlsToTry) {
    for (const useFree of [true, false] as const) {
      try {
        const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true };
        if (useFree) (args as any).preferFreeFormats = true;
        const info: any = await ytdlp(tryUrl, args);
        const formats = pickAllFormats(info, 8);
        if (formats.length) {
          console.log(`[ytDlpGeneric] found ${formats.length} for ${jobId} ${tryUrl.slice(0,40)} ${useFree?"free":""}`);
          return formats;
        }
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 400);
        console.warn(`[ytDlpGeneric] failed for ${jobId} ${tryUrl.slice(0,40)} ${useFree?"free":""}`, msg.slice(0, 180));
        // retry once after 800ms for rate limit
        if (msg.includes("429") || msg.includes("rate") || msg.includes("Try again")) {
          await new Promise((r) => setTimeout(r, 900));
          try {
            const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true };
            const info2: any = await ytdlp(tryUrl, args);
            const fmts2 = pickAllFormats(info2, 8);
            if (fmts2.length) {
              console.log(`[ytDlpGeneric] retry found ${fmts2.length} for ${jobId}`);
              return fmts2;
            }
          } catch {}
        }
      }
    }
  }
  return null;
}
