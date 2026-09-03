import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new Response("Missing url", { status: 400 });
  try {
    const u = new URL(url);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(u.hostname)) return new Response("Blocked", { status: 400 });
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (url.includes(".m3u8") || url.includes("manifest.googlevideo.com")) {
    return new Response("HLS/manifest stream — not directly downloadable. Please re-parse and choose a lower quality (360p/720p muxed) which has audio. High-res 1080p requires ffmpeg merge (coming soon).", { status: 400 });
  }

  // Client ffmpeg merge needs actual bytes, not 302 — force stream with ?stream=1
  const forceStream = req.nextUrl.searchParams.get("stream") === "1" || req.headers.get("x-stream") === "1";
  // Twitter/X video.twimg.com needs server-side fetch with Referer (302 alone 403s)
  const needsProxyStream = forceStream || /video\.twimg\.com|twimg\.com|instagram\.com|fbcdn\.net/.test(url);
  if (needsProxyStream) {
    console.log(`[proxy] streaming with Referer -> ${url.slice(0, 80)} forceStream=${forceStream}`);
    try {
      // Use same YTDLP_PROXY as yt-dlp so googlevideo ip= param matches proxy IP (otherwise 403)
      let dispatcher: any = undefined;
      try {
        const { getFetchDispatcher } = await import("@/lib/handlers/utils/proxy");
        dispatcher = getFetchDispatcher();
        if (dispatcher) console.log(`[proxy] using YTDLP_PROXY dispatcher for ${url.slice(0, 40)}`);
      } catch {}
      const fetchOpts: any = {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: url.includes("twimg.com") ? "https://x.com/" : url.includes("googlevideo.com") ? "https://www.youtube.com/" : "https://www.instagram.com/",
          Accept: "*/*",
        },
        redirect: "follow" as const,
      };
      if (dispatcher) fetchOpts.dispatcher = dispatcher;
      const upstream = await fetch(url, fetchOpts);
      if (!upstream.ok || !upstream.body) return new Response(`Upstream ${upstream.status}`, { status: 502 });
      const headers = new Headers();
      headers.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
      const cl = upstream.headers.get("content-length");
      if (cl) headers.set("Content-Length", cl);
      headers.set("Cache-Control", "public, max-age=60, s-maxage=3600");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Headers", "*");
      headers.set("Content-Disposition", `attachment; filename="video.mp4"`);
      return new Response(upstream.body as any, { status: 200, headers });
    } catch (e: any) {
      console.warn("[proxy] stream failed", String(e).slice(0, 200));
      return new Response("Proxy fetch failed", { status: 502 });
    }
  }

  // HYBRID: 302 redirect to origin (googlevideo) — Cloudflare Cache Rule caches it at edge, no R2 storage = free + fast
  // Previously streamed via fetch() which was slow; now 302 lets CDN handle it.
  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=60, s-maxage=3600");
  headers.set("Location", url);
  // Preserve filename hint via Content-Disposition on redirect is not used, but keep for logs
  console.log(`[proxy] 302 redirect -> ${url.slice(0, 80)}`);
  return new Response(null, { status: 302, headers });
}
