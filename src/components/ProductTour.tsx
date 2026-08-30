import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';

export interface TourStep {
  selector: string | null; // null = étape sans cible, juste un message centré
  title: string;
  text: string;
  // Exécutée dès que cette étape devient active — pour déclencher une
  // action de l'appli avant de mesurer la cible (ex. ouvrir le panneau
  // "Menu" avant de surligner un onglet dedans).
  onEnter?: () => void;
  // Étape interactive : l'utilisateur doit accomplir une vraie action dans
  // l'appli (ex. créer son premier contact) au lieu de cliquer "Suivant" —
  // le bouton est masqué, remplacé par une invite, et l'avancée se fait via
  // `signalNext` une fois l'action détectée côté appelant.
  waitForAction?: boolean;
}

interface ProductTourProps {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
  // Incrémenté par l'appelant pour faire avancer une étape `waitForAction`
  // une fois l'action réelle de l'utilisateur détectée (ex. contact créé).
  signalNext?: number;
  // Masque temporairement la visite (sans perdre sa position) pendant
  // qu'une vraie modale de l'appli est ouverte par-dessus — sinon le voile
  // de la visite (z-index élevé) bloquerait l'interaction avec elle.
  paused?: boolean;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;

// Visite guidée — surligne en jaune l'élément réel de l'interface concerné
// par chaque étape (halo + pointillés), avec une bulle d'explication et une
// flèche, "Suivant"/"Précédent" pour avancer. Cible le DOM en direct (via
// data-tour="...") plutôt que des captures d'écran, pour rester juste même
// si l'app évolue.
const ProductTour = ({ steps, open, onClose, signalNext, paused }: ProductTourProps) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');

  const step = steps[stepIndex];

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  // Avance automatiquement une étape `waitForAction` dès que l'appelant
  // signale que l'action réelle a été accomplie (ex. contact créé).
  const isFirstSignal = useRef(true);
  useEffect(() => {
    if (isFirstSignal.current) { isFirstSignal.current = false; return; }
    if (!open) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalNext]);

  useLayoutEffect(() => {
    if (!open || !step) return;

    step.onEnter?.();

    const measure = () => {
      if (!step.selector) { setRect(null); return; }
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      const r = el.getBoundingClientRect();
      const nextRect = { top: r.top, left: r.left, width: r.width, height: r.height };
      setRect(nextRect);
      setPlacement(r.top > window.innerHeight / 2 ? 'top' : 'bottom');
    };

    // Un léger délai laisse le scrollIntoView + toute navigation déclenchée
    // par l'étape précédente se stabiliser avant de mesurer.
    const t = window.setTimeout(measure, 260);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, stepIndex, step]);

  if (!open || !step || paused) return null;

  const isLast = stepIndex === steps.length - 1;

  return (
    // Bug remonté : ce conteneur couvrait tout l'écran et interceptait les
    // clics partout, y compris sur la vraie cible surlignée — le "trou" du
    // spotlight n'est qu'un effet visuel (box-shadow), pas une vraie
    // découpe cliquable. `pointer-events-none` ici, ré-activé seulement sur
    // les éléments propres à la visite (croix, bulle), laisse les clics
    // traverser jusqu'à l'appli partout ailleurs — indispensable pour les
    // étapes `waitForAction` où l'utilisateur doit cliquer le vrai bouton.
    <div className="fixed inset-0 z-[300] pointer-events-none" role="dialog" aria-modal="true">
      {/* Voile assombri avec un "trou" en spotlight sur la cible, via un
          énorme box-shadow — pas de découpe SVG à maintenir. */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={
          rect
            ? {
                top: rect.top - PADDING,
                left: rect.left - PADDING,
                width: rect.width + PADDING * 2,
                height: rect.height + PADDING * 2,
                position: 'fixed',
                borderRadius: 16,
                boxShadow: '0 0 0 9999px rgba(4,10,13,0.82)',
                border: '3px solid #F7BC5F',
                outline: '3px solid rgba(247,188,95,0.35)',
                outlineOffset: 4,
                pointerEvents: 'none',
              }
            : { background: 'rgba(4,10,13,0.82)' }
        }
      />

      <button
        onClick={onClose}
        className="fixed top-6 right-6 z-10 p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white backdrop-blur-md pointer-events-auto"
        title="Fermer la visite"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Bulle d'explication */}
      <div
        className="fixed z-10 w-[92vw] max-w-sm bg-[#0E1A20] border-2 border-[#F7BC5F] rounded-2xl shadow-2xl p-5 animate-fade-in pointer-events-auto"
        style={
          rect
            ? placement === 'bottom'
              ? { top: Math.min(rect.top + rect.height + PADDING + 14, window.innerHeight - 220), left: Math.max(12, Math.min(rect.left, window.innerWidth - 396)) }
              : { top: Math.max(12, rect.top - PADDING - 14 - 200), left: Math.max(12, Math.min(rect.left, window.innerWidth - 396)) }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        }
      >
        {/* Petite flèche pointant vers la cible */}
        {rect && (
          <div
            className={`absolute w-4 h-4 bg-[#0E1A20] border-[#F7BC5F] ${
              placement === 'bottom'
                ? 'border-t-2 border-l-2 -top-2 rotate-45 left-8'
                : 'border-b-2 border-r-2 -bottom-2 rotate-45 left-8'
            }`}
          />
        )}

        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-bold text-[#F9C977] uppercase tracking-wider">
            Étape {stepIndex + 1} / {steps.length}
          </span>
        </div>
        <h3 className="text-lg font-black text-white mb-2 text-wrap-balance">{step.title}</h3>
        <p className="text-sm text-slate-300 leading-relaxed mb-5">{step.text}</p>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {steps.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === stepIndex ? 'bg-[#F7BC5F]' : 'bg-white/20'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {stepIndex > 0 && (
              <button
                onClick={() => setStepIndex((i) => i - 1)}
                className="px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Précédent
              </button>
            )}
            {step.waitForAction ? (
              <button
                onClick={() => setStepIndex((i) => Math.min(i + 1, steps.length - 1))}
                className="px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5"
              >
                Passer cette étape
              </button>
            ) : (
              <button
                onClick={() => (isLast ? onClose() : setStepIndex((i) => i + 1))}
                className="px-4 py-2 rounded-xl text-xs font-bold text-black bg-[#F7BC5F] hover:bg-[#d9ab38] flex items-center gap-1.5"
              >
                {isLast ? 'Terminer' : 'Suivant'} {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        {step.waitForAction && (
          <p className="text-[11px] text-[#F9C977] mt-2.5 flex items-center gap-1.5 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F9C977]" />
            En attente de votre action...
          </p>
        )}
      </div>
    </div>
  );
};

export default ProductTour;
