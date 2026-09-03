import { useEffect, useRef, useState } from 'react';

/**
 * Mascotte Nova animée — pack "Nova Animation Plus" fourni par Sylvain
 * (16 états PNG dédiés, plus vivants que l'ancien montage à calques).
 * Portage React du composant JS fourni (assets dans
 * /public/nova-mascotte/states/, styles dans index.css sous .nova-mascotte).
 *
 * Remplace l'ancien montage à 3 calques (corps + main gauche + main droite)
 * qui s'est avéré être 3 copies de la même image complète plutôt que des
 * calques isolés (ticket #21/#33) — chaque état est ici une image entière et
 * cohérente, pas de recomposition à risque.
 */
export type NovaState =
  | 'idle' | 'blink' | 'wave-left' | 'wave-right' | 'welcome' | 'thinking'
  | 'speaking' | 'listening' | 'success' | 'alert' | 'error' | 'surprised'
  | 'processing' | 'sleeping' | 'celebration' | 'pointing';

const NOVA_STATES: NovaState[] = [
  'idle', 'blink', 'wave-left', 'wave-right', 'welcome', 'thinking',
  'speaking', 'listening', 'success', 'alert', 'error', 'surprised',
  'processing', 'sleeping', 'celebration', 'pointing',
];

// États tirés au sort pendant les temps morts, pour que Nova ne reste jamais
// totalement figée entre deux actions réelles.
const IDLE_LOOP_CHOICES: NovaState[] = ['blink', 'wave-left', 'wave-right', 'thinking', 'listening'];

interface NovaMascotteProps {
  taille?: number;
  className?: string;
  /** État piloté depuis l'extérieur (ex. "thinking" pendant que Nova répond).
   *  Laisser vide pour l'animation d'attente automatique uniquement. */
  state?: NovaState;
  /** Demande de Sylvain (3 septembre) : « laisse le logo Nova fixe » — pas de
   *  flottement, pas d'aura qui respire, pas de clignements aléatoires. */
  fixe?: boolean;
}

const NovaMascotte = ({ taille = 220, className = '', state: controlledState, fixe = false }: NovaMascotteProps) => {
  const [autoState, setAutoState] = useState<NovaState>('idle');
  const [changing, setChanging] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const changeTimerRef = useRef<number | null>(null);

  // Boucle d'attente naturelle — seulement quand rien n'est piloté depuis
  // l'extérieur (sinon on respecte l'état réel de Nova : réflexion, parole...).
  useEffect(() => {
    if (controlledState || fixe) return;
    const scheduleNext = () => {
      idleTimerRef.current = window.setTimeout(() => {
        const choice = IDLE_LOOP_CHOICES[Math.floor(Math.random() * IDLE_LOOP_CHOICES.length)];
        setAutoState(choice);
        const back = choice === 'blink' ? 260 : 1400;
        window.setTimeout(() => setAutoState('idle'), back);
        scheduleNext();
      }, 4500 + Math.random() * 3500);
    };
    idleTimerRef.current = window.setTimeout(scheduleNext, 2600);
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [controlledState, fixe]);

  const activeState = controlledState || autoState;
  const prevStateRef = useRef(activeState);

  // Petit fondu au changement d'état, comme le pack d'origine.
  useEffect(() => {
    if (prevStateRef.current === activeState) return;
    prevStateRef.current = activeState;
    setChanging(true);
    changeTimerRef.current = window.setTimeout(() => setChanging(false), 90);
    return () => {
      if (changeTimerRef.current) window.clearTimeout(changeTimerRef.current);
    };
  }, [activeState]);

  return (
    <div
      className={`nova-mascotte ${className}`}
      style={{ ['--nova-size' as string]: `${taille}px` }}
      data-state={activeState}
      data-fixe={fixe ? 'true' : 'false'}
      data-changing={changing ? 'true' : 'false'}
      role="img"
      aria-label="Nova, assistant IA Nova CRM"
    >
      <img className="nova-plus__image" src={`/nova-mascotte/states/nova-${activeState}.png`} alt="" />
    </div>
  );
};

export default NovaMascotte;
export { NOVA_STATES };
