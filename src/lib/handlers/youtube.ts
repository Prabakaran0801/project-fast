import { pickAllFormats } from "./utils/pickAllFormats";
import { getCookiesPath } from "./utils/cookies";
import { getYtDlpProxyArgs, getProxyUrl, getFetchDispatcher } from "./utils/proxy";
import { ensureYtDlpPath, ensureYtDlpBinaryDownloaded } from "../ensureYtDlp";

export async function youtubeHandler(url: string, jobId: string, existing: any[]): Promise<any[]> {
  ensureYtDlpPath();
  let best: any[] = existing;
  const cookiesPath = getCookiesPath(jobId);
  const proxyArgs = getYtDlpProxyArgs();
  const proxyUrl = getProxyUrl();
  if (proxyUrl) console.log(`[youtube] proxy ${proxyUrl.replace(/:[^:/@]+@/, "://***@")} for ${jobId}`);
  const clients = ["web", "android", "ios", "tv"] as const;
  for (const withCookies of [false, true] as const) {
    if (withCookies && !cookiesPath) continue;
    for (const client of clients) {
      for (const useFree of [true, false] as const) {
        try {
          const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
          const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...proxyArgs, ...(withCookies ? { cookies: cookiesPath! } : {}) };
          if (useFree) (args as any).preferFreeFormats = true;
          if (client !== "web") args.extractorArgs = `youtube:player_client=${client}`;
          const info: any = await ytdlp(url, args);
          const formats = pickAllFormats(info, 8);
          if (formats.length > best.length) {
            best = formats;
            console.log(`[youtube] (${client}${withCookies ? " +cookies" : ""}${useFree ? " free" : ""}) found ${formats.length} for ${jobId} heights=${formats.map((f: any) => f.quality).join(",")}`);
          }
          if (best.length >= 4) break;
        } catch (e: any) {
          let full = String((e as any)?.stderr || (e as any)?.shortMessage || e?.message || e).slice(0, 600);
          // If python missing, try downloading standalone yt-dlp_linux and retry once
          if (full.includes("python3") || full.includes("No such file")) {
            console.log(`[youtube] python missing, trying standalone download for ${jobId}`);
            const dl = await ensureYtDlpBinaryDownloaded();
            if (dl) {
              try {
                const ytdlp2: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
                const args2: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...proxyArgs, ...(withCookies ? { cookies: cookiesPath! } : {}) };
                if (useFree) (args2 as any).preferFreeFormats = true;
                if (client !== "web") args2.extractorArgs = `youtube:player_client=${client}`;
                const info2: any = await ytdlp2(url, args2);
                const fmts2 = pickAllFormats(info2, 8);
                if (fmts2.length) {
                  console.log(`[youtube] (${client} retry-standalone) found ${fmts2.length} for ${jobId}`);
                  if (fmts2.length > best.length) best = fmts2;
                  if (best.length >= 4) break;
                  continue;
                }
              } catch (e2: any) {
                full = String((e2 as any)?.stderr || e2?.message || e2).slice(0, 600);
              }
            }
          }
          console.warn(`[youtube] (${client}${withCookies ? " +cookies" : ""}${useFree ? " free" : ""}) failed`, full.slice(0, 350));
        }
      }
      if (best.length >= 4) break;
    }
    if (best.length >= 4) break;
  }
  // piped fallback if still empty
  if (best.length === 0) {
    try {
      const idMatch = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
      const vid = idMatch ? idMatch[1] : null;
      if (vid) {
        const pipedHosts = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de", "https://pipedapi.syncpundit.io"];
        const pipedDispatcher = (() => { try { return getFetchDispatcher(); } catch { return undefined; } })();
        for (const host of pipedHosts) {
          try {
            const pipedOpts: any = { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(7000) };
            if (pipedDispatcher) pipedOpts.dispatcher = pipedDispatcher;
            const r = await fetch(`${host}/streams/${vid}`, pipedOpts);
            if (!r.ok) continue;
            const pj: any = await r.json();
            const streams: any[] = [...(pj.videoStreams || []), ...(pj.audioStreams || [])];
            const mapped = streams
              .filter((s: any) => s.url)
              .map((s: any) => ({
                url: s.url,
                quality: s.quality || (s.height ? `${s.height}p` : "best"),
                height: s.height || parseInt(s.quality) || undefined,
                ext: (s.mimeType || "video/mp4").split("/")[1]?.split(";")[0] || "mp4",
                hasAudio: !!s.audioTrackName || s.mimeType?.includes("audio") || false,
                needsMerge: false,
                title: (pj.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video",
                size: s.bitrate ? `${(s.bitrate / 8000 / 1024).toFixed(1)} MB` : undefined,
                thumbnail: pj.thumbnailUrl || "",
              }))
              .filter((v: any) => v.height)
              .sort((a: any, b: any) => b.height - a.height)
              .slice(0, 8);
            if (mapped.length) {
              best = mapped;
              console.log(`[youtube] piped ${host} found ${mapped.length} for ${jobId}`);
              break;
            }
          } catch {}
        }
      }
    } catch (e) {
      console.warn(`[youtube] piped failed ${jobId}`, String(e).slice(0, 150));
    }
  }
  // ytdl-core fallback
  if (best.length === 0) {
    try {
      const ytdl: any = await import("@distube/ytdl-core").then((m: any) => m.default || m);
      const info = await (ytdl as any).getInfo(url);
      const formats = (ytdl as any).filterFormats(info.formats, "videoandaudio");
      const title2 = (info.videoDetails.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";
      const best2 = formats
        .filter((f: any) => f.url)
        .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))
        .slice(0, 6)
        .map((f: any) => ({
          url: f.url,
          quality: f.qualityLabel || (f.height ? `${f.height}p` : "best"),
          height: f.height,
          ext: f.container || "mp4",
          hasAudio: true,
          needsMerge: false,
          title: title2,
          size: f.contentLength ? `${(Number(f.contentLength) / 1024 / 1024).toFixed(1)} MB` : undefined,
          thumbnail: info.videoDetails.thumbnails?.[0]?.url || "",
        }));
      if (best2.length) best = best2;
    } catch (e) {
      console.warn(`[youtube] ytdl-core failed ${jobId}`, String(e).slice(0, 150));
    }
  }
  return best;
}
