import { NextRequest } from "next/server";

export const maxDuration = 10;
// Free permanent alternative to paid Webshare for local India ISP block
// This route runs on Vercel US (iad1) — fetches target URL via Vercel's IP (not blocked) and returns body
// Local dev can call /api/fetch-proxy?url=... to bypass India ISP without YTDLP_PROXY
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new Response("Missing url", { status: 400 });
  try {
    const u = new URL(url);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(u.hostname)) return new Response("Blocked", { status: 400 });
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  // Allow only pornhub and generic video hosts to prevent abuse
  const allowed = /pornhub\.com|pornhub\.org|missav|youtube\.com|youtu\.be|googlevideo\.com|twimg\.com|fbcdn\.net|vimeo\.com|twitch\.tv|fpo\.xxx|wowxxx/.test(url);
  if (!allowed) return new Response("Host not allowed for free proxy", { status: 403 });
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: new URL(url).origin + "/",
      },
      redirect: "follow",
      // Use Vercel's IP (no YTDLP_PROXY needed)
    });
    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "text/html");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=60");
    return new Response(body, { status: upstream.status, headers });
  } catch (e: any) {
    return new Response(`Fetch failed: ${String(e?.message || e).slice(0, 200)}`, { status: 502 });
  }
}
