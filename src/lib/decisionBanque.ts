// Décision de la banque sur un dossier Conseils Finances (leads.decision_banque).
// Elle colore la carte du dossier dans le pipeline.
export type DecisionBanque = 'accord' | 'refus' | 'refus_accord_travail';

export const DECISIONS_BANQUE: Array<{ value: DecisionBanque; label: string; court: string; couleur: string }> = [
  { value: 'accord', label: 'Accord', court: 'Accord', couleur: '#22c55e' },
  { value: 'refus', label: 'Refus', court: 'Refus', couleur: '#ef4444' },
  { value: 'refus_accord_travail', label: 'Refus — accord pour travailler le dossier', court: 'Refus, on travaille', couleur: '#f97316' },
];

export const estDecisionBanque = (v: unknown): v is DecisionBanque =>
  v === 'accord' || v === 'refus' || v === 'refus_accord_travail';

export const couleurDecisionBanque = (v: unknown): string | null =>
  DECISIONS_BANQUE.find((d) => d.value === v)?.couleur ?? null;
