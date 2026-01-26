import { useEffect, useRef, useState } from 'react';

export function useVoiceInput({ onResult } = {}) {
  const [isSupported, setIsSupported] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setIsSupported(false);
    }
  }, []);

  const startRecording = async () => {
    if (!isSupported || isRecording) return;
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          if (!window.electronAPI?.transcribeAudio) {
            setError('Voice transcription is only available in the desktop app.');
            return;
          }
          setIsTranscribing(true);
          const res = await window.electronAPI.transcribeAudio(
            Buffer.from(arrayBuffer),
          );
          if (res?.success && res.text && onResult) {
            onResult(res.text);
          } else if (!res?.success) {
            setError(res?.error || 'Transcription failed');
          }
        } catch (err) {
          console.error('Failed to transcribe audio:', err);
          setError(err.message || String(err));
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err.message || String(err));
      setIsSupported(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording || !mediaRecorderRef.current) return;
    try {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.error('Failed to stop recording:', err);
    } finally {
      setIsRecording(false);
    }
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    isSupported,
    isRecording,
    isTranscribing,
    error,
    startRecording,
    stopRecording,
  };
}

export default useVoiceInput;


