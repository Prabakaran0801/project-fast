import { pickAllFormats } from "./utils/pickAllFormats";
import { getCookiesPath } from "./utils/cookies";
import { getYtDlpProxyArgs, getProxyUrl, getFetchDispatcher } from "./utils/proxy";
import { ensureYtDlpPath } from "../ensureYtDlp";

export async function youtubeHandler(url: string, jobId: string, existing: any[]): Promise<any[]> {
  ensureYtDlpPath();
  let best: any[] = existing;
  const cookiesPath = getCookiesPath(jobId);
  const proxyArgs = getYtDlpProxyArgs();
  const proxyUrl = getProxyUrl();
  if (proxyUrl) console.log(`[youtube] proxy ${proxyUrl.replace(/:[^:/@]+@/, "://***@")} for ${jobId}`);
  // Hobby: default+android to handle rate-limit, but tight timeouts to stay <9s
  const isHobbyFastPath = process.env.VERCEL === "1" || process.env.HOBBY_FAST_PATH === "1";
  const clients: readonly string[] = isHobbyFastPath ? (["default", "android"] as const) : (["default", "web", "android", "tv"] as const);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // yt-dlp auto-reads HTTP_PROXY/HTTPS_PROXY/ALL_PROXY from the environment. When we want to run WITHOUT a
  // proxy (the working default), we must strip them — otherwise a dead proxy in .env (402 Payment Required)
  // silently routes ALL yt-dlp traffic through it and the parse fails with youtube_blocked.
  const stripProxyEnv = () => {
    const next: Record<string, string | undefined> = { ...process.env };
    for (const k of ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "no_proxy", "NO_PROXY"]) delete next[k];
    return next;
  };
  // Hobby: try piped BEFORE yt-dlp (datacenter blocked) — saves 4s if piped succeeds
  if (isHobbyFastPath && best.length === 0) {
    try {
      const idMatch = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
      const vid = idMatch ? idMatch[1] : null;
      if (vid) {
        const pipedHosts = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de"];
        const pipedDispatcher = (() => { try { return getFetchDispatcher(); } catch { return undefined; } })();
        for (const host of pipedHosts) {
          try {
            const pipedOpts: any = { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(2000) };
            if (pipedDispatcher) pipedOpts.dispatcher = pipedDispatcher;
            const r = await fetch(`${host}/streams/${vid}`, pipedOpts);
            if (!r.ok) { console.warn(`[youtube] piped ${host} http ${r.status} for ${jobId}`); continue; }
            const pj: any = await r.json();
            const streams: any[] = [...(pj.videoStreams || []), ...(pj.audioStreams || [])];
            const mapped = streams.filter((s: any) => s.url).map((s: any) => ({ url: s.url, quality: s.quality || (s.height ? `${s.height}p` : "best"), height: s.height || parseInt(s.quality) || undefined, ext: (s.mimeType || "video/mp4").split("/")[1]?.split(";")[0] || "mp4", hasAudio: !!s.audioTrackName || s.mimeType?.includes("audio") || false, needsMerge: false, title: (pj.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video", size: s.bitrate ? `${(s.bitrate / 8000 / 1024).toFixed(1)} MB` : undefined, thumbnail: pj.thumbnailUrl || "" })).filter((v: any) => v.height).sort((a: any, b: any) => b.height - a.height).slice(0, 8);
            if (mapped.length) { best = mapped; console.log(`[youtube] piped ${host} found ${mapped.length} for ${jobId}`); break; }
          } catch (e) { console.warn(`[youtube] piped ${host} failed for ${jobId}`, String(e).slice(0,120)); }
        }
      }
    } catch (e) { console.warn(`[youtube] piped failed ${jobId}`, String(e).slice(0, 150)); }
    if (best.length) return best;
  }

  const runYtDlp = async (client: string, useFree: boolean, withCookies: boolean, withProxy: boolean): Promise<any> => {
    try {
      if (withCookies && !cookiesPath) {
        console.warn(`[ytdlp] no cookies available for ${jobId} — bot check likely`);
      }
      const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
      const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...(withProxy && proxyArgs.proxy ? { proxy: proxyArgs.proxy } : {}), ...(withCookies && cookiesPath ? { cookies: cookiesPath } : {}) };
      if (useFree) (args as any).preferFreeFormats = true;
      if (client !== "web" && client !== "default") args.extractorArgs = `youtube:player_client=${client}`;
      if (withProxy && proxyArgs.proxy) console.log(`[youtube] proxy ${String(proxyArgs.proxy).replace(/:[^:/@]+@/, "://***@")} for ${jobId}`);
      const opts = withProxy ? undefined : { env: stripProxyEnv(), extendEnv: false };
      const timeoutMs = isHobbyFastPath ? 2500 : 22000;
      return await Promise.race([
        ytdlp(url, args, opts),
        new Promise((_, rej) => setTimeout(() => rej(new Error("yt-dlp timeout")), timeoutMs)),
      ]);
    } catch (e: any) {
      return { __error: e };
    }
  };

  // Phase 1: no-proxy multi-client search (default first — returns 144p-2160p full catalog)
  // Hobby: only free=true to cut 50% calls (8s total vs 16s)
  const freeVariants: readonly boolean[] = isHobbyFastPath ? ([true] as const) : ([true, false] as const);
  for (const withCookies of [false, true] as const) {
    if (withCookies && !cookiesPath) continue;
    for (const client of clients) {
      for (const useFree of freeVariants) {
        const cur: any = await runYtDlp(client, useFree, withCookies, false);
        if (cur && !cur.__error) {
          try {
            const formats = pickAllFormats(cur, 8);
            if (formats.length > best.length) {
              best = formats;
              console.log(`[youtube] (${client}${withCookies ? " +cookies" : ""}${useFree ? " free" : ""}) found ${formats.length} for ${jobId} heights=${formats.map((f: any) => f.quality).join(",")}`);
            }
            if (best.length >= 4) break;
          } catch (e: any) {
            console.warn(`[youtube] (${client}${withCookies ? " +cookies" : ""}${useFree ? " free" : ""}) failed`, String((e as any)?.stderr || e?.message || e).slice(0, 300));
          }
        } else {
          const err: any = cur?.__error;
          const msg = String(err?.stderr || err?.message || "");
          if (msg.includes("429") || msg.includes("rate") || msg.includes("Too Many") || msg.includes("Try again") || msg.includes("bot") || msg.includes("Sign in")) {
            if (isHobbyFastPath) {
              // Hobby: skip 1.5s backoff to stay <10s, just log and try next client/piped
              console.warn(`[youtube] (${client}${useFree ? " free" : ""}) rate-limit for ${jobId} (Hobby skip backoff)`);
            } else {
              console.warn(`[youtube] (${client}${useFree ? " free" : ""}) rate-limit, backoff for ${jobId}`);
              await sleep(1500);
              const cur2: any = await runYtDlp(client, useFree, withCookies, false);
              if (cur2 && !cur2.__error) {
                try {
                  const formats = pickAllFormats(cur2, 8);
                  if (formats.length > best.length) {
                    best = formats;
                    console.log(`[youtube] (${client}${withCookies ? " +cookies" : ""}${useFree ? " free" : ""}) retry found ${formats.length} for ${jobId}`);
                  }
                  if (best.length >= 4) break;
                } catch {}
              }
            }
          } else {
            console.warn(`[youtube] (${client}${useFree ? " free" : ""}) no-proxy failed`, String(err?.stderr || err?.message || err).slice(0, 180));
          }
        }
      }
      if (best.length >= 4) break;
    }
    if (best.length >= 4) break;
  }

  // Phase 2 (last resort): proxy, only if direct failed. Dead proxy (402) is skipped, never throws.
  if (best.length === 0 && proxyUrl) {
    for (const withCookies of [false, true] as const) {
      if (withCookies && !cookiesPath) continue;
      for (const client of ["default", "web", "android", "tv"] as const) {
        for (const useFree of [true, false] as const) {
          const cur: any = await runYtDlp(client, useFree, withCookies, true);
          if (cur && !cur.__error) {
            try {
              const formats = pickAllFormats(cur, 8);
              if (formats.length > best.length) {
                best = formats;
                console.log(`[youtube] (${client} via proxy) found ${formats.length} for ${jobId}`);
              }
              if (best.length >= 4) break;
            } catch {}
          } else {
            const err: any = cur?.__error;
            const msg = String(err?.stderr || err?.message || "");
            if (msg.includes("402") || msg.includes("Payment Required")) {
              console.warn(`[youtube] proxy 402 Payment Required — skipping dead proxy for this job`);
              break;
            }
            console.warn(`[youtube] (${client} via proxy) failed`, msg.slice(0, 150));
          }
        }
        if (best.length >= 4) break;
      }
      if (best.length >= 4) break;
    }
  }
  // Hobby post-yt-dlp piped fallback (if yt-dlp failed even after piped-first, shouldn't happen)
  // This handles rare case where piped-first found nothing but yt-dlp also failed, try again quickly
  if (isHobbyFastPath && best.length === 0) {
    // already tried piped first at top, skip duplicate
  }
  // piped fallback if still empty — local: 3 hosts
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
  // ytdl-core fallback — skip on Hobby to stay <10s (needs network + decode)
  if (best.length === 0 && !isHobbyFastPath) {
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
