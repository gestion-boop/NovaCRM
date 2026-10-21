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
  creneaux: CreneauAffiche[];
  plage: string;
  onChoisirCreneau: (debut: string) => void;
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
      <section id={ancreId} className="min-w-0">
        <div className="flex items-center gap-2.5 mb-3">
          {badge}
          <h3 className="text-[15px] font-semibold text-slate-900">{titre}</h3>
        </div>
        {children}
      </section>
    );
  }

  return (
    <section id={ancreId} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onOuvrir}
        aria-expanded={ouvert}
        className="w-full flex items-center gap-2.5 px-3 py-3 text-left"
      >
        {badge}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{titre}</span>
          {!ouvert && resume && (
            <span className="block text-xs text-slate-500 truncate">{resume}</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${ouvert ? 'rotate-180' : ''}`} />
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
  creneaux,
  plage,
  onChoisirCreneau,
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
    if (!mobile || etape === etapePrecedente.current) {
      etapePrecedente.current = etape;
      return;
    }
    etapePrecedente.current = etape;
    document.getElementById(`etape-reservation-${etape}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [etape, mobile]);

  const calendrier = (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1 min-w-0">
          <button type="button" onClick={onMoisPrecedent} aria-label="Mois précédent" className="w-8 h-8 rounded-full text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={moisCle}
              initial={{ opacity: 0, x: sensMois * 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: sensMois * -12 }}
              transition={{ duration: 0.2 }}
              className="text-sm font-semibold text-slate-800 truncate"
            >
              {moisLabel}
            </motion.span>
          </AnimatePresence>
          <button type="button" onClick={onMoisSuivant} aria-label="Mois suivant" className="w-8 h-8 rounded-full text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button type="button" onClick={onAujourdhui} className="h-8 px-2.5 rounded-full border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1 shrink-0">
          <Calendar className="w-3.5 h-3.5" />
          Aujourd'hui
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center mb-1">
        {JOURS_COURTS.map((jour, index) => (
          <span key={`${jour}-${index}`} className="text-[11px] font-medium text-slate-400 py-1">{jour}</span>
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
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-200'
                    : jour.passe
                      ? 'text-rose-300 cursor-not-allowed'
                      : 'text-slate-800 hover:bg-violet-50'
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
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-violet-500" /> Disponible</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-slate-300" /> Peu de créneaux</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-rose-400" /> Indisponible</span>
      </div>
    </div>
  );

  const grilleCreneaux = (
    <div>
      <p className="text-xs text-slate-500 mb-2 capitalize">{dateChoisie}</p>
      <div className="grid grid-cols-3 gap-2">
        {creneaux.map((creneau) => (
          <button
            key={creneau.debut}
            type="button"
            onClick={() => onChoisirCreneau(creneau.debut)}
            aria-pressed={creneau.actif}
            className={`h-10 rounded-xl text-sm font-semibold transition-all duration-200 ${
              creneau.actif
                ? 'bg-violet-600 text-white shadow-md shadow-violet-200 scale-[1.02]'
                : creneau.occupe
                  ? 'bg-rose-50 text-rose-400 border border-rose-100'
                  : 'bg-white text-slate-700 border border-slate-200 hover:border-violet-300 hover:bg-violet-50'
            }`}
          >
            {creneau.debut}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2">{plage}</p>
      {reservationsDuJour.length > 0 && (
        <ul className="mt-2 space-y-1">
          {reservationsDuJour.slice(0, 3).map((reservation) => (
            <li key={reservation.id} className="text-[11px] text-slate-500 truncate">
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
              ? 'border-violet-500 bg-violet-50/60 shadow-sm'
              : 'border-slate-200 bg-white hover:border-violet-200'
          }`}
        >
          <span className={`w-12 h-12 rounded-xl bg-gradient-to-br ${materiel.tint} flex items-center justify-center shrink-0`}>
            <materiel.Icon className="w-5 h-5 text-slate-700" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-slate-900 truncate">{materiel.label}</span>
            <span className="block text-xs text-slate-500 truncate">{materiel.detail}</span>
          </span>
          <span className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
            materiel.selectionne ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300'
          }`}>
            {materiel.selectionne && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
          </span>
        </button>
      ))}
    </div>
  );

  const champ = 'w-full bg-white border border-slate-200 focus:border-violet-400 rounded-xl px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none transition-colors';

  const infos = (
    <div className="space-y-3">
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
          <MapPin className="w-3.5 h-3.5 text-violet-500" />
          Lieu de la prise de vue
        </span>
        <input className={champ} placeholder="Adresse, ville, lieu..." value={lieu} onChange={(e) => onLieu(e.target.value)} />
      </label>
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
          <Briefcase className="w-3.5 h-3.5 text-violet-500" />
          Projet
        </span>
        <input className={champ} placeholder="Nom du projet..." value={projet} onChange={(e) => onProjet(e.target.value)} />
      </label>
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
          <Hash className="w-3.5 h-3.5 text-violet-500" />
          N° mandat (optionnel)
        </span>
        <input className={champ} placeholder="Ex : 2024-001" value={mandat} onChange={(e) => onMandat(e.target.value)} />
      </label>
      <label className="block">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
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
      <div className={mobile ? 'space-y-3' : 'grid grid-cols-2 xl:grid-cols-4 gap-6 items-start'}>
        <Etape mobile={mobile} numero={1} titre="Choisir une date" ouvert={etape === 1} resume={resumes[0]} onOuvrir={() => onEtape(1)}>
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

      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="button" onClick={onAnnuler} className="px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-800">
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
