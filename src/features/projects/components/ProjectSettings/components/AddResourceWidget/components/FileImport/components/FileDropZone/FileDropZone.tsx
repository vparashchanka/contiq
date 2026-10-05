"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, File, Upload, X } from "lucide-react";
import { cn } from "@/libs/utils/cn";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB } from "@/libs/fileUpload";

interface FileDropZoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
}

export function FileDropZone({ file, onFileChange }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((candidate: File) => {
    if (candidate.size > MAX_FILE_SIZE) {
      setSizeError(true);
      return;
    }
    setSizeError(false);
    onFileChange(candidate);
  }, [onFileChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, [handleFile]);

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100">
          <File size={16} className="text-brand-600" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-brand-900">{file.name}</p>
          <p className="text-xs text-brand-400">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        <button onClick={() => onFileChange(null)}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-brand-400 transition-colors hover:bg-brand-100 hover:text-brand-700">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => { setSizeError(false); inputRef.current?.click(); }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-8 transition-all",
          sizeError
            ? "border-red-300 bg-red-50"
            : isDragging
              ? "border-sienna bg-sienna/5"
              : "border-brand-200 bg-brand-50/50 hover:border-brand-400 hover:bg-brand-50"
        )}
      >
        <div className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
          sizeError ? "bg-red-100" : isDragging ? "bg-sienna/15" : "bg-brand-100"
        )}>
          {sizeError
            ? <AlertTriangle size={20} className="text-red-500" strokeWidth={1.5} />
            : <Upload size={20} className={isDragging ? "text-sienna" : "text-brand-500"} strokeWidth={1.5} />
          }
        </div>
        <div className="text-center">
          <p className={cn("text-sm font-medium", sizeError ? "text-red-600" : "text-brand-700")}>
            {sizeError ? `File exceeds ${MAX_FILE_SIZE_MB} MB limit` : isDragging ? "Release to upload" : "Drop your document here"}
          </p>
          <p className={cn("mt-1 text-xs", sizeError ? "text-red-400" : "text-brand-400")}>
            {sizeError ? "Please choose a smaller PDF file" : `or click to browse — PDF files up to ${MAX_FILE_SIZE_MB} MB`}
          </p>
        </div>
        <input ref={inputRef} type="file" accept=".pdf" className="hidden"
          onChange={(e) => { const selected = e.target.files?.[0]; if (selected) handleFile(selected); }} />
      </div>
    </div>
  );
}
