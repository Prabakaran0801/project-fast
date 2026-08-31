import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  let jobs: any[] = [];
  let transfers: any[] = [];
  try {
    jobs = await prisma.downloadJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    transfers = await prisma.transfer.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { files: true },
    });
  } catch {}

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <Header />
      <main className="mx-auto max-w-[1120px] px-4 sm:px-6 py-8">
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-white">
            History
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            {jobs.length === 0 ? (
              <Card className="border-dashed border-zinc-800 bg-[#121214]">
                <CardContent className="p-8 text-center text-sm font-mono text-zinc-500">
                  No history yet. Set{" "}
                  <code className="px-1.5 py-0.5 bg-zinc-800 text-white rounded">
                    DATABASE_URL
                  </code>{" "}
                  and create your first detection on the homepage.
                </CardContent>
              </Card>
            ) : (
              jobs.map((job) => (
                <Card
                  key={job.id}
                  className="overflow-hidden bg-[#121214] border-zinc-800"
                >
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-mono truncate max-w-[320px] text-white">
                        {job.sourceUrl}
                      </p>
                      <p className="text-xs text-zinc-500 font-mono mt-1">
                        {new Date(job.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge
                      variant={
                        job.status === "COMPLETED"
                          ? "default"
                          : job.status === "FAILED"
                            ? "outline"
                            : "secondary"
                      }
                      className="font-mono text-[10px] shrink-0"
                    >
                      {job.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <div>
            <Card className="bg-[#121214] border-zinc-800">
              <CardHeader>
                <CardTitle className="text-sm text-white">
                  Recent Transfers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {transfers.length === 0 ? (
                  <p className="text-xs font-mono text-zinc-500">
                    No transfers yet.
                  </p>
                ) : (
                  transfers.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-xl border border-zinc-800 bg-zinc-900 text-xs font-mono text-white"
                    >
                      <div className="font-medium truncate">
                        /d/{t.transferUrl}
                      </div>
                      <div className="text-zinc-500 mt-1">
                        {t.files.length} files • expires{" "}
                        {new Date(t.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
