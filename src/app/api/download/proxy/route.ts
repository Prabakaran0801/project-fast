import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Client ffmpeg merge needs actual bytes, not 302 — force stream with ?stream=1
  const forceStream = req.nextUrl.searchParams.get("stream") === "1" || req.headers.get("x-stream") === "1";
  // Twitter/X + googlevideo (CORS + IP must match extraction IP) + instagram need proxy stream
  const needsProxyStream = forceStream || /video\.twimg\.com|twimg\.com|instagram\.com|fbcdn\.net|googlevideo\.com/.test(url);
  if (needsProxyStream) {
    console.log(`[proxy] streaming -> ${url.slice(0, 80)} forceStream=${forceStream}`);
    // Try with dispatcher first (if YTDLP_PROXY set, must match yt-dlp extraction IP), then without
    const tryFetch = async (useDispatcher: boolean) => {
      let dispatcher: any = undefined;
      if (useDispatcher) {
        try {
          const { getFetchDispatcher } = await import("@/lib/handlers/utils/proxy");
          dispatcher = getFetchDispatcher();
        } catch {}
      }
      const isGoogle = url.includes("googlevideo.com");
      // googlevideo is strict about IP, not Referer — use minimal headers
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...(isGoogle ? {} : { Referer: url.includes("twimg.com") ? "https://x.com/" : "https://www.instagram.com/" }),
      };
      // Forward Range if client requested it (ffmpeg may need it)
      const range = req.headers.get("range");
      if (range) headers["Range"] = range;
      const fetchOpts: any = { headers, redirect: "follow" as const };
      if (dispatcher) fetchOpts.dispatcher = dispatcher;
      // undici fetch needs duplex for streaming on Node 18, but Next fetch handles it
      return fetch(url, fetchOpts);
    };

    try {
      let upstream: Response | null = null;
      let lastErr = "";
      // attempt 1: with dispatcher if configured
      try {
        upstream = await tryFetch(true);
        if (!upstream.ok) {
          const txt = await upstream.text().catch(() => "");
          console.warn(`[proxy] upstream ${upstream.status} with dispatcher, body: ${txt.slice(0,120)}`);
          // if 403/502, retry without dispatcher (Vercel IP may match)
          if (upstream.status === 403 || upstream.status === 502 || upstream.status === 429) {
            console.log(`[proxy] retry without dispatcher`);
            upstream = await tryFetch(false);
          }
        }
      } catch (e: any) {
        lastErr = String(e).slice(0,200);
        console.warn(`[proxy] fetch with dispatcher failed: ${lastErr}, retry without`);
        upstream = await tryFetch(false);
      }
      // if still not ok, try without dispatcher as fallback
      if (!upstream || (!upstream.ok && !upstream.body)) {
        if (!upstream) upstream = await tryFetch(false);
      }
      if (!upstream.ok || !upstream.body) {
        const bodyTxt = await upstream.text().catch(() => "").then((t) => t.slice(0,200));
        console.warn(`[proxy] upstream failed final ${upstream.status} ${bodyTxt}`);
        return new Response(`Upstream ${upstream.status} ${bodyTxt}`, { status: 502, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      const headers = new Headers();
      headers.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
      const cl = upstream.headers.get("content-length");
      if (cl) headers.set("Content-Length", cl);
      const cr = upstream.headers.get("content-range");
      if (cr) headers.set("Content-Range", cr);
      if (upstream.status === 206) headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "public, max-age=60, s-maxage=3600");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Headers", "*");
      headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");
      headers.set("Content-Disposition", `attachment; filename="video.mp4"`);
      // Preserve 206 partial content
      return new Response(upstream.body as any, { status: upstream.status, headers });
    } catch (e: any) {
      console.warn("[proxy] stream failed", String(e).slice(0, 300));
      return new Response(`Proxy fetch failed: ${String(e).slice(0,120)}`, { status: 502, headers: { "Access-Control-Allow-Origin": "*" } });
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
