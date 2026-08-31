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

  const title = req.nextUrl.searchParams.get("title") || "video";
  const quality = req.nextUrl.searchParams.get("quality") || "";
  const sanitizedTitle = title.replace(/[^a-z0-9_\- ]/gi, "").replace(/\s+/g, "_").slice(0, 40) || "video";

  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } } as any);
    if (!res.ok) return new Response(`Upstream ${res.status}`, { status: 502 });
    const contentType = res.headers.get("content-type") || "video/mp4";
    const contentLength = res.headers.get("content-length");
    // Use mp4 always for video, fallback to content-type ext
    const ext = contentType.includes("webm") ? "webm" : contentType.includes("mp4") ? "mp4" : "mp4";
    const filename = quality ? `${sanitizedTitle}-${quality}.mp4` : `${sanitizedTitle}.mp4`;
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Cache-Control", "private, max-age=60");
    if (res.body) {
      return new Response(res.body as any, { headers });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, { headers });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
}
