import React, { useEffect, useState } from 'react';
import { Camera, Plus, Clock, MapPin, Hash, Briefcase, CheckCircle2, XCircle, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import CameraReservationModal from './CameraReservationModal';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { useCameraReservations, StoredCameraReservation, formatReservationDateFr } from '@/hooks/useCameraReservations';

// Correctif (7 septembre, signalé « on ne voit pas trop bien la date qui
// est demandée, et il faudrait un bouton valider/refuser ») : cet écran
// (celui qu'ouvre la notification « demande de réservation ») ne lisait
// QUE le localStorage de l'appareil — une liste factice, jamais
// synchronisée avec la vraie table Supabase `camera_reservations`. Un
// admin cliquant sur la notification de Christophe n'avait donc aucune
// chance de voir sa demande ni de la valider depuis ici. Passe désormais
// par le même hook partagé que la fenêtre de réservation (données réelles,
// temps réel), avec Valider/Refuser directement sur la carte pour les
// admins caméra (Sylvain, Mélanie), sans avoir à rouvrir une autre fenêtre.

export interface ReserverCameraViewProps {
  onOpenModal?: () => void;
}

export function texteLisible(valeur: string): string {
  const lettres = valeur.replace(/[^\p{L}]/gu, '');
  if (lettres.length < 4) return valeur;
  let majuscules = 0;
  for (const lettre of lettres) {
    if (lettre !== lettre.toLocaleLowerCase('fr-FR')) majuscules += 1;
  }
  if (majuscules / lettres.length < 0.6) return valeur;
  return valeur
    .toLocaleLowerCase('fr-FR')
    .split(/(\s+)/)
    .map((mot) => (mot.trim().length <= 2 ? mot : mot.charAt(0).toLocaleUpperCase('fr-FR') + mot.slice(1)))
    .join('');
}

export function mandatLisible(valeur?: string | null): string {
  const texte = (valeur || '').trim();
  if (!/[\p{L}\p{N}]/u.test(texte)) return '';
  return texte;
}

function initialesDe(nom: string): string {
  const lettres = nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => mot[0]?.toUpperCase())
    .join('');
  return lettres || '?';
}

// Photo du demandeur, à la place de l'icône appareil photo. Le portrait
// enregistré sur le compte prime ; sinon la photo d'équipe ; sinon les initiales.
const LogoAgent: React.FC<{ nom: string; src: string; secours?: string }> = ({ nom, src, secours = '' }) => {
  const [essai, setEssai] = useState(0);
  useEffect(() => {
    setEssai(0);
  }, [src, secours]);
  const choisi = essai === 0 ? src || secours : essai === 1 && secours && secours !== src ? secours : '';
  return (
    <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-[var(--nv-border-1)] bg-purple-950/50 flex items-center justify-center">
      {choisi ? (
        <img
          key={choisi}
          src={choisi}
          alt={nom}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setEssai((n) => n + 1)}
        />
      ) : (
        <span className="text-xs font-black text-purple-100">{initialesDe(nom)}</span>
      )}
    </div>
  );
};

// Reçoit isCameraAdmin/reviewingId/reviewReservation en props plutôt que de
// rappeler useCameraReservations() ici : une carte par réservation aurait
// sinon fait autant d'instances du hook (autant de chargements et
// d'abonnements Realtime redondants) que de lignes affichées.
const ReviewRow: React.FC<{
  res: StoredCameraReservation;
  isCameraAdmin: boolean;
  reviewingId: string | null;
  reviewReservation: ReturnType<typeof useCameraReservations>['reviewReservation'];
}> = ({ res, isCameraAdmin, reviewingId, reviewReservation }) => {
  const [showRefusePanel, setShowRefusePanel] = useState(false);
  const [refuseReason, setRefuseReason] = useState('');
  const [altSlots, setAltSlots] = useState<string[]>(['', '', '']);
  const isPending = res.status === 'En attente';
  // Demande explicite (11 octobre) : un admin doit pouvoir refuser une
  // réservation déjà CONFIRMÉE (pas seulement une demande en attente) —
  // « Valider » n'a en revanche de sens que tant que rien n'est encore
  // confirmé. Une réservation déjà refusée n'a plus besoin de ce bloc.
  const isConfirmed = res.status === 'Confirmée';
  const busy = reviewingId === res.id;

  if (!isCameraAdmin || (!isPending && !isConfirmed)) return null;

  return (
    <div className="mt-3 pt-3 border-t border-white/10 space-y-2.5">
      {showRefusePanel && (
        <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2">
          <textarea
            rows={2}
            placeholder="Motif du refus (optionnel)..."
            value={refuseReason}
            onChange={(e) => setRefuseReason(e.target.value)}
            className="w-full bg-[var(--nv-field)] border border-[var(--nv-field-border)] rounded-lg p-2.5 text-xs text-[var(--ink-1)] placeholder:text-[var(--ink-3)] focus:outline-none focus:border-rose-500/40 resize-none"
          />
          <p className="text-[10px] text-slate-400">Proposer d'autres créneaux (facultatif) :</p>
          {altSlots.map((slot, i) => (
            <input
              key={i}
              type="text"
              placeholder={`Proposition ${i + 1} (ex. mardi 9 sept. 14h-15h)`}
              value={slot}
              onChange={(e) => setAltSlots((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))}
              className="w-full bg-[var(--nv-field)] border border-[var(--nv-field-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ink-1)] placeholder:text-[var(--ink-3)] focus:outline-none focus:border-rose-500/40"
            />
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {showRefusePanel ? (
          <>
            <button
              type="button"
              onClick={() => setShowRefusePanel(false)}
              className="px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void reviewReservation(res, false, { reason: refuseReason, alternativeSlots: altSlots })}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40 flex items-center gap-2"
            >
              <XCircle className="w-3.5 h-3.5" /> Confirmer le refus
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowRefusePanel(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40 flex items-center gap-2"
            >
              <XCircle className="w-3.5 h-3.5" /> Refuser
            </button>
            {isPending && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void reviewReservation(res, true)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 flex items-center gap-2"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Valider
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export const ReserverCameraView: React.FC<ReserverCameraViewProps> = ({ onOpenModal }) => {
  const { currentUser } = useAuth();
  const { reservations, loading, error, isCameraAdmin, reviewingId, reviewReservation, deleteReservation } = useCameraReservations();
  const [showModal, setShowModal] = useState(false);
  // Demande explicite : pouvoir cliquer sur une réservation enregistrée
  // pour la modifier si besoin, sans repasser par une nouvelle demande.
  const [editingReservation, setEditingReservation] = useState<StoredCameraReservation | null>(null);

  const handleTriggerOpen = () => {
    setEditingReservation(null);
    if (onOpenModal) {
      onOpenModal();
    } else {
      setShowModal(true);
    }
  };

  // Écoute de l'action rapide mobile déclenchée depuis MobileHeader
  useEffect(() => {
    const handleCameraSignal = () => {
      handleTriggerOpen();
    };
    window.addEventListener('nova-open-camera-reservation', handleCameraSignal);
    return () => window.removeEventListener('nova-open-camera-reservation', handleCameraSignal);
  }, [onOpenModal]);

  const handleEdit = (r: StoredCameraReservation) => {
    setEditingReservation(r);
    setShowModal(true);
  };

  // Demande explicite (11 octobre) : « je veux que les admins puissent
  // modifier, supprimer ou refuser les réservations en cours et déjà
  // créées » — suppression définitive, quel que soit le statut.
  const handleDelete = async (r: StoredCameraReservation) => {
    if (!window.confirm(`Supprimer définitivement cette réservation (${r.equipmentName}, ${formatReservationDateFr(r)}) ? Impossible à annuler.`)) {
      return;
    }
    try {
      await deleteReservation(r);
      toast.success('Réservation supprimée.');
    } catch {
      toast.error("Impossible de supprimer cette réservation.");
    }
  };

  // Modifiable par son auteur tant qu'elle est en attente (même règle que la
  // policy Supabase `cam_update`), ou par un admin caméra à tout moment.
  const canEdit = (r: StoredCameraReservation) =>
    isCameraAdmin || (r.createdByUserId === currentUser?.uid && r.status === 'En attente');

  // En attente d'abord (ce qui a besoin d'une action), puis le reste par
  // date décroissante — pour ne pas noyer une demande urgente au milieu
  // de réservations déjà traitées.
  const [photosProfil, setPhotosProfil] = useState<Record<string, string>>({});
  const idsAgents = [...new Set(reservations.map((r) => r.createdByUserId).filter(Boolean))].sort().join(',');
  useEffect(() => {
    const ids = idsAgents ? idsAgents.split(',') : [];
    if (ids.length === 0) return;
    let ignore = false;
    void supabase
      .from('profiles')
      .select('id, avatar_url')
      .in('id', ids)
      .then(({ data }) => {
        if (ignore || !data) return;
        const suivant: Record<string, string> = {};
        for (const ligne of data as { id: string; avatar_url: string | null }[]) {
          if (ligne.avatar_url) suivant[ligne.id] = ligne.avatar_url;
        }
        setPhotosProfil(suivant);
      });
    return () => {
      ignore = true;
    };
  }, [idsAgents]);

  const logoAgent = (r: StoredCameraReservation) => {
    const membre = TEAM_MEMBERS.find((m) => m.id === r.createdByUserId);
    const profil = photosProfil[r.createdByUserId] || '';
    const equipe = membre?.avatarUrl || '';
    return { src: profil || equipe, secours: profil && equipe && profil !== equipe ? equipe : '' };
  };

  const sorted = [...reservations].sort((a, b) => {
    if (a.status === 'En attente' && b.status !== 'En attente') return -1;
    if (b.status === 'En attente' && a.status !== 'En attente') return 1;
    return b.startDate.localeCompare(a.startDate);
  });

  return (
    <div className="px-2.5 sm:px-6 pt-1 sm:pt-2 pb-6 max-w-3xl mx-auto space-y-3.5 sm:space-y-5 text-[var(--ink-1)]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 bg-[var(--nv-surface-1)] p-3.5 sm:p-5 rounded-3xl border border-[var(--nv-hairline)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-purple-950/60 border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0">
            <Camera className="w-5 h-5 text-purple-300" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold leading-tight text-[var(--ink-1)]">Matériel et caméra</h1>
            <p className="text-sm text-[var(--ink-2)] mt-0.5">Planning des visites et des shootings</p>
          </div>
        </div>

        <button
          onClick={handleTriggerOpen}
          className="w-full sm:w-auto justify-center bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:opacity-95 text-white font-semibold text-sm px-5 py-3 rounded-2xl flex items-center gap-2 shadow-lg shadow-purple-900/30 transition-all cursor-pointer active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Nouvelle réservation</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">{error}</div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--ink-2)] px-1">
          {sorted.length} réservation{sorted.length > 1 ? 's' : ''}
        </h2>

        {loading ? (
          <div className="p-12 text-center text-[var(--ink-2)] bg-[var(--nv-surface-1)] rounded-3xl border border-[var(--nv-hairline)]">
            <p className="text-sm font-semibold">Chargement...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center text-[var(--ink-2)] bg-[var(--nv-surface-1)] rounded-3xl border border-[var(--nv-hairline)] space-y-3">
            <Camera className="w-10 h-10 text-slate-500 mx-auto" />
            <p className="text-sm font-semibold">Aucune réservation de caméra enregistrée.</p>
            <button
              onClick={handleTriggerOpen}
              className="text-xs text-purple-400 hover:text-purple-300 font-bold underline"
            >
              Faire une réservation maintenant
            </button>
          </div>
        ) : (
          sorted.map((r) => {
            const lieu = r.propertyAddress ? texteLisible(r.propertyAddress) : '';
            const projet = r.projectName ? texteLisible(r.projectName) : '';
            const mandat = mandatLisible(r.mandateNumber);
            const materiels = r.equipmentName.split(',').map((item) => item.trim()).filter(Boolean);
            const photo = logoAgent(r);
            return (
            <article
              key={r.id}
              className={`p-4 bg-[var(--nv-surface-1)] border rounded-2xl ${
                r.status === 'En attente' ? 'border-[#F7BC5F]/40' : 'border-[var(--nv-hairline)]'
              }`}
            >
              <div className="flex items-start gap-3">
                <LogoAgent nom={r.agentName} src={photo.src} secours={photo.secours} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--ink-1)] truncate">{r.agentName}</p>
                    <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                      r.status === 'Confirmée'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : r.status === 'Refusée'
                        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                        : 'bg-[#F7BC5F]/15 text-[#F9C977] border-[#F7BC5F]/30'
                    }`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--ink-2)] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0 text-purple-300" />
                    <span>{formatReservationDateFr(r)}</span>
                  </p>
                </div>
              </div>

              {lieu && (
                <h3 className="mt-3 text-[15px] font-semibold leading-snug text-[var(--ink-1)] flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--ink-3)]" />
                  <span>{lieu}</span>
                </h3>
              )}

              {materiels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {materiels.map((materiel) => (
                    <span key={materiel} className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-[var(--ink-violet)] border border-violet-400/25">
                      {materiel}
                    </span>
                  ))}
                </div>
              )}

              {(projet || mandat) && (
                <p className="mt-2 text-xs text-[var(--ink-2)] flex flex-wrap items-center gap-x-3 gap-y-1">
                  {projet && (
                    <span className="inline-flex items-center gap-1">
                      <Briefcase className="w-3.5 h-3.5 shrink-0" />
                      {projet}
                    </span>
                  )}
                  {mandat && (
                    <span className="inline-flex items-center gap-1">
                      <Hash className="w-3.5 h-3.5 shrink-0" />
                      Mandat {mandat}
                    </span>
                  )}
                </p>
              )}

              {r.note && (
                <p className="mt-2 text-xs leading-relaxed text-[var(--ink-2)] line-clamp-3">{r.note}</p>
              )}
              {r.status === 'Refusée' && r.refusalReason && (
                <p className="mt-2 text-xs text-rose-300 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                  {r.refusalReason}
                </p>
              )}

              {(canEdit(r) || isCameraAdmin) && (
                <div className="mt-3 flex items-center justify-end gap-2">
                  {canEdit(r) && (
                    <button
                      type="button"
                      onClick={() => handleEdit(r)}
                      aria-label="Modifier cette réservation"
                      className="h-9 px-3 rounded-xl border border-[var(--nv-border-1)] text-[var(--ink-2)] hover:text-[var(--ink-1)] inline-flex items-center gap-1.5 text-xs font-semibold"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Modifier
                    </button>
                  )}
                  {isCameraAdmin && (
                    <button
                      type="button"
                      disabled={reviewingId === r.id}
                      onClick={() => void handleDelete(r)}
                      aria-label="Supprimer définitivement cette réservation"
                      className="h-9 w-9 rounded-xl border border-[var(--nv-border-1)] text-[var(--ink-2)] hover:text-rose-300 inline-flex items-center justify-center disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              <ReviewRow res={r} isCameraAdmin={isCameraAdmin} reviewingId={reviewingId} reviewReservation={reviewReservation} />
            </article>
            );
          })
        )}
      </div>

      <CameraReservationModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingReservation(null);
        }}
        editReservation={editingReservation}
      />
    </div>
  );
};

export default ReserverCameraView;
