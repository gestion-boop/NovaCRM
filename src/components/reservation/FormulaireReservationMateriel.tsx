import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Calendar, ChevronDown, ChevronLeft, ChevronRight, MapPin, Briefcase, Hash, FileText, Send, Check,
} from 'lucide-react';
import type { NiveauDispo } from '@/lib/creneauxReservationCamera';

export interface JourCalendrier {
  cle: string;
  jour: number | null;
  selectionne: boolean;
  passe: boolean;
  niveau: NiveauDispo | null;
}

export interface CreneauAffiche {
  debut: string;
  occupe: boolean;
  actif: boolean;
  dansPlage?: boolean;
}

export interface MaterielAffiche {
  id: string;
  label: string;
  detail: string;
  tint: string;
  Icon: LucideIcon;
  selectionne: boolean;
}

export interface ReservationDuJour {
  id: string;
  label: string;
  horaire: string;
  statut: string;
}

interface Props {
  mobile: boolean;
  etape: number;
  onEtape: (etape: number) => void;
  resumes: [string, string, string, string];
  moisLabel: string;
  moisCle: string;
  sensMois: 1 | -1;
  onMoisPrecedent: () => void;
  onMoisSuivant: () => void;
  onAujourdhui: () => void;
  jours: JourCalendrier[];
  onChoisirJour: (jour: number) => void;
  dateChoisie: string;
  ongletHoraire: 'debut' | 'fin';
  onOngletHoraire: (onglet: 'debut' | 'fin') => void;
  debut: string;
  fin: string;
  creneauxDebut: CreneauAffiche[];
  creneauxFin: CreneauAffiche[];
  plage: string;
  onChoisirDebut: (heure: string) => void;
  onChoisirFin: (heure: string) => void;
  reservationsDuJour: ReservationDuJour[];
  materiels: MaterielAffiche[];
  onBasculerMateriel: (id: string) => void;
  lieu: string;
  onLieu: (valeur: string) => void;
  projet: string;
  onProjet: (valeur: string) => void;
  mandat: string;
  onMandat: (valeur: string) => void;
  note: string;
  onNote: (valeur: string) => void;
  onAnnuler: () => void;
  onConfirmer: () => void;
  confirmationLabel: string;
  confirmationDesactivee: boolean;
}

const JOURS_COURTS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const transition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const };

function pastille(niveau: NiveauDispo | null, selectionne: boolean) {
  if (selectionne) return 'bg-white/80';
  if (niveau === 'peu') return 'bg-slate-300';
  if (niveau === 'indisponible') return 'bg-rose-400';
  return 'bg-transparent';
}

function Etape({
  mobile,
  numero,
  titre,
  ouvert,
  resume,
  onOuvrir,
  ancreId,
  children,
}: {
  mobile: boolean;
  numero: number;
  titre: string;
  ouvert: boolean;
  resume: string;
  onOuvrir: () => void;
  ancreId?: string;
  children: ReactNode;
}) {
  const badge = (
    <span className="w-7 h-7 rounded-full bg-violet-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
      {numero}
    </span>
  );

  if (!mobile) {
    return (
      <section id={ancreId} className="min-w-0 scroll-mt-14">
        <div className="flex items-center gap-2.5 mb-3">
          {badge}
          <h3 className="text-[15px] font-semibold text-[var(--ink-1)]">{titre}</h3>
        </div>
        {children}
      </section>
    );
  }

  return (
    <section id={ancreId} className="scroll-mt-14 rounded-2xl border border-[var(--nv-border-1)] bg-[var(--nv-surface-1)] overflow-hidden">
      <button
        type="button"
        onClick={onOuvrir}
        aria-expanded={ouvert}
        className="w-full flex items-center gap-2.5 px-3 py-3 text-left"
      >
        {badge}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[var(--ink-1)]">{titre}</span>
          {!ouvert && resume && (
            <span className="block text-xs text-[var(--ink-2)] truncate">{resume}</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-[var(--ink-3)] transition-transform duration-300 ${ouvert ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {ouvert && (
          <motion.div
            key="corps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function FormulaireReservationMateriel({
  mobile,
  etape,
  onEtape,
  resumes,
  moisLabel,
  moisCle,
  sensMois,
  onMoisPrecedent,
  onMoisSuivant,
  onAujourdhui,
  jours,
  onChoisirJour,
  dateChoisie,
  ongletHoraire,
  onOngletHoraire,
  debut,
  fin,
  creneauxDebut,
  creneauxFin,
  plage,
  onChoisirDebut,
  onChoisirFin,
  reservationsDuJour,
  materiels,
  onBasculerMateriel,
  lieu,
  onLieu,
  projet,
  onProjet,
  mandat,
  onMandat,
  note,
  onNote,
  onAnnuler,
  onConfirmer,
  confirmationLabel,
  confirmationDesactivee,
}: Props) {
  const etapePrecedente = useRef(etape);

  useEffect(() => {
    if (etape === etapePrecedente.current) {
      etapePrecedente.current = etape;
      return;
    }
    etapePrecedente.current = etape;
    const delai = window.setTimeout(() => {
      document.getElementById(`etape-reservation-${etape}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, mobile ? 340 : 0);
    return () => window.clearTimeout(delai);
  }, [etape, mobile]);

  const calendrier = (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1 min-w-0">
          <button type="button" onClick={onMoisPrecedent} aria-label="Mois précédent" className="w-8 h-8 rounded-full text-[var(--ink-2)] hover:bg-[var(--nv-wash)] flex items-center justify-center shrink-0">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={moisCle}
              initial={{ opacity: 0, x: sensMois * 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: sensMois * -12 }}
              transition={{ duration: 0.2 }}
              className="text-sm font-semibold text-[var(--ink-1)] truncate"
            >
              {moisLabel}
            </motion.span>
          </AnimatePresence>
          <button type="button" onClick={onMoisSuivant} aria-label="Mois suivant" className="w-8 h-8 rounded-full text-[var(--ink-2)] hover:bg-[var(--nv-wash)] flex items-center justify-center shrink-0">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button type="button" onClick={onAujourdhui} className="h-8 px-2.5 rounded-full border border-[var(--nv-border-1)] text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--nv-wash)] inline-flex items-center gap-1 shrink-0">
          <Calendar className="w-3.5 h-3.5" />
          Aujourd'hui
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center mb-1">
        {JOURS_COURTS.map((jour, index) => (
          <span key={`${jour}-${index}`} className="text-[11px] font-medium text-[var(--ink-3)] py-1">{jour}</span>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={moisCle}
          initial={{ opacity: 0, x: sensMois * 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: sensMois * -18 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-7 gap-y-1"
        >
          {jours.map((jour) => (
            jour.jour === null ? (
              <span key={jour.cle} />
            ) : (
              <button
                key={jour.cle}
                type="button"
                disabled={jour.passe}
                onClick={() => onChoisirJour(jour.jour as number)}
                className={`relative mx-auto w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors duration-200 ${
                  jour.selectionne
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-950/40'
                    : jour.passe
                      ? 'text-rose-300 cursor-not-allowed'
                      : 'text-[var(--ink-1)] hover:bg-violet-500/15'
                }`}
              >
                {jour.jour}
                {!jour.selectionne && (jour.niveau === 'peu' || jour.niveau === 'indisponible') && (
                  <span className={`absolute bottom-1 w-1 h-1 rounded-full ${pastille(jour.niveau, false)}`} />
                )}
              </button>
            )
          ))}
        </motion.div>
      </AnimatePresence>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11px] text-[var(--ink-2)]">
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-violet-500" /> Disponible</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-slate-300" /> Peu de créneaux</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-rose-400" /> Indisponible</span>
      </div>
    </div>
  );

  const creneauxVisibles = ongletHoraire === 'debut' ? creneauxDebut : creneauxFin;
  const grilleCreneaux = (
    <div>
      <p className="text-xs text-[var(--ink-2)] mb-2 capitalize">{dateChoisie}</p>
      <div role="tablist" aria-label="Horaires" className="grid grid-cols-2 gap-2 mb-3">
        {([
          ['debut', 'Début', debut],
          ['fin', 'Fin', fin],
        ] as const).map(([onglet, libelle, heure]) => {
          const actif = ongletHoraire === onglet;
          return (
            <button
              key={onglet}
              type="button"
              role="tab"
              aria-label={libelle}
              aria-selected={actif}
              onClick={() => onOngletHoraire(onglet)}
              className={`rounded-xl px-2 py-2 text-center transition-colors ${
                actif
                  ? 'bg-violet-600 text-white'
                  : 'bg-[var(--nv-field)] text-[var(--ink-1)] border border-[var(--nv-field-border)]'
              }`}
            >
              <span className={`block text-[10px] font-semibold uppercase tracking-wide ${actif ? 'text-white/80' : 'text-[var(--ink-3)]'}`}>{libelle}</span>
              <span className="block text-lg font-bold tabular-nums leading-tight">{heure}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--ink-2)] mb-2">
        {ongletHoraire === 'debut' ? 'Choisissez l’heure de début' : 'Choisissez l’heure de fin'}
      </p>
      <div className="max-h-56 overflow-y-auto overscroll-contain scroll-smooth rounded-xl">
      <div className="grid grid-cols-3 gap-2">
        {creneauxVisibles.map((creneau) => (
          <button
            key={creneau.debut}
            type="button"
            onClick={() => (ongletHoraire === 'debut' ? onChoisirDebut(creneau.debut) : onChoisirFin(creneau.debut))}
            aria-pressed={creneau.actif}
            className={`h-10 rounded-xl text-sm font-semibold transition-all duration-200 ${
              creneau.occupe
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                : creneau.actif
                  ? 'bg-violet-600 text-white'
                  : creneau.dansPlage
                    ? 'bg-violet-600/40 text-white border border-violet-400'
                    : 'bg-[var(--nv-field)] text-[var(--ink-1)] border border-[var(--nv-field-border)] hover:border-violet-400'
            }`}
          >
            {creneau.debut}
          </button>
        ))}
      </div>
      </div>
      <p className="text-sm font-medium text-[var(--ink-1)] mt-2">{plage}</p>
      {reservationsDuJour.length > 0 && (
        <ul className="mt-2 space-y-1">
          {reservationsDuJour.slice(0, 3).map((reservation) => (
            <li key={reservation.id} className="text-[11px] text-[var(--ink-2)] truncate">
              {reservation.horaire} · {reservation.label} · {reservation.statut}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const cartesMateriel = (
    <div className="space-y-2">
      {materiels.map((materiel) => (
        <button
          key={materiel.id}
          type="button"
          onClick={() => onBasculerMateriel(materiel.id)}
          aria-pressed={materiel.selectionne}
          className={`w-full flex items-center gap-3 p-2 rounded-2xl border text-left transition-all duration-200 ${
            materiel.selectionne
              ? 'border-violet-400 bg-violet-500/15'
              : 'border-[var(--nv-border-1)] bg-[var(--nv-field)] hover:border-violet-400'
          }`}
        >
          <span className={`w-12 h-12 rounded-xl bg-gradient-to-br ${materiel.tint} flex items-center justify-center shrink-0`}>
            <materiel.Icon className="w-5 h-5 text-white" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-[var(--ink-1)] truncate">{materiel.label}</span>
            <span className="block text-xs text-[var(--ink-2)] truncate">{materiel.detail}</span>
          </span>
          <span className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
            materiel.selectionne ? 'bg-violet-600 border-violet-600 text-white' : 'border-[var(--ink-3)]'
          }`}>
            {materiel.selectionne && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
          </span>
        </button>
      ))}
    </div>
  );

  const champ = 'w-full bg-[var(--nv-field)] border border-[var(--nv-field-border)] focus:border-violet-400 rounded-xl px-3 py-2.5 text-sm text-[var(--ink-1)] placeholder:text-[var(--ink-3)] focus:outline-none transition-colors';

  const infos = (
    <div className="space-y-3">
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)] mb-1.5">
          <MapPin className="w-3.5 h-3.5 text-violet-500" />
          Lieu de la prise de vue
        </span>
        <input className={champ} placeholder="Adresse, ville, lieu..." value={lieu} onChange={(e) => onLieu(e.target.value)} />
      </label>
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)] mb-1.5">
          <Briefcase className="w-3.5 h-3.5 text-violet-500" />
          Projet
        </span>
        <input className={champ} placeholder="Nom du projet..." value={projet} onChange={(e) => onProjet(e.target.value)} />
      </label>
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)] mb-1.5">
          <Hash className="w-3.5 h-3.5 text-violet-500" />
          N° mandat (optionnel)
        </span>
        <input className={champ} placeholder="Ex : 2024-001" value={mandat} onChange={(e) => onMandat(e.target.value)} />
      </label>
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)] mb-1.5">
          <FileText className="w-3.5 h-3.5 text-violet-500" />
          Note (optionnel)
        </span>
        <input className={champ} placeholder="Informations supplémentaires..." value={note} onChange={(e) => onNote(e.target.value)} />
      </label>
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onConfirmer();
      }}
      className="space-y-4"
    >
      <nav aria-label="Étapes de la réservation" className="sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-[var(--nv-surface-1)] py-1">
        {([
          [1, 'Date'],
          [2, 'Horaires'],
          [3, 'Matériel'],
          [4, 'Infos'],
        ] as const).map(([numero, libelle]) => {
          const actif = etape === numero;
          return (
            <button
              key={numero}
              type="button"
              aria-current={actif ? 'step' : undefined}
              aria-label={`Étape ${numero} : ${libelle}`}
              onClick={() => onEtape(numero)}
              className={`shrink-0 h-9 px-3 rounded-full text-sm font-semibold transition-colors ${
                actif
                  ? 'bg-violet-600 text-white'
                  : 'bg-[var(--nv-field)] text-[var(--ink-1)] border border-[var(--nv-field-border)]'
              }`}
            >
              {numero}. {libelle}
            </button>
          );
        })}
      </nav>
      <div className={mobile ? 'space-y-3' : 'grid grid-cols-2 xl:grid-cols-4 gap-6 items-start'}>
        <Etape mobile={mobile} numero={1} titre="Choisir une date" ouvert={etape === 1} resume={resumes[0]} onOuvrir={() => onEtape(1)} ancreId="etape-reservation-1">
          {calendrier}
        </Etape>
        <Etape mobile={mobile} numero={2} titre="Choisir un créneau" ouvert={etape === 2} resume={resumes[1]} onOuvrir={() => onEtape(2)} ancreId="etape-reservation-2">
          {grilleCreneaux}
        </Etape>
        <Etape mobile={mobile} numero={3} titre="Matériel" ouvert={etape === 3} resume={resumes[2]} onOuvrir={() => onEtape(3)} ancreId="etape-reservation-3">
          {cartesMateriel}
        </Etape>
        <Etape mobile={mobile} numero={4} titre="Informations" ouvert={etape === 4} resume={resumes[3]} onOuvrir={() => onEtape(4)} ancreId="etape-reservation-4">
          {infos}
        </Etape>
      </div>

      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-[var(--nv-border-1)] bg-[var(--nv-surface-1)] py-3">
        <button type="button" onClick={onAnnuler} className="px-4 py-2.5 text-sm font-medium text-[var(--ink-2)] hover:text-[var(--ink-1)]">
          Annuler
        </button>
        <button
          type="submit"
          disabled={confirmationDesactivee}
          className="px-5 py-3 rounded-full bg-[#F5C451] hover:bg-[#e6b43a] text-[#1a1230] text-sm font-semibold shadow-sm inline-flex items-center gap-2 disabled:opacity-50 transition-colors"
        >
          <Send className="w-4 h-4" />
          {confirmationLabel}
        </button>
      </div>
    </form>
  );
}
