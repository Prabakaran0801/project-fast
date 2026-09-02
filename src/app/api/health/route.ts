import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let db = "ok";
  let redis = "skip";
  let ytDlp: string = "unknown";
  let ytDlpPath: string = "unknown";
  let envFlags: Record<string, boolean> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    db = `error: ${String(e).slice(0, 300)}`;
  }

  // Light redis check via Upstash REST if configured
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/ping`, {
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
        cache: "no-store",
      });
      redis = res.ok ? "ok" : `http ${res.status}`;
    } catch (e) {
      redis = `error: ${String(e).slice(0, 80)}`;
    }
  }

  // yt-dlp binary check (avoid fs tracing whole project)
  try {
    const ytdlp: any = await import("yt-dlp-exec").then((m: any) => m.default || m);
    ytDlp = `import-ok platform=${process.platform}`;
    ytDlpPath = "node_modules/yt-dlp-exec/bin/yt-dlp";
  } catch (e: any) {
    ytDlp = `import-fail: ${String(e?.message || e).slice(0, 120)}`;
  }

  envFlags = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    DIRECT_URL: !!process.env.DIRECT_URL,
    REDIS_URL: !!process.env.REDIS_URL,
    YTDLP_PROXY: !!process.env.YTDLP_PROXY,
    HTTPS_PROXY: !!process.env.HTTPS_PROXY,
    HTTP_PROXY: !!process.env.HTTP_PROXY,
    YTDLP_COOKIES: !!process.env.YTDLP_COOKIES,
    S3_ENDPOINT: !!process.env.S3_ENDPOINT,
    S3_BUCKET: !!process.env.S3_BUCKET,
  };

  return NextResponse.json({
    status: db === "ok" ? "ok" : "degraded",
    db,
    redis,
    ytDlp,
    ytDlpPath,
    envFlags,
    platform: process.platform,
    nodeVersion: process.version,
    region: process.env.VERCEL_REGION || process.env.FLY_REGION || "unknown",
    version: process.env.npm_package_version || "0.1.0",
    uptime: process.uptime?.() || 0,
    latencyMs: Date.now() - started,
  });
}
