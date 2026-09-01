import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let db = "ok";
  let redis = "skip";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    db = `error: ${String(e).slice(0, 120)}`;
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

  return NextResponse.json({
    status: db === "ok" ? "ok" : "degraded",
    db,
    redis,
    version: process.env.npm_package_version || "0.1.0",
    uptime: process.uptime?.() || 0,
    latencyMs: Date.now() - started,
  });
}
