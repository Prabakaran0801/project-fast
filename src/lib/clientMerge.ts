"use client";
// Client-side ffmpeg.wasm merge for YouTube DASH video+audio (no R2, free on single Vercel deploy)
// Uses @ffmpeg/ffmpeg + @ffmpeg/util. First load ~30MB WASM, then merge in Web Worker.

let ffmpeg: any = null;
let fetchFile: any = null;
let loading: Promise<any> | null = null;

async function getFFmpeg() {
  if (ffmpeg) return { ffmpeg, fetchFile };
  if (loading) return loading;
  loading = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { fetchFile: ff } = await import("@ffmpeg/util");
    fetchFile = ff;
    ffmpeg = new FFmpeg();
    // Use CDN core (no need to bundle 30MB). Vercel will serve from cdn
    // jsDelivr CDN for ffmpeg core
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    ffmpeg.on("log", ({ message }: any) => console.log(`[ffmpeg] ${message}`));
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
    console.log("[ffmpeg] loaded");
    return { ffmpeg, fetchFile };
  })();
  return loading;
}

export async function mergeVideoAudio(
  videoUrl: string,
  audioUrl: string,
  onProgress?: (pct: number, msg: string) => void,
  opts?: { signal?: AbortSignal },
): Promise<Blob> {
  const { ffmpeg: ff } = await getFFmpeg();
  onProgress?.(5, "fetching video+audio...");

  // Helper: fetch with real Content-Length progress, returns Uint8Array
  async function fetchBytes(url: string, label: string, weightStart: number, weightEnd: number, combinedTotal: number, getCombinedReceived: () => number): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${label} fetch ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        const combined = getCombinedReceived() + received;
        const pct = total && combinedTotal ? Math.round(weightStart + ((combined / combinedTotal) * (weightEnd - weightStart))) : weightStart;
        const mb = (received / 1024 / 1024).toFixed(1);
        const totalMb = total ? (total / 1024 / 1024).toFixed(1) : "?";
        const combinedMb = (combined / 1024 / 1024).toFixed(1);
        const combinedTotalMb = combinedTotal ? (combinedTotal / 1024 / 1024).toFixed(1) : "?";
        onProgress?.(pct, `${label} ${mb}/${totalMb} MB — combined ${combinedMb}/${combinedTotalMb} MB`);
      }
    }
    // concat
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // First do HEAD to get totals for combined progress (if available) — skip for googlevideo/proxy (CORS/overhead)
  let totalVideo = 0, totalAudio = 0;
  const isGoogleDirect = /googlevideo\.com/.test(videoUrl) || /\/api\/download\/proxy/.test(videoUrl);
  if (!isGoogleDirect) {
    try {
      const [hv, ha] = await Promise.all([
        fetch(videoUrl, { method: "HEAD" }).then((r) => Number(r.headers.get("content-length") || 0)).catch(() => 0),
        fetch(audioUrl, { method: "HEAD" }).then((r) => Number(r.headers.get("content-length") || 0)).catch(() => 0),
      ]);
      totalVideo = hv; totalAudio = ha;
    } catch {}
  }
  let combinedTotal = totalVideo + totalAudio;
  let receivedVideo = 0, receivedAudio = 0;

  // Fetch video then audio with combined progress — throttled to 1 log per 600ms or 1% to avoid spam, also log every 1MB
  let lastLog = 0;
  let lastPct = 0;
  let lastMb = 0;
  function shouldLog(pct: number, mb: number) {
    const now = Date.now();
    if (pct !== lastPct && (pct - lastPct >= 1 || now - lastLog > 800 || Math.abs(mb - lastMb) >= 1)) {
      lastPct = pct; lastLog = now; lastMb = mb; return true;
    }
    // also if >1s elapsed even without pct change (for stuck 50% case)
    if (now - lastLog > 1500) { lastLog = now; lastMb = mb; return true; }
    return false;
  }
  async function fetchWithRetry(url: string, retries = 1, signal?: AbortSignal): Promise<Response> {
    for (let i = 0; i <= retries; i++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const r = await fetch(url, { mode: "cors", redirect: "follow", signal } as any);
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`HTTP ${r.status}${txt ? ` ${txt.slice(0,80)}` : ""}`);
        }
        if (!r.body) throw new Error("no body");
        return r;
      } catch (e: any) {
        if (e?.name === "AbortError") throw e;
        if (i === retries) throw e;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    throw new Error("unreachable");
  }
  // Parallel fetch helper with abort + speed-aware progress
  const fetchStream = async (url: string, label: "video" | "audio"): Promise<Uint8Array> => {
    const res = await fetchWithRetry(url, 1, opts?.signal);
    const total = Number(res.headers.get("content-length") || 0);
    if (label === "video") totalVideo = total || totalVideo;
    else totalAudio = total || totalAudio;
    combinedTotal = totalVideo + totalAudio || totalVideo || totalAudio || combinedTotal;
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastSpeedLog = Date.now();
    let lastBytes = 0;
    while (true) {
      if (opts?.signal?.aborted) {
        try { await reader.cancel(); } catch {}
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (label === "video") receivedVideo = received;
        else receivedAudio = received;
        const combined = receivedVideo + receivedAudio;
        const totalForPct = combinedTotal || totalVideo || totalAudio || 0;
        const pct = totalForPct ? Math.round(10 + (combined / totalForPct) * 60) : 10 + Math.min(60, Math.round(combined / 1024 / 1024));
        const mb = received / 1024 / 1024;
        // log every 1MB or 800ms, includes MB/s
        const now = Date.now();
        const sec = (now - lastSpeedLog) / 1000;
        const speed = sec > 0.5 ? ((received - lastBytes) / 1024 / 1024 / sec).toFixed(1) : "";
        if (shouldLog(pct, mb) || (speed && now - lastSpeedLog > 1000)) {
          if (now - lastSpeedLog > 1000) { lastSpeedLog = now; lastBytes = received; }
          const totalMb = total ? (total / 1024 / 1024).toFixed(1) : "?";
          onProgress?.(Math.min(70, pct), `Downloading ${label} ${mb.toFixed(1)}/${totalMb} MB${speed ? ` @${speed} MB/s` : ""} — combined ${(combined/1024/1024).toFixed(1)}/${combinedTotal ? (combinedTotal/1024/1024).toFixed(1) : "?"} MB`);
        }
      }
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  };

  // Parallel download: video + audio together (2x faster, single deploy no R2)
  const [videoData, audioData] = await Promise.all([
    fetchStream(videoUrl, "video"),
    fetchStream(audioUrl, "audio"),
  ]);
  receivedVideo = videoData.length;
  receivedAudio = audioData.length;

  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!videoData?.length || !audioData?.length) throw new Error(`fetch empty video=${videoData?.length} audio=${audioData?.length}`);
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  onProgress?.(72, "loading files into ffmpeg...");
  await ff.writeFile("video.mp4", videoData);
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  await ff.writeFile("audio.mp4", audioData);
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  onProgress?.(78, "muxing video+audio (copy)...");
  // -c copy is fast, no re-encode — abortable
  const abortHandler = () => { try { ff.terminate(); } catch {} };
  opts?.signal?.addEventListener("abort", abortHandler, { once: true });
  try {
    await ff.exec(["-i", "video.mp4", "-i", "audio.mp4", "-c", "copy", "-shortest", "out.mp4"]);
  } finally {
    opts?.signal?.removeEventListener("abort", abortHandler);
  }
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  onProgress?.(85, "reading output...");
  const data = (await ff.readFile("out.mp4")) as Uint8Array;
  // cleanup
  try {
    await ff.deleteFile("video.mp4");
    await ff.deleteFile("audio.mp4");
    await ff.deleteFile("out.mp4");
  } catch {}
  onProgress?.(95, "creating blob...");
  return new Blob([data as any], { type: "video/mp4" });
}

export async function isFFmpegSupported(): Promise<boolean> {
  try {
    // SharedArrayBuffer required for ffmpeg.wasm, needs crossOriginIsolated. Fallback still works with single thread?
    return typeof window !== "undefined";
  } catch {
    return false;
  }
}
