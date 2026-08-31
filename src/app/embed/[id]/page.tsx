import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; idx?: string }> }) {
  const { id } = await params;
  return { title: `Embed — ${id.slice(0, 8)}` };
}

export default async function EmbedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; idx?: string }> }) {
  const { id } = await params;
  const { q, idx } = await searchParams;

  let job: any = null;
  try {
    job = await prisma.downloadJob.findUnique({ where: { id } });
  } catch {}

  let videoUrl: string | null = null;
  let thumb: string | null = null;
  let title = "Embedded video";

  if (job?.detectedUrls && Array.isArray(job.detectedUrls)) {
    const list = job.detectedUrls as any[];
    let chosen = null;
    if (q) chosen = list.find((v) => v.quality === q);
    if (!chosen && idx !== undefined) {
      const n = parseInt(idx, 10);
      if (!isNaN(n) && list[n]) chosen = list[n];
    }
    if (!chosen) chosen = list[0];
    if (chosen) {
      videoUrl = job.fileUrl && chosen.needsMerge ? job.fileUrl : chosen.url;
      thumb = chosen.thumbnail || null;
      title = chosen.title || job.sourceUrl || title;
    }
  }

  // Fallback to fileUrl if no detected list
  if (!videoUrl && job?.fileUrl) videoUrl = job.fileUrl;

  if (!videoUrl) {
    return (
      <div className="min-h-screen bg-black text-zinc-400 grid place-items-center font-mono p-8">
        <div className="text-center">
          <p className="text-sm">Video not found or expired</p>
          <p className="text-xs opacity-60 mt-1 break-all">{id}</p>
        </div>
      </div>
    );
  }

  // Minimal embeddable player — fills viewport, no header
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <video
        controls
        playsInline
        poster={thumb || undefined}
        src={videoUrl}
        className="w-full h-screen object-contain bg-black block"
        title={title}
      />
      <div className="absolute bottom-2 left-2 text-[10px] font-mono tracking-wide bg-black/60 text-white px-2 py-1 rounded-full backdrop-blur">
        SPEEDDL EMBED • {job?.sourceUrl ? new URL(job.sourceUrl).hostname.replace("www.", "") : "video"}
      </div>
    </div>
  );
}
