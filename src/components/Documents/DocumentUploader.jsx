import React, { useState } from 'react';
import { Upload, Loader } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function DocumentUploader({ onUploaded }) {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleSelectFiles = async () => {
    if (!window.electronAPI?.selectFile) {
      setError('Document upload is only available in the desktop app.');
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const filePath = await window.electronAPI.selectFile({
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['txt', 'md', 'pdf', 'docx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (!filePath) {
        setIsUploading(false);
        return;
      }

      const res = await window.electronAPI.ingestDocument({
        filePath,
        workspace: currentWorkspace,
      });

      if (!res?.success) {
        throw new Error(res?.error || 'Failed to ingest document');
      }

      if (onUploaded) {
        onUploaded(res.document);
      }
    } catch (err) {
      console.error('Failed to upload document:', err);
      setError(err.message || String(err));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleSelectFiles}
        disabled={isUploading}
        className="btn btn-secondary text-xs"
      >
        {isUploading ? <Loader className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Add document
      </button>
      {error && (
        <div className="text-[11px] text-status-error bg-status-error/10 border border-status-error/40 rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}

export default DocumentUploader;


