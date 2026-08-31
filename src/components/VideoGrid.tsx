"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Film, Clock, HardDrive } from "lucide-react";

export type DetectedVideo = {
  url: string;
  quality: string;
  ext: string;
  thumbnail?: string;
  size?: string;
  duration?: string;
};

export function VideoGrid({
  videos,
  onDownload,
}: {
  videos: DetectedVideo[];
  onDownload: (video: DetectedVideo) => void;
}) {
  if (!videos.length) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
      {videos.map((v, i) => (
        <Card key={i} className="overflow-hidden border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors group">
          <div className="aspect-video bg-zinc-100 dark:bg-zinc-900 relative overflow-hidden flex items-center justify-center">
            {v.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <Film className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
            )}
            <div className="absolute top-3 left-3 flex gap-2">
              <Badge variant="secondary" className="font-mono text-[10px] tracking-wider bg-white/90 backdrop-blur">
                {v.ext.toUpperCase()}
              </Badge>
              <Badge className="font-mono text-[10px]">{v.quality}</Badge>
            </div>
          </div>
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-xs font-mono text-zinc-500 min-w-0">
              {v.duration && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {v.duration}
                </span>
              )}
              {v.size && (
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" /> {v.size}
                </span>
              )}
              <span className="truncate max-w-[160px] hidden sm:inline">{new URL(v.url).hostname}</span>
            </div>
            <Button size="sm" onClick={() => onDownload(v)} className="shrink-0 rounded-xl gap-1.5">
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
