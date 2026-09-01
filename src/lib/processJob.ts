import * as cheerio from "cheerio";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";

function pickAllFormats(info: any, max = 8) {
  let formats: any[] = (info.formats || []).filter((f:any)=>f.url && f.vcodec!=="none");
  if (!formats.length) formats = (info.formats || []).filter((f:any)=>f.url); // fallback include audio-only if no video
  const byHeight = new Map<string, any>();
  for (const f of formats) {
    const key = f.height ? `${f.height}p` : (f.format_note || f.qualityLabel || f.format_id || "auto");
    if (key==="Default" || key==="low" || key.includes("DRC")) continue; // skip audio-only/label noise for jNQX
    const isHls = f.protocol==="m3u8" || f.protocol==="m3u8_native" || String(f.url).includes(".m3u8");
    const score = (x:any)=> (x.acodec!=="none"?3:0)+(x.ext==="mp4"?2:0)+(isHls? -2:0)+(x.height||0)/1000;
    const existing = byHeight.get(key);
    if (!existing || score(f) > score(existing)) byHeight.set(key, f);
  }
  let pool = Array.from(byHeight.values()).sort((a,b)=>(b.height||0)-(a.height||0)).slice(0,max);
  if (!pool.length) pool = formats.filter((f:any)=>f.height).slice(0,max);
  if (!pool.length) pool = formats.slice(0,max);
  const title=(info.title||info.fulltitle||"").replace(/[^a-z0-9_\- ]/gi,"").replace(/\s+/g,"_").slice(0,40)||"video";
  const thumb = info.thumbnail || info.thumbnails?.slice(-1)?.[0]?.url || info.thumbnails?.[0]?.url || "";
  const vidMatch = info.webpage_url?.match(/(?:v=|\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/) || info.original_url?.match(/(?:v=|\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/) || (info.id && String(info.id).length===11 ? [null, info.id] : null);
  const ytThumb = vidMatch ? `https://img.youtube.com/vi/${vidMatch[1]}/hqdefault.jpg` : "";
  const finalThumb = thumb || ytThumb;
  return pool.map((f:any)=>({
    format_id:f.format_id, url:f.url,
    quality: f.height ? `${f.height}p` : (f.qualityLabel || f.format_note || "auto"),
    height:f.height, ext:f.ext||"mp4", acodec:f.acodec, vcodec:f.vcodec,
    hasAudio:f.acodec!=="none", needsMerge:f.acodec==="none", title,
    size:f.filesize?`${(f.filesize/1024/1024).toFixed(1)} MB`:f.filesize_approx?`~${(f.filesize_approx/1024/1024).toFixed(1)} MB`:undefined,
    thumbnail:finalThumb, duration:info.duration?`${Math.floor(info.duration/60)}:${String(Math.floor(info.duration%60)).padStart(2,"0")}`:undefined
  }));
}

function youtubeThumbnail(url: string, fallback: string) {
  const m = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
  if (m) return `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
  return fallback;
}

export async function processSingleJob(jobId: string, url: string) {
  await prisma.downloadJob.update({ where: { id: jobId }, data: { status: "PARSING", progress: 10 } });
  // Direct mp4/webm/mov link -> no need yt-dlp, return immediately
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
    const thumb = youtubeThumbnail(url, "");
    const detectedDirect = [{ url, quality: "auto", height: undefined, ext: url.split(".").pop()!.split("?")[0].toLowerCase(), thumbnail: thumb, hasAudio: true, needsMerge: false, title: url.split("/").pop()!.slice(0,40) || "video" }];
    const exp = new Date(Date.now() + 30*60*1000);
    await prisma.downloadJob.update({ where: { id: jobId }, data: { detectedUrls: detectedDirect as any, status: "COMPLETED", progress: 100, expiresAt: exp } });
    return detectedDirect;
  }
  let detected: any[] = [];
  let pageTitle = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      pageTitle = $("title").first().text().trim().slice(0, 120);
      $("video source, video, meta[property='og:video'], meta[property='og:video:secure_url']").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("content") || $(el).attr("srcset");
        if (src && !src.startsWith("blob:")) {
          try {
            const abs = new URL(src, url).toString();
            const ext = abs.split(".").pop()?.split("?")[0] || "mp4";
            if (["mp4", "webm", "mov"].includes(ext)) detected.push({ url: abs, quality: "auto", ext, thumbnail: "", hasAudio: true, needsMerge: false });
          } catch {}
        }
      });
    }
  } catch (e) {
    console.warn(`[processJob] cheerio failed ${jobId}`, String(e).slice(0, 150));
  }
  // Try yt-dlp-exec first (works on Vercel if binary present) — most accurate, restores original worker behavior
  const needsYtdlp = detected.length === 0 || /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|vimeo\.com|twitch\.tv/.test(url);
  if (needsYtdlp) {
    // Vercel Hobby: support YTDLP_COOKIES as file path OR raw Netscape content (paste cookies.txt into Vercel env)
    let cookiesPath: string | undefined;
    const rawCookies = process.env.YTDLP_COOKIES || "";
    if (rawCookies && rawCookies.includes("# Netscape")) {
      // Raw content pasted — write to /tmp for yt-dlp
      try { const p = path.join("/tmp", `cookies-${jobId}.txt`); fs.writeFileSync(p, rawCookies); cookiesPath = p; console.log(`[processJob] wrote YTDLP_COOKIES to ${p}`); } catch {}
    } else if (rawCookies) { cookiesPath = rawCookies; }
    else if (fs.existsSync(path.join(process.cwd(), "cookies.txt"))) cookiesPath = path.join(process.cwd(), "cookies.txt");
    // Match original worker: android first, web fallback — try without cookies first
    const clients = ["android", "web", "ios", "tv"] as const;
    for (const withCookies of [false, true] as const) {
      if (detected.length) break;
      if (withCookies && !cookiesPath) continue;
      for (const client of clients) {
        if (detected.length) break;
        try {
          const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
          const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, preferFreeFormats: true, ...(withCookies ? { cookies: cookiesPath! } : {}) };
          if (client !== "web") args.extractorArgs = `youtube:player_client=${client}`;
          const info: any = await ytdlp(url, args);
          const formats = pickAllFormats(info, 8);
          if (formats.length) { detected = formats; console.log(`[processJob] yt-dlp (${client}${withCookies?" +cookies":""}) found ${formats.length} for ${jobId}`); break; }
        } catch (e: any) { console.warn(`[processJob] yt-dlp (${client}${withCookies?" +cookies":""}) failed`, String(e?.message||e).slice(0,180)); }
        // Also try without preferFreeFormats for this client (dQw4w9WgXcQ needed it off with cookies)
        if (!detected.length) {
          try {
            const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
            const args: any = { dumpSingleJson: true, noPlaylist: true, noWarnings: true, ...(withCookies ? { cookies: cookiesPath! } : {}) };
            if (client !== "web") args.extractorArgs = `youtube:player_client=${client}`;
            const info: any = await ytdlp(url, args);
            const formats = pickAllFormats(info, 8);
            if (formats.length) { detected = formats; console.log(`[processJob] yt-dlp (${client}${withCookies?" +cookies":""} noFree) found ${formats.length} for ${jobId}`); break; }
          } catch {}
        }
      }
    }
  }
  if (detected.length === 0 && /youtube\.com|youtu\.be/.test(url)) {
    try {
      const idMatch = url.match(/(?:v=|\.be\/)([a-zA-Z0-9_-]{11})/);
      const vid = idMatch ? idMatch[1] : null;
      if (vid) {
        const pipedHosts = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de", "https://pipedapi.syncpundit.io"];
        for (const host of pipedHosts) {
          try {
            const r = await fetch(`${host}/streams/${vid}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(7000) });
            if (!r.ok) continue;
            const pj: any = await r.json();
            const streams: any[] = [...(pj.videoStreams || []), ...(pj.audioStreams || [])];
            const mapped = streams.filter((s:any)=>s.url).map((s:any)=>({ url:s.url, quality:s.quality||(s.height?`${s.height}p`:"best"), height:s.height||parseInt(s.quality)||undefined, ext:(s.mimeType||"video/mp4").split("/")[1]?.split(";")[0]||"mp4", hasAudio:!!s.audioTrackName||s.mimeType?.includes("audio")||false, needsMerge:false, title:(pj.title||pageTitle).replace(/[^a-z0-9_\- ]/gi,"").replace(/\s+/g,"_").slice(0,40)||"video", size:s.bitrate?`${(s.bitrate/8000/1024).toFixed(1)} MB`:undefined, thumbnail:pj.thumbnailUrl||"" })).filter((v:any)=>v.height).sort((a:any,b:any)=>b.height-a.height).slice(0,8);
            if (mapped.length) { detected = mapped; console.log(`[processJob] piped ${host} found ${mapped.length} for ${jobId}`); break; }
          } catch {}
        }
      }
    } catch (e) { console.warn(`[processJob] piped failed ${jobId}`, String(e).slice(0,150)); }
  }
  if (detected.length === 0 && /youtube\.com|youtu\.be/.test(url)) {
    try {
      const ytdl: any = await import("@distube/ytdl-core").then((m: any) => m.default || m);
      const info = await (ytdl as any).getInfo(url);
      const formats = (ytdl as any).filterFormats(info.formats, "videoandaudio");
      const title2 = (info.videoDetails.title || pageTitle).replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";
      const best = formats.filter((f:any)=>f.url).sort((a:any,b:any)=>(b.height||0)-(a.height||0)).slice(0,6).map((f:any)=>({ url:f.url, quality:f.qualityLabel||(f.height?`${f.height}p`:"best"), height:f.height, ext:f.container||"mp4", hasAudio:true, needsMerge:false, title:title2, size:f.contentLength?`${(Number(f.contentLength)/1024/1024).toFixed(1)} MB`:undefined, thumbnail:info.videoDetails.thumbnails?.[0]?.url||"" }));
      if (best.length) detected = best;
    } catch (e) { console.warn(`[processJob] ytdl-core failed ${jobId}`, String(e).slice(0,150)); }
  }
  if (detected.length === 0) {
    // Genuine failure — mark for frontend. But still provide thumbnail so card shows with retry guidance
    const thumb = youtubeThumbnail(url, "");
    detected = [{ url, quality: "auto", ext: "mp4", thumbnail: thumb, hasAudio: false, needsMerge: false, title: pageTitle || "video", _failed: true } as any];
  }
  // Dedupe by quality, keep first — preserve hasAudio/needsMerge (video-only needs R2 merge)
  const seen = new Set<string>();
  detected = detected.filter((d: any) => (seen.has(d.quality) ? false : (seen.add(d.quality), true)));
  // needsMerge already set via hasAudio in pickAllFormats / piped mapping — do NOT wipe
  detected.forEach((d: any) => { if (!d.thumbnail) d.thumbnail = youtubeThumbnail(url, d.thumbnail); });
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.downloadJob.update({
    where: { id: jobId },
    data: { detectedUrls: detected as any, status: "COMPLETED", progress: 100, expiresAt },
  });
  return detected;
}
