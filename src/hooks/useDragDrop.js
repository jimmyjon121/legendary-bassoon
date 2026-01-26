import { useEffect, useState } from 'react';

/**
 * Generic drag & drop hook for files.
 * Returns { isDragging } and wires events on the provided ref.
 */
export function useDragDrop({ targetRef, onFiles }) {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = targetRef?.current;
    if (!el) return;

    let dragDepth = 0;

    const handleDragOver = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDragEnter = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepth += 1;
      setIsDragging(true);
    };

    const handleDragLeave = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepth -= 1;
      if (dragDepth <= 0) {
        dragDepth = 0;
        setIsDragging(false);
      }
    };

    const handleDrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepth = 0;
      setIsDragging(false);

      const dt = event.dataTransfer;
      if (!dt?.files?.length) return;

      const files = Array.from(dt.files);
      if (typeof onFiles === 'function') {
        onFiles(files);
      }
    };

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);

    return () => {
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('drop', handleDrop);
    };
  }, [targetRef, onFiles]);

  return { isDragging };
}

export default useDragDrop;

















