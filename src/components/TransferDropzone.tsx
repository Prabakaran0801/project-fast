"use client";
import { useCallback, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadCloud, File as FileIcon, X, Link2, Copy, Check } from "lucide-react";

export function TransferDropzone() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);
    try {
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // In MVP, direct upload to R2 is mocked — we just show share URL
      // Real flow: use data.uploadUrls with tus-js-client to upload each file
      setShareUrl(data.transferUrl || `${window.location.origin}/d/mock123`);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const totalSize = files.reduce((a, f) => a + f.size, 0);

  if (shareUrl) {
    return (
      <Card className="p-8 text-center border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-500 text-white grid place-items-center mb-4">
          <Link2 className="h-6 w-6" />
        </div>
        <h3 className="font-semibold">Transfer ready</h3>
        <p className="text-sm text-zinc-500 font-mono mt-1">Expires in 7 days — share this link</p>
        <div className="mt-4 flex items-center gap-2 max-w-md mx-auto">
          <code className="flex-1 text-sm font-mono bg-white dark:bg-zinc-900 border rounded-xl px-3 py-2.5 truncate text-left">
            {shareUrl}
          </code>
          <Button
            size="icon"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <Button variant="ghost" className="mt-4" onClick={() => { setFiles([]); setShareUrl(null); }}>
          Send another
        </Button>
      </Card>
    );
  }

  return (
    <Card
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`p-8 border-2 border-dashed transition-colors ${dragOver ? "border-zinc-900 bg-zinc-50 dark:bg-zinc-900 dark:border-white" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"}`}
    >
      <div className="text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 grid place-items-center mb-3">
          <UploadCloud className="h-6 w-6" />
        </div>
        <h3 className="font-semibold">Drop files here</h3>
        <p className="text-sm text-zinc-500 mt-1 font-mono">or click to browse — up to 5GB, resumable via TUS</p>
        <label className="mt-4 inline-block">
          <input type="file" multiple className="hidden" onChange={onFileChange} />
          <span className="inline-flex items-center justify-center h-10 px-5 rounded-xl bg-zinc-900 text-white text-sm font-medium cursor-pointer hover:bg-zinc-800 dark:bg-white dark:text-zinc-900">
            Browse files
          </span>
        </label>
      </div>

      {files.length > 0 && (
        <div className="mt-6 space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl border bg-zinc-50 dark:bg-zinc-800/50 text-sm">
              <FileIcon className="h-4 w-4 text-zinc-500 shrink-0" />
              <span className="flex-1 truncate font-mono text-xs">{f.name}</span>
              <span className="text-xs text-zinc-500 font-mono">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
              <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs font-mono text-zinc-500">{files.length} files · {(totalSize / 1024 / 1024).toFixed(1)} MB</span>
            <Button onClick={handleUpload} disabled={uploading} className="rounded-xl">
              {uploading ? "Uploading..." : "Create transfer"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
