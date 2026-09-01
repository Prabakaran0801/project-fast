"use client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Film, Clock, HardDrive } from "lucide-react";

export type DetectedVideo = {
  url: string;
  quality: string;
  height?: number;
  ext: string;
  thumbnail?: string;
  size?: string;
  duration?: string;
  hasAudio?: boolean;
  needsMerge?: boolean;
};

export function VideoGrid({
  videos,
  onDownload,
}: {
  videos: DetectedVideo[];
  onDownload: (video: DetectedVideo) => void;
  jobId?: string | null;
}) {
  if (!videos.length) return null;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6"
    >
      {videos.map((v, i) => (
        <motion.div
          key={i}
          variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="motion-safe"
        >
          <Card className="overflow-hidden border-zinc-800 bg-[#121214] rounded-2xl shadow-sm hover:border-zinc-700 transition-colors duration-150 group">
            <div className="aspect-video bg-zinc-900 relative overflow-hidden flex items-center justify-center border-b border-zinc-800">
              {v.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.thumbnail}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-[1.015] will-change-transform"
                  style={{ transition: "transform 150ms ease-out" }}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-zinc-600">
                  <Film className="h-9 w-9" aria-hidden />
                  <span className="text-[11px] font-mono tracking-[0.14em]">NO PREVIEW</span>
                </div>
              )}
              <div className="absolute top-3 left-3 flex gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px] tracking-[0.12em] bg-zinc-800 border-zinc-700 text-zinc-200 px-2 py-1 rounded-full">
                  {v.ext.toUpperCase()}
                </Badge>
                <Badge className="font-mono text-[10px] tracking-[0.12em] rounded-full px-2 py-1 bg-white text-zinc-900">{v.quality}</Badge>
              </div>
            </div>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 min-w-0 flex-wrap">
                {v.duration && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-800 text-zinc-300">
                    <Clock className="h-3 w-3" aria-hidden /> {v.duration}
                  </span>
                )}
                {v.size && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-800 text-zinc-300">
                    <HardDrive className="h-3 w-3" aria-hidden /> {v.size}
                  </span>
                )}
              </div>
              <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15, ease: "easeOut" }}>
                <Button
                  size="sm"
                  onClick={() => onDownload(v)}
                  aria-label={`Download ${v.quality}`}
                  className="shrink-0 rounded-full gap-1.5 bg-white text-zinc-900 hover:bg-zinc-200 h-8 px-4 text-xs font-medium"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden /> Download
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}
