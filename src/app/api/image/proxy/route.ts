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
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: url.includes("fbcdn.net") ? "https://www.instagram.com/" : "https://www.youtube.com/",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!upstream.ok || !upstream.body) return new Response(`Upstream ${upstream.status}`, { status: 502 });
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("Content-Length", cl);
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
    return new Response(upstream.body as any, { status: 200, headers });
  } catch (e: any) {
    return new Response("Proxy fetch failed", { status: 502 });
  }
}
