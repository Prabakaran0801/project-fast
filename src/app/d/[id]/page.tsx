import { Header } from "@/components/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Clock, File as FileIcon, Link2, Shield } from "lucide-react";
import prisma from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TransferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ to?: string }> }) {
  const { id } = await params;
  const { to: downloaderEmail } = await searchParams;

  let transfer: any = null;
  try {
    transfer = await prisma.transfer.findFirst({
      where: { transferUrl: id },
      include: { files: true },
    });
    if (!transfer) {
      transfer = await prisma.transfer.findUnique({ where: { id }, include: { files: true } });
    }
  } catch {}

  if (!transfer) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white">
        <Header />
        <main className="mx-auto max-w-[720px] px-4 sm:px-6 py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-800 text-zinc-400 grid place-items-center mb-4">
            <Link2 className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Transfer not found</h1>
          <p className="text-sm text-zinc-500 font-mono mt-2">Invalid or expired link. Transfers auto-delete after 4 days.</p>
          <Link href="/" className="inline-flex mt-6 h-10 px-5 rounded-full bg-white text-zinc-900 text-sm font-medium items-center">
            Go home
          </Link>
        </main>
      </div>
    );
  }

  const expired = new Date(transfer.expiresAt) < new Date();
  const totalSize = transfer.files.reduce((a: number, f: any) => a + Number(f.size), 0);

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <Header />
      <main className="mx-auto max-w-[720px] px-4 sm:px-6 py-8">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-white text-zinc-900 grid place-items-center mb-3">
            <Download className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Files ready to download</h1>
          <p className="text-xs font-mono text-zinc-500 mt-1 flex items-center justify-center gap-2">
            <Clock className="h-3 w-3" /> {expired ? "Expired" : `Expires ${new Date(transfer.expiresAt).toLocaleString()}`} • {(totalSize / 1024 / 1024).toFixed(1)} MB
          </p>
        </div>

        <Card className="bg-[#121214] border-zinc-800 rounded-2xl overflow-hidden">
          <CardContent className="p-0">
            {transfer.files.map((f: any, i: number) => (
              <div key={f.id} className={`flex items-center gap-3 p-4 ${i !== transfer.files.length - 1 ? "border-b border-zinc-800" : ""}`}>
                <div className="h-9 w-9 rounded-xl bg-zinc-800 grid place-items-center shrink-0">
                  <FileIcon className="h-4 w-4 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate text-white">{f.filename}</p>
                  <p className="text-xs font-mono text-zinc-500">{(Number(f.size) / 1024 / 1024).toFixed(2)} MB • {f.mimeType}</p>
                </div>
                {expired ? (
                  <Button size="sm" disabled className="rounded-full h-8 px-4 text-xs">
                    Expired
                  </Button>
                ) : (
                  <a href={`/api/transfer/${transfer.transferUrl}/file/${f.id}${downloaderEmail ? `?to=${encodeURIComponent(downloaderEmail)}` : ""}`} className="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-full bg-white text-zinc-900 hover:bg-zinc-200 text-xs font-medium">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {!expired && (
          <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-4 flex items-center justify-between gap-3">
            <p className="text-xs font-mono text-zinc-400 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5" /> Link: <code className="bg-zinc-800 text-white px-2 py-1 rounded-full text-xs">{`${process.env.NEXT_PUBLIC_SITE_URL || ""}/d/${transfer.transferUrl}`}</code>
            </p>
            <span className="text-[11px] font-mono tracking-[0.14em] text-zinc-500">{transfer.files.length} FILES</span>
          </div>
        )}
        {expired && (
          <p className="mt-4 text-center text-sm font-mono text-red-400">This transfer has expired and files were deleted.</p>
        )}
      </main>
    </div>
  );
}
