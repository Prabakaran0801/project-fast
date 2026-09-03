export function pickAllFormats(info: any, max = 8) {
  const isStoryboard = (f: any) =>
    f.ext === "mhtml" ||
    f.protocol === "mhtml" ||
    String(f.format_id || "").startsWith("sb") ||
    String(f.format_note || "").toLowerCase().includes("storyboard");
  let formats: any[] = (info.formats || []).filter(
    (f: any) => f.url && f.vcodec !== "none" && !isStoryboard(f) && !(f.height && f.height < 144)
  );
  if (!formats.length) formats = (info.formats || []).filter((f: any) => f.url && !isStoryboard(f));
  const byHeight = new Map<string, any>();
  for (const f of formats) {
    if (isStoryboard(f)) continue;
    if (f.ext === "mhtml" || f.protocol === "mhtml") continue;
    if (f.height && f.height < 144) continue;
    const key = f.height ? `${f.height}p` : f.format_note || f.qualityLabel || f.format_id || "auto";
    if (key === "Default" || key === "low" || key.includes("DRC")) continue;
    const isHls = f.protocol === "m3u8" || f.protocol === "m3u8_native" || String(f.url).includes(".m3u8") || String(f.url).includes("manifest.googlevideo.com");
    if (isHls) continue;
    const score = (x: any) => (x.acodec !== "none" ? 3 : 0) + (x.ext === "mp4" ? 2 : 0) + (x.height || 0) / 1000;
    const existing = byHeight.get(key);
    if (!existing || score(f) > score(existing)) byHeight.set(key, f);
  }
  let pool = Array.from(byHeight.values())
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .slice(0, max);
  if (!pool.length) pool = formats.filter((f: any) => f.height).slice(0, max);
  if (!pool.length) pool = formats.slice(0, max);
  const title = (info.title || info.fulltitle || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";
  const thumb = info.thumbnail || info.thumbnails?.slice(-1)?.[0]?.url || info.thumbnails?.[0]?.url || "";
  const vidMatch =
    info.webpage_url?.match(/(?:v=|\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/) ||
    info.original_url?.match(/(?:v=|\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/) ||
    (info.id && String(info.id).length === 11 ? [null, info.id] : null);
  const ytThumb = vidMatch ? `https://img.youtube.com/vi/${vidMatch[1]}/hqdefault.jpg` : "";
  const finalThumb = thumb || ytThumb;
  // best audio for client-side merge (free, no R2) — pick highest bitrate audio
  const audioCandidates = (info.formats || [])
    .filter((f: any) => f.url && f.acodec !== "none" && f.vcodec === "none")
    .sort((a: any, b: any) => (b.abr || b.bitrate || 0) - (a.abr || a.bitrate || 0));
  const bestAudio = audioCandidates[0];
  const bestAudioUrl = bestAudio?.url || undefined;
  return pool.map((f: any) => ({
    format_id: f.format_id,
    url: f.url,
    quality: f.height ? `${f.height}p` : f.qualityLabel || f.format_note || "auto",
    height: f.height,
    ext: f.ext || "mp4",
    acodec: f.acodec,
    vcodec: f.vcodec,
    hasAudio: f.acodec !== "none",
    needsMerge: f.acodec === "none",
    audioUrl: f.acodec === "none" ? bestAudioUrl : undefined,
    title,
    size: f.filesize
      ? `${(f.filesize / 1024 / 1024).toFixed(1)} MB`
      : f.filesize_approx
        ? `~${(f.filesize_approx / 1024 / 1024).toFixed(1)} MB`
        : undefined,
    thumbnail: finalThumb,
    duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, "0")}` : undefined,
  }));
}

// worker variant kept for backwards compat import path, same logic but Map<number> and worker-style HLS check
export function pickAllFormatsWorker(info: any, max = 8) {
  const isStoryboard = (f: any) => f.ext === "mhtml" || f.protocol === "mhtml" || String(f.format_id || "").startsWith("sb") || String(f.format_note || "").toLowerCase().includes("storyboard");
  const formats: any[] = info.formats || [];
  const isHls = (f: any) =>
    f.protocol === "m3u8" ||
    f.protocol === "m3u8_native" ||
    f.ext === "m3u8" ||
    String(f.url || "").includes(".m3u8") ||
    String(f.url || "").includes("manifest.googlevideo.com");
  const byHeight = new Map<number, any>();
  for (const f of formats) {
    if (!f.url || !f.height || isHls(f)) continue;
    if (isStoryboard(f)) continue;
    if (f.height < 144) continue;
    if (f.ext === "mhtml") continue;
    const h = f.height;
    const existing = byHeight.get(h);
    const score = (x: any) => (x.acodec !== "none" ? 2 : 0) + (x.ext === "mp4" ? 1 : 0);
    if (!existing || score(f) > score(existing)) byHeight.set(h, f);
  }
  const sorted = Array.from(byHeight.values())
    .sort((a, b) => b.height - a.height)
    .slice(0, max);
  const pool = sorted.length ? sorted : formats.filter((f) => f.url && !isHls(f) && !isStoryboard(f)).slice(0, max);
  const title = (info.title || "").replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";
  const audioCandidatesW = (info.formats || [])
    .filter((f: any) => f.url && f.acodec !== "none" && f.vcodec === "none")
    .sort((a: any, b: any) => (b.abr || b.bitrate || 0) - (a.abr || a.bitrate || 0));
  const bestAudioW = audioCandidatesW[0]?.url;
  return pool.map((f: any) => ({
    format_id: f.format_id,
    url: f.url,
    quality: `${f.height}p`,
    height: f.height,
    ext: f.ext || "mp4",
    acodec: f.acodec,
    vcodec: f.vcodec,
    hasAudio: f.acodec !== "none",
    needsMerge: f.acodec === "none",
    audioUrl: f.acodec === "none" ? bestAudioW : undefined,
    title,
    size: f.filesize ? `${(f.filesize / 1024 / 1024).toFixed(1)} MB` : f.filesize_approx ? `~${(f.filesize_approx / 1024 / 1024).toFixed(1)} MB` : undefined,
    thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || "",
    duration: info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, "0")}` : undefined,
  }));
}
