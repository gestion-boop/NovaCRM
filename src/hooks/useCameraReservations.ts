import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { TEAM_MEMBERS } from '@/data/teamMembers';
import { CameraReservation } from '@/types';

// Signalé (7 septembre) : « on ne voit pas trop bien la date qui est
// demandée, et il faudrait un bouton valider/refuser ». En creusant :
// ReserverCameraView.tsx (l'écran ouvert par la notification « demande de
// réservation ») ne lisait QUE le localStorage de l'appareil — une liste
// factice, par device, jamais synchronisée avec la vraie table Supabase
// `camera_reservations` que CameraReservationModal.tsx utilise réellement.
// Un admin cliquant sur la notification de Christophe n'avait donc AUCUNE
// chance de voir sa demande ni de la valider depuis cet écran. Toute la
// logique de lecture/validation est centralisée ici, partagée par les deux
// écrans, pour ne plus jamais diverger.

// Seuls Sylvain Grazia et Mélanie Grazia reçoivent la demande et peuvent
// l'approuver / la refuser.
export const CAMERA_ADMIN_UIDS = [
  '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29', // Sylvain Grazia
  '15bcec53-de3e-40b8-8b7e-bb6874836f29', // Mélanie Grazia
];

export const EQUIPMENT_KEY_TO_LABEL: Record<string, string> = {
  giraffe: 'Caméra Giraffe',
  dji: 'Caméra DJI',
  x4: 'Caméra X4',
  cm: 'Community Manager',
};
export const EQUIPMENT_LABEL_TO_KEY: Record<string, string> = {
  'Caméra Giraffe': 'giraffe',
  'Caméra DJI': 'dji',
  'Caméra X4': 'x4',
  'Community Manager': 'cm',
};

interface CameraReservationSupaRow {
  id: string;
  agency_id: string | null;
  user_id: string;
  title: string | null;
  description: string | null;
  start_at: string;
  end_at: string;
  status: 'pending' | 'accepted' | 'refused';
  reviewed_by: string | null;
  reviewed_at: string | null;
  refusal_reason: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, StoredCameraReservation['status']> = {
  pending: 'En attente',
  accepted: 'Confirmée',
  refused: 'Refusée',
};

function parseDescription(raw: string | null): { equipment?: Record<string, boolean>; lieu?: string; mandat?: string; projet?: string; note?: string } {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function fmtLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtLocalTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Date lisible pour un humain, ex. « lundi 8 septembre, 09:00 – 10:00 » —
// demandé explicitement : « on ne voit pas trop bien la date demandée ».
export function formatReservationDateFr(res: Pick<StoredCameraReservation, 'startDate' | 'startTime' | 'endTime' | 'endDate'>): string {
  const startIso = res.startDate.replace(' ', 'T');
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return res.startDate;
  const dateLabel = start.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' });
  const sameDay = res.endDate ? res.endDate.slice(0, 10) === res.startDate.slice(0, 10) : true;
  const range = `${res.startTime || res.startDate.slice(-5)} – ${res.endTime || res.endDate.slice(-5)}`;
  return sameDay ? `${dateLabel}, ${range}` : `${dateLabel} ${res.startTime} → ${res.endDate.slice(0, 10)} ${res.endTime}`;
}

export interface StoredCameraReservation extends CameraReservation {
  agencyId: string;
  createdByUserId: string;
  createdByEmail: string;
  createdAt: string;
  refusalReason?: string;
}

function rowToStored(row: CameraReservationSupaRow): StoredCameraReservation {
  const desc = parseDescription(row.description);
  const equipmentList = Object.entries(desc.equipment || {})
    .filter(([, v]) => !!v)
    .map(([k]) => EQUIPMENT_KEY_TO_LABEL[k] || k);
  const member = TEAM_MEMBERS.find((m) => m.id === row.user_id);
  const date = fmtLocalDate(row.start_at);

  return {
    id: row.id,
    equipmentName: equipmentList.join(', ') || 'Matériel',
    agentName: member?.name || 'Utilisateur',
    propertyAddress: desc.lieu || '',
    startDate: `${date} ${fmtLocalTime(row.start_at)}`,
    endDate: `${fmtLocalDate(row.end_at)} ${fmtLocalTime(row.end_at)}`,
    status: STATUS_LABEL[row.status] || 'En attente',
    mandateNumber: desc.mandat || '',
    projectName: desc.projet || '',
    note: desc.note || '',
    equipmentList,
    startTime: fmtLocalTime(row.start_at),
    endTime: fmtLocalTime(row.end_at),
    location: desc.lieu || '',
    agencyId: row.agency_id || '',
    createdByUserId: row.user_id,
    createdByEmail: '',
    createdAt: row.created_at,
    refusalReason: row.refusal_reason || undefined,
  };
}

export function useCameraReservations() {
  const { currentUser } = useAuth();
  const [reservations, setReservations] = useState<StoredCameraReservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const isCameraAdmin = !!currentUser && CAMERA_ADMIN_UIDS.includes(currentUser.uid);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: sbError } = await supabase
        .from('camera_reservations' as any)
        .select('*')
        .order('start_at', { ascending: true });
      if (sbError) throw sbError;
      setReservations(((data ?? []) as any[]).map((r) => rowToStored(r as CameraReservationSupaRow)));
    } catch (e) {
      console.error('Erreur chargement réservations caméra :', e);
      setError('Impossible de charger le planning du matériel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    void load();
    // Planté en production (8 septembre) : « cannot add postgres_changes
    // callbacks ... after subscribe() ». Ce hook est appelé par plusieurs
    // composants à la fois (CameraReservationModal, ReserverCameraView, et
    // une instance par carte de réservation dans ReviewRow) — chacun créait
    // un canal Realtime portant EXACTEMENT le même nom fixe
    // (`camera_reservations_shared`), ce que Supabase refuse dès la
    // deuxième tentative. Un identifiant unique par instance de hook
    // (crypto.randomUUID()) règle le problème définitivement.
    const channelName = `camera_reservations_${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'camera_reservations' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.uid, load]);

  const notifyRequester = async (res: StoredCameraReservation, approved: boolean, message?: string, title?: string) => {
    if (!res.createdByUserId) return;
    const finalTitle = title || (approved ? '✅ Réservation caméra acceptée' : '❌ Réservation caméra refusée');
    const finalMessage =
      message ||
      (approved
        ? `Votre réservation "${res.equipmentName}" du ${formatReservationDateFr(res)} a été validée.`
        : `Votre réservation "${res.equipmentName}" du ${formatReservationDateFr(res)} a été refusée.`);
    const statusType = approved ? 'camera_reservation_accepted' : 'camera_reservation_refused';
    const validAgencyId = res.agencyId && /^[0-9a-f-]{36}$/i.test(res.agencyId) ? res.agencyId : null;

    // 1. Appel RPC create_notification (déclenche aussi le push système sur mobile/web)
    try {
      await supabase.rpc('create_notification', {
        _user_id: res.createdByUserId,
        _type: statusType,
        _title: finalTitle,
        _message: finalMessage,
        _entity_type: 'camera_reservation',
        _entity_id: res.id,
        _agency_id: validAgencyId,
        _metadata: { url: '/reserver-camera' },
      } as any);
    } catch (e) {
      console.warn('RPC create_notification demandeur caméra :', e);
    }

    // 2. Insertion directe dans notifications pour garantir l'affichage in-app même si la RPC échoue
    try {
      await supabase.from('notifications').insert({
        user_id: res.createdByUserId,
        type: statusType,
        title: finalTitle,
        body: finalMessage,
        link: '/reserver-camera',
        entity_type: 'camera_reservation',
        entity_id: res.id,
        agency_id: validAgencyId,
        is_read: false,
      } as any);
    } catch (_) {}
  };

  // `alternativeSlots` : jusqu'à 3 propositions de rechange en cas de refus
  // (demande explicite : « qu'on ait trois propositions au cas où, pour
  // pallier aux besoins ») — simple texte libre par créneau (ex.
  // « Mardi 9 sept. 14h-15h »), stocké dans refusal_reason et repris tel
  // quel dans la notification envoyée au demandeur.
  const reviewReservation = async (
    res: StoredCameraReservation,
    approve: boolean,
    options?: { reason?: string; alternativeSlots?: string[] },
  ) => {
    if (!currentUser) return;
    setReviewingId(res.id);
    try {
      const alternatives = (options?.alternativeSlots || []).filter((s) => s.trim());
      const refusalReason = approve
        ? null
        : [options?.reason?.trim(), alternatives.length ? `Autres créneaux proposés : ${alternatives.join(' • ')}` : null]
            .filter(Boolean)
            .join(' — ') || null;

      const { error: sbError } = await supabase
        .from('camera_reservations' as any)
        .update({
          status: approve ? 'accepted' : 'refused',
          reviewed_by: currentUser.uid,
          reviewed_at: new Date().toISOString(),
          refusal_reason: refusalReason,
        } as any)
        .eq('id', res.id);
      if (sbError) throw sbError;

      setReservations((current) =>
        current.map((r) => (r.id === res.id ? { ...r, status: approve ? 'Confirmée' : 'Refusée', refusalReason: refusalReason || undefined } : r))
      );

      // Supprime / masque immédiatement la notification de demande de réservation de la barre
      try {
        await supabase
          .from('notifications')
          .update({
            dismissed_at: new Date().toISOString(),
            is_read: true,
          })
          .eq('entity_type', 'camera_reservation')
          .eq('entity_id', res.id)
          .eq('type', 'camera_reservation_request');
      } catch (errNotif) {
        console.warn('Impossible de masquer la notification de demande :', errNotif);
      }

      try {
        await supabase.rpc('dismiss_camera_reservation_notifications' as any, {
          _reservation_id: res.id,
        });
      } catch (_) {}

      const message = approve
        ? `Votre réservation "${res.equipmentName}" du ${formatReservationDateFr(res)} a été validée.`
        : `Votre réservation "${res.equipmentName}" du ${formatReservationDateFr(res)} a été refusée.${
            refusalReason ? ` ${refusalReason}` : ''
          }`;
      await notifyRequester(res, approve, message);
    } catch (e) {
      console.error('Erreur validation réservation caméra :', e);
      setError("Impossible de mettre à jour cette réservation.");
    } finally {
      setReviewingId(null);
    }
  };

  // Signalé (7 septembre) : la notification des admins à la création d'une
  // demande était auparavant envoyée ICI, en plus de DEUX déclencheurs base
  // identiques — jusqu'à 3 notifications par demande. Les doublons base ont
  // été supprimés et le déclencheur restant corrigé (lien `/reserver-camera`
  // au lieu d'un `/agenda?...` jamais résolu) ; il couvre déjà fiablement
  // tous les super admins + Mélanie (voir camera_reservation_approvers()
  // côté SQL), donc plus besoin de dupliquer l'envoi ici.

  // Demande explicite (11 octobre) : « je veux que les admins puissent
  // modifier, supprimer ou refuser les réservations en cours et déjà
  // créées » — modifier existait déjà (canEdit, sans égard au statut pour
  // un admin) et la policy RLS `cam_delete`/« delete owner or approver »
  // autorise déjà un approbateur (camera_reservation_approvers(), déjà
  // utilisée par reviewReservation) à supprimer n'importe quelle
  // réservation : il manquait seulement cette fonction côté client.
  const deleteReservation = async (res: StoredCameraReservation) => {
    if (!currentUser) return;
    setReviewingId(res.id);
    try {
      const { error: sbError } = await supabase
        .from('camera_reservations' as any)
        .delete()
        .eq('id', res.id);
      if (sbError) throw sbError;

      setReservations((current) => current.filter((r) => r.id !== res.id));

      // Supprime également les notifications associées à cette réservation de la barre
      try {
        await supabase
          .from('notifications')
          .update({
            dismissed_at: new Date().toISOString(),
            is_read: true,
          })
          .eq('entity_type', 'camera_reservation')
          .eq('entity_id', res.id);
      } catch (_) {}

      try {
        await supabase.rpc('dismiss_camera_reservation_notifications' as any, {
          _reservation_id: res.id,
        });
      } catch (_) {}

      await notifyRequester(
        res,
        false,
        `Votre réservation "${res.equipmentName}" du ${formatReservationDateFr(res)} a été supprimée par un administrateur.`,
        '🗑️ Réservation supprimée'
      );
    } catch (e) {
      console.error('Erreur suppression réservation caméra :', e);
      setError('Impossible de supprimer cette réservation.');
      throw e;
    } finally {
      setReviewingId(null);
    }
  };

  const pendingReservations = reservations.filter((r) => r.status === 'En attente');

  return {
    reservations,
    pendingReservations,
    loading,
    error,
    setError,
    isCameraAdmin,
    reviewingId,
    reviewReservation,
    deleteReservation,
    reload: load,
  };
}
