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

  // HYBRID: 302 redirect to origin (googlevideo) — Cloudflare Cache Rule caches it at edge, no R2 storage = free + fast
  // Previously streamed via fetch() which was slow; now 302 lets CDN handle it.
  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=60, s-maxage=3600");
  headers.set("Location", url);
  // Preserve filename hint via Content-Disposition on redirect is not used, but keep for logs
  console.log(`[proxy] 302 redirect -> ${url.slice(0, 80)}`);
  return new Response(null, { status: 302, headers });
}
