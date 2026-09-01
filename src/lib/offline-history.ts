"use client";

// Offline history: mirrors successful parses/transfers to localStorage so /history works offline
const KEY_JOBS = "mediamover:jobs";
const KEY_TRANSFERS = "mediamover:transfers";

export type CachedJob = { id: string; sourceUrl: string; status: string; createdAt: string; thumbnail?: string };
export type CachedTransfer = { id: string; transferUrl: string; files: { name: string; size: number }[]; expiresAt: string; createdAt: string };

function safeParse<T>(raw: string | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

export function pushJob(job: CachedJob) {
  try {
    const arr = safeParse<CachedJob[]>(localStorage.getItem(KEY_JOBS), []);
    const filtered = arr.filter((j) => j.id !== job.id);
    filtered.unshift(job);
    localStorage.setItem(KEY_JOBS, JSON.stringify(filtered.slice(0, 30)));
  } catch {}
}

export function pushTransfer(tr: CachedTransfer) {
  try {
    const arr = safeParse<CachedTransfer[]>(localStorage.getItem(KEY_TRANSFERS), []);
    arr.unshift(tr);
    localStorage.setItem(KEY_TRANSFERS, JSON.stringify(arr.slice(0, 20)));
  } catch {}
}

export function getCachedJobs(): CachedJob[] {
  if (typeof window === "undefined") return [];
  return safeParse<CachedJob[]>(localStorage.getItem(KEY_JOBS), []);
}

export function getCachedTransfers(): CachedTransfer[] {
  if (typeof window === "undefined") return [];
  return safeParse<CachedTransfer[]>(localStorage.getItem(KEY_TRANSFERS), []);
}
