import React from 'react';
import { Mic, MicOff, Loader } from 'lucide-react';
import { useVoiceInput } from '../../hooks/useVoiceInput';

export function VoiceInput({ onResult }) {
  const {
    isSupported,
    isRecording,
    isTranscribing,
    error,
    startRecording,
    stopRecording,
  } = useVoiceInput({ onResult });

  const handleClick = () => {
    if (!isSupported) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={!isSupported || isTranscribing}
        className={`
          p-2 rounded-lg transition-colors
          ${isRecording
            ? 'bg-status-error/20 text-status-error'
            : 'text-text-muted hover:text-text-secondary hover:bg-forge-hover'
          }
        `}
        title={
          !isSupported
            ? 'Voice input not supported in this environment'
            : isRecording
            ? 'Stop recording'
            : 'Start voice input'
        }
      >
        {isTranscribing ? (
          <Loader className="w-4 h-4 animate-spin" />
        ) : isRecording ? (
          <MicOff className="w-4 h-4" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
      </button>
      {error && (
        <div className="absolute -top-8 right-0 max-w-xs px-2 py-1 text-[10px] rounded bg-status-error/90 text-white shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}

export default VoiceInput;


