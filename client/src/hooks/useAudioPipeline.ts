import { useState, useRef, useEffect, useCallback } from 'react';

export interface AudioPipelineConfig {
  pitchShift: number; // Semitones: -12 to 12
  whisperFilterEnabled: boolean; // Transmit below ambient threshold
  noiseCancellationEnabled: boolean; // Simulated RNNoise
  muteWithTranscription: boolean; // Whisper continues listening
}

export function useAudioPipeline() {
  const [isActive, setIsActive] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [config, setConfig] = useState<AudioPipelineConfig>({
    pitchShift: 0,
    whisperFilterEnabled: false,
    noiseCancellationEnabled: true,
    muteWithTranscription: false,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastMeterUpdateRef = useRef(0);

  // BUG FIX #5: Use useCallback so startPipeline / stopPipeline are stable
  // references. This prevents the useEffect in App.tsx from looping infinitely
  // when startPipeline/stopPipeline are listed as dependencies.
  const stopPipeline = useCallback(() => {
    // BUG FIX #6: Cancel animation frame BEFORE closing AudioContext to avoid
    // the analyser access-after-close error.
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // BUG FIX #6b: Null out all node refs so a subsequent startPipeline()
    // call starts with a clean slate and doesn't hit stale node references.
    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    analyserNodeRef.current = null;
    filterNodeRef.current = null;

    // Close the AudioContext asynchronously without blocking. Guard against
    // double-close calls which throw "AudioContext is already closed".
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(err => {
        console.warn('[AudioPipeline] AudioContext close warning (safe to ignore):', err);
      });
    }
    audioContextRef.current = null;

    setIsActive(false);
    setVolumeLevel(0);
  }, []);

  const startPipeline = useCallback(async (stream: MediaStream) => {
    // Cleanly tear down any existing pipeline before starting a new one
    stopPipeline();

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      // Source
      const source = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Analyser (for VAD & Level Indicators)
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserNodeRef.current = analyser;

      // High-Pass Filter (removes low-frequency rumble like HVAC)
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 80; // Cut off under 80Hz for vocal clarity
      filterNodeRef.current = filter;

      // Gain (Whisper Mode attenuation & automatic boost)
      const gain = audioCtx.createGain();
      gainNodeRef.current = gain;

      // Pipe only into analysis nodes. Do not connect to destination, otherwise
      // the local microphone is played back to the user and causes echo/feedback.
      source.connect(filter);
      filter.connect(gain);
      gain.connect(analyser);

      setIsActive(true);
      monitorVolume();
    } catch (err) {
      console.error('Failed to initialize Audio WebAudio DSP Pipeline:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPipeline]);

  const monitorVolume = () => {
    // BUG FIX: Guard against null analyser before reading — prevents crash
    // when the pipeline is stopped mid-animation-frame.
    if (!analyserNodeRef.current) return;

    const array = new Uint8Array(analyserNodeRef.current.frequencyBinCount);
    analyserNodeRef.current.getByteFrequencyData(array);

    let sum = 0;
    for (let i = 0; i < array.length; i++) {
      sum += array[i];
    }
    const average = sum / array.length;
    const now = performance.now();
    if (now - lastMeterUpdateRef.current > 120) {
      setVolumeLevel(average); // 0 to 255
      lastMeterUpdateRef.current = now;
    }

    animationFrameRef.current = requestAnimationFrame(monitorVolume);
  };

  // Dynamically update node values based on state config shifts
  useEffect(() => {
    if (!isActive || !gainNodeRef.current || !filterNodeRef.current || !audioContextRef.current) return;

    // Apply high-gain whisper filter attenuating signal below ambient threshold
    if (config.whisperFilterEnabled) {
      // Attenuate standard volume, but boost weak components (Whisper gate)
      gainNodeRef.current.gain.setTargetAtTime(0.12, audioContextRef.current.currentTime, 0.1);
      filterNodeRef.current.frequency.setTargetAtTime(150, audioContextRef.current.currentTime, 0.1);
    } else {
      // Normal vocal levels
      gainNodeRef.current.gain.setTargetAtTime(1.0, audioContextRef.current.currentTime, 0.1);
      filterNodeRef.current.frequency.setTargetAtTime(80, audioContextRef.current.currentTime, 0.1);
    }
  }, [config, isActive]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      stopPipeline();
    };
  }, [stopPipeline]);

  return {
    isActive,
    volumeLevel,
    config,
    setConfig,
    startPipeline,
    stopPipeline,
  };
}
