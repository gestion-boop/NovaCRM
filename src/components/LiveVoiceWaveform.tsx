import React, { useEffect, useRef } from 'react';

interface LiveVoiceWaveformProps {
  stream: MediaStream | null;
  barCount?: number;
  className?: string;
}

/**
 * Visualiseur d'ondes audio en direct pour l'enregistrement de messages vocaux.
 * Analyse le flux du microphone en temps réel via l'API Web Audio (AnalyserNode)
 * et anime des barres de fréquences selon l'amplitude de la voix.
 */
export const LiveVoiceWaveform: React.FC<LiveVoiceWaveformProps> = ({
  stream,
  barCount = 18,
  className = 'h-7 flex-1 min-w-[70px] max-w-[220px]',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!stream) return;

    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let animationFrameId: number;

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext = new AudioContextClass();
      if (audioContext.state === 'suspended') {
        void audioContext.resume();
      }
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64; // 32 bins de fréquences
      analyser.smoothingTimeConstant = 0.6; // Mouvement doux et réactif
      source.connect(analyser);
    } catch (err) {
      console.warn('AudioContext non supporté ou bloqué:', err);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const render = () => {
      if (!analyser || !ctx || !canvas) return;

      analyser.getByteFrequencyData(dataArray);

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (width === 0 || height === 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const totalBars = barCount;
      const gap = 2.5;
      const totalGap = gap * (totalBars - 1);
      const barWidth = Math.max(2, (width - totalGap) / totalBars);
      const centerY = height / 2;

      // Calcul du volume moyen
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const isVoiceActive = avg > 6;

      for (let i = 0; i < totalBars; i++) {
        // Fréquences centrées sur la voix humaine
        const freqIndex = Math.floor((i / totalBars) * Math.min(dataArray.length, 24));
        const rawValue = dataArray[freqIndex] || 0;

        // Amplification sensible pour bien voir même une voix douce
        const normalized = Math.min(1, Math.pow(rawValue / 255, 0.8) * 1.35);

        // Hauteur de barre : min 3.5px au repos, max height - 4px
        const minH = 3.5;
        const maxH = height - 4;
        const barHeight = Math.max(minH, normalized * maxH);

        const x = i * (barWidth + gap);
        const y = centerY - barHeight / 2;

        // Dégradé rose / ambre éclatant avec reflets
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        if (isVoiceActive) {
          gradient.addColorStop(0, '#fb7185'); // rose-400
          gradient.addColorStop(0.5, '#f43f5e'); // rose-500
          gradient.addColorStop(1, '#fbcfe8'); // rose-200
        } else {
          gradient.addColorStop(0, 'rgba(244, 63, 94, 0.6)');
          gradient.addColorStop(1, 'rgba(244, 63, 94, 0.35)');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = barWidth / 2;
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barWidth, barHeight, radius);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }

      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (source) {
        try { source.disconnect(); } catch {}
      }
      if (analyser) {
        try { analyser.disconnect(); } catch {}
      }
      if (audioContext && audioContext.state !== 'closed') {
        try { void audioContext.close(); } catch {}
      }
    };
  }, [stream, barCount]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-label="Variation des ondes vocales en direct"
    />
  );
};

export default LiveVoiceWaveform;
