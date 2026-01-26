import React from 'react';
import { X, Paperclip as PaperclipIcon, Image as ImageIcon } from 'lucide-react';

export function ImagePreview({ attachments, onRemove }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2 px-1">
      {attachments.map((att) => {
        const isImage = att.kind === 'image';
        return (
          <div
            key={att.id}
            className="relative w-20 h-20 rounded-lg border border-forge-border bg-forge-elevated overflow-hidden flex items-center justify-center group"
          >
            {isImage && att.previewUrl ? (
              <img
                src={att.previewUrl}
                alt={att.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-[10px] text-text-muted px-1 text-center">
                {isImage ? (
                  <ImageIcon size={18} className="mb-1 text-text-muted" />
                ) : (
                  <PaperclipIcon size={18} className="mb-1 text-text-muted" />
                )}
                <span className="line-clamp-2">{att.name}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => onRemove?.(att.id)}
              className="absolute top-1 right-1 p-0.5 rounded-full bg-forge-bg/80 text-text-muted hover:text-text-primary hover:bg-forge-hover transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ImagePreview;














