import React, { useMemo } from 'react';
import { X, Paperclip as PaperclipIcon, Image as ImageIcon, Eye } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

// Models known to support vision/multimodal input
const VISION_MODEL_PATTERNS = [
  'llava', 'bakllava', 'moondream', 'cogvlm', 'fuyu', 'internvl',
  'minicpm-v', 'llama3.2-vision', 'gemma2-vision', 'phi-3-vision'
];

function isVisionModel(modelName) {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return VISION_MODEL_PATTERNS.some(p => lower.includes(p));
}

export function ImagePreview({ attachments, onRemove }) {
  const currentModel = useAppStore(s => s.currentModel);
  const hasImages = useMemo(() => 
    attachments?.some(a => a.kind === 'image' || a.mimeType?.startsWith('image/')),
    [attachments]
  );
  const visionCapable = isVisionModel(currentModel);

  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 px-1">
      {/* Vision model indicator */}
      {hasImages && (
        <div className={`flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg text-[10px] ${
          visionCapable 
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
        }`}>
          <Eye size={11} />
          {visionCapable 
            ? `${currentModel?.split(':')[0]} will analyze these images`
            : `${currentModel?.split(':')[0] || 'Current model'} may not support image analysis. Try a vision model like LLaVA.`
          }
        </div>
      )}

      <div className="flex flex-wrap gap-2">
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
                className="absolute top-1 right-1 p-0.5 rounded-full bg-forge-bg/80 text-text-muted hover:text-text-primary hover:bg-forge-hover transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
              
              {/* Image badge */}
              {isImage && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white/60 px-1 py-0.5 text-center truncate">
                  {att.name}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ImagePreview;














