import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume1, Volume2, VolumeX } from 'lucide-react';

/**
 * Panneau flottant unique de Nova (bureau uniquement) — remplace les deux
 * panneaux précédents (console vocale + panneau texte), fusionnés en un
 * seul sur demande explicite. Ne s'affiche QUE lorsqu'il y a une vraie
 * information structurée à montrer (tâches du jour, rendez-vous,
 * statistiques, erreur...) — jamais pour un simple échange de texte
 * conversationnel avec Nova, qui reste porté par l'orbe seul.
 *
 * Contrainte technique (déjà signalée) : `speechSynthesis` (moteur gratuit,
 * choisi pour éviter les coûts ElevenLabs) ne donne accès à aucun
 * échantillon audio réel — la waveform ci-dessous est une animation
 * stylisée réactive à l'état "parle", pas une vraie visualisation
 * d'amplitude.
 */

export type NovaVoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'success' | 'error';

interface NovaInfoPanelProps {
  status: NovaVoiceStatus;
  title: string | null;
  details: string | null;
  isPaused: boolean;
  onTogglePause: () => void;
  onReplay: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  rate: number;
  onRateChange: (v: number) => void;
}

const RATE_OPTIONS = [0.8, 1, 1.2, 1.5];

export const NovaInfoPanel: React.FC<NovaInfoPanelProps> = ({
  status, title, details, isPaused, onTogglePause, onReplay, volume, onVolumeChange, rate, onRateChange,
}) => {
  const [showVolume, setShowVolume] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [title, details]);

  if (!title || !details) return null;

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const isError = status === 'error';

  return (
    <div
      className="hidden lg:flex fixed right-8 top-1/2 -translate-y-1/2 z-[85] flex-col gap-4 w-[340px] max-h-[440px] p-6 rounded-[32px] animate-fade-in overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(20,17,10,0.62) 0%, rgba(8,10,14,0.58) 100%)',
        backdropFilter: 'blur(32px) saturate(140%)',
        WebkitBackdropFilter: 'blur(32px) saturate(140%)',
        border: `1.5px solid ${isError ? 'rgba(248,113,113,0.45)' : 'rgba(247,188,95,0.55)'}`,
        boxShadow: isError
          ? '0 24px 70px -14px rgba(0,0,0,0.65), 0 0 45px -12px rgba(248,113,113,0.35)'
          : '0 24px 70px -14px rgba(0,0,0,0.65), 0 0 45px -10px rgba(247,188,95,0.35)',
      }}
      role="region"
      aria-label="Informations de Nova"
    >
      {/* Liseré lumineux en haut du panneau — effet "verre liquide" Apple,
          simule un reflet de lumière sur le bord supérieur. */}
      <div
        className="absolute inset-x-6 top-0 h-px pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }}
      />

      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`w-1.5 h-1.5 rounded-full ${isError ? 'bg-rose-400' : 'bg-[#F7BC5F]'}`}
          style={{ boxShadow: isError ? '0 0 6px 2px rgba(248,113,113,0.6)' : '0 0 6px 2px rgba(247,188,95,0.6)' }}
        />
        <span className={`text-[10px] font-black uppercase tracking-[0.25em] ${isError ? 'text-rose-300/80' : 'text-[#F9C977]/80'}`}>
          {title}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
        <p className={`text-[13px] leading-relaxed whitespace-pre-line ${isError ? 'text-rose-100/90' : 'text-white/90'}`}>
          {details}
        </p>
      </div>

      {/* Barre de contrôle vocal — intégrée au même panneau (fusionné sur
          demande explicite, "j'en veux qu'un"). */}
      <div className="shrink-0 pt-3.5 border-t border-white/10 flex flex-col gap-3">
        <div className="flex items-center justify-center gap-[3px] h-6" aria-hidden="true">
          {Array.from({ length: 20 }, (_, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-gradient-to-t from-[#F7BC5F]/40 to-[#FFE9B0]"
              style={{
                height: status === 'speaking' && !isPaused ? undefined : '4px',
                animation: status === 'speaking' && !isPaused
                  ? `nova-waveform-bar ${0.6 + (i % 5) * 0.11}s ease-in-out infinite ${(i % 7) * 0.05}s`
                  : 'none',
              }}
            />
          ))}
        </div>
        <style>{`
          @keyframes nova-waveform-bar { 0%, 100% { height: 4px; opacity: 0.55; } 50% { height: 20px; opacity: 1; } }
        `}</style>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onReplay}
            title="Réécouter depuis le début"
            aria-label="Réécouter"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onTogglePause}
            title={isPaused ? 'Reprendre' : 'Mettre en pause'}
            aria-label={isPaused ? 'Reprendre la lecture' : 'Mettre en pause'}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-[#F7BC5F] text-[#1a1230] hover:brightness-105 shadow-lg transition-all active:scale-95"
          >
            {isPaused ? <Play className="w-4 h-4 ml-0.5" /> : <Pause className="w-4 h-4" />}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowVolume((v) => !v)}
              title="Volume"
              aria-label="Régler le volume"
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <VolumeIcon className="w-3.5 h-3.5" />
            </button>
            {showVolume && (
              <div className="absolute bottom-full right-0 mb-2 p-3 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/10 shadow-2xl">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => onVolumeChange(Number(e.target.value))}
                  className="w-24 accent-[#F7BC5F]"
                  aria-label="Volume de Nova"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5">
          {RATE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRateChange(r)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                rate === r ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NovaInfoPanel;
