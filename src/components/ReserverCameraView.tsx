import React, { useState } from 'react';
import { Camera, Plus, Clock, MapPin, Hash, Briefcase, CheckCircle2, XCircle, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import CameraReservationModal from './CameraReservationModal';
import { useAuth } from '@/context/AuthContext';
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
            className="w-full bg-[#050f14] border border-[#182e38] rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500/40 resize-none"
          />
          <p className="text-[10px] text-slate-400">Proposer d'autres créneaux (facultatif) :</p>
          {altSlots.map((slot, i) => (
            <input
              key={i}
              type="text"
              placeholder={`Proposition ${i + 1} (ex. mardi 9 sept. 14h-15h)`}
              value={slot}
              onChange={(e) => setAltSlots((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))}
              className="w-full bg-[#050f14] border border-[#182e38] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500/40"
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
  const sorted = [...reservations].sort((a, b) => {
    if (a.status === 'En attente' && b.status !== 'En attente') return -1;
    if (b.status === 'En attente' && a.status !== 'En attente') return 1;
    return b.startDate.localeCompare(a.startDate);
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0a1e20]/95 p-6 rounded-3xl border border-white/10">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-purple-950/60 border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0 shadow-lg shadow-purple-950/40">
            <Camera className="w-6 h-6 text-purple-300" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white">Réservation de matériel & Caméra 360</h1>
            <p className="text-xs text-slate-400">Planning et suivi des réservations pour visites virtuelles et shooting</p>
          </div>
        </div>

        <button
          onClick={handleTriggerOpen}
          className="bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:opacity-95 text-white font-black text-xs px-5 py-3 rounded-2xl flex items-center gap-2 shadow-lg shadow-purple-900/30 transition-all cursor-pointer active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Nouvelle réservation</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">{error}</div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-extrabold text-slate-300 uppercase tracking-wider px-1">
          Réservations enregistrées ({sorted.length})
        </h2>

        {loading ? (
          <div className="p-12 text-center text-slate-400 bg-[#0a1e20]/95 rounded-3xl border border-white/10">
            <p className="text-sm font-semibold">Chargement...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-[#0a1e20]/95 rounded-3xl border border-white/10 space-y-3">
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
          sorted.map((r) => (
            <div
              key={r.id}
              className={`p-5 bg-[#09151c] border rounded-2xl transition-all shadow-md group ${
                r.status === 'En attente' ? 'border-[#F7BC5F]/40' : 'border-[#182e38] hover:border-purple-500/40'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="p-3 rounded-xl bg-purple-950/40 text-purple-300 border border-purple-500/30 shrink-0 mt-0.5">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-950/60 border border-purple-500/30 px-2.5 py-0.5 rounded-full">
                        {r.equipmentName}
                      </span>
                      {r.mandateNumber && (
                        <span className="text-[10px] font-bold text-slate-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <Hash className="w-2.5 h-2.5" /> Mandat: {r.mandateNumber}
                        </span>
                      )}
                    </div>

                    {r.propertyAddress && (
                      <h3 className="font-bold text-white text-base flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        {r.propertyAddress}
                      </h3>
                    )}

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-0.5">
                      {/* Demande explicite (7 septembre) : « on ne voit pas
                          trop bien la date qui est demandée » — date en
                          toutes lettres au lieu du format brut AAAA-MM-JJ. */}
                      <span className="flex items-center gap-1.5 text-slate-200 font-semibold">
                        <Clock className="w-3.5 h-3.5 text-purple-400" />
                        {formatReservationDateFr(r)}
                      </span>
                      <span>Agent : <strong className="text-white">{r.agentName}</strong></span>
                      {r.projectName && (
                        <span className="flex items-center gap-1 text-slate-400">
                          <Briefcase className="w-3.5 h-3.5 text-slate-500" />
                          Projet : {r.projectName}
                        </span>
                      )}
                    </div>

                    {r.note && (
                      <p className="text-xs text-slate-400 italic bg-white/5 p-2 rounded-lg border border-white/5 mt-2">
                        "{r.note}"
                      </p>
                    )}
                    {r.status === 'Refusée' && r.refusalReason && (
                      <p className="text-xs text-rose-300 bg-rose-500/5 p-2 rounded-lg border border-rose-500/20 mt-2">
                        {r.refusalReason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                    r.status === 'Confirmée'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : r.status === 'Refusée'
                      ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                      : 'bg-[#F7BC5F]/15 text-[#F9C977] border-[#F7BC5F]/30'
                  }`}>
                    {r.status}
                  </span>
                  {canEdit(r) && (
                    <button
                      type="button"
                      onClick={() => handleEdit(r)}
                      title="Modifier cette réservation"
                      className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-purple-500/40 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isCameraAdmin && (
                    <button
                      type="button"
                      disabled={reviewingId === r.id}
                      onClick={() => void handleDelete(r)}
                      title="Supprimer définitivement cette réservation"
                      className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <ReviewRow res={r} isCameraAdmin={isCameraAdmin} reviewingId={reviewingId} reviewReservation={reviewReservation} />
            </div>
          ))
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
