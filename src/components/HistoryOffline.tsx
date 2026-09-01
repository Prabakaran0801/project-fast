"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCachedJobs, getCachedTransfers } from "@/lib/offline-history";

export function HistoryOffline({ serverHasData }: { serverHasData: boolean }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const on = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    // load cached if server empty or offline
    const cachedJobs = getCachedJobs();
    const cachedTransfers = getCachedTransfers();
    if (!serverHasData || !navigator.onLine) {
      if (cachedJobs.length) setJobs(cachedJobs);
      if (cachedTransfers.length) setTransfers(cachedTransfers);
    }
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, [serverHasData]);

  if (!jobs.length && !transfers.length) return null;

  return (
    <div className="mt-6 space-y-3">
      {isOffline && <p className="text-xs font-mono text-amber-400 bg-amber-950/30 border border-amber-900 rounded-xl px-3 py-2">Offline — showing cached history (PWA)</p>}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-mono tracking-[0.12em] text-zinc-500">CACHED JOBS (OFFLINE)</h3>
          {jobs.map((job) => (
            <Card key={job.id} className="overflow-hidden bg-[#121214] border-zinc-800">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-mono truncate max-w-[320px] text-white">{job.sourceUrl}</p>
                  <p className="text-xs text-zinc-500 font-mono mt-1">{new Date(job.createdAt).toLocaleString()} • cached</p>
                </div>
                <Badge variant="secondary" className="font-mono text-[10px] shrink-0">{job.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {transfers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-mono tracking-[0.12em] text-zinc-500">CACHED TRANSFERS</h3>
          {transfers.map((t) => (
            <div key={t.id} className="p-3 rounded-xl border border-zinc-800 bg-zinc-900 text-xs font-mono text-white">
              <div className="font-medium truncate">/d/{t.transferUrl}</div>
              <div className="text-zinc-500 mt-1">{t.files.length} files • cached • expires {new Date(t.expiresAt).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
