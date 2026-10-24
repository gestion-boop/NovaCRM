import React, { useState, useEffect } from 'react';
import { Camera, Plus, Clock, MapPin, Hash, Briefcase, FileText } from 'lucide-react';
import { CameraReservation } from '@/types';
import CameraReservationModal from './CameraReservationModal';

const SEED_RESERVATIONS: CameraReservation[] = [
  {
    id: 'cr-1',
    equipmentName: 'Caméra DJI',
    agentName: 'Mélanie Grazia',
    propertyAddress: '14 Boulevard Haussmann, Paris',
    startDate: '2026-08-08 14:00',
    endDate: '2026-08-08 16:00',
    status: 'Confirmée',
    mandateNumber: '2026-089',
    projectName: 'Villa Lumineuse Montmartre'
  },
  {
    id: 'cr-2',
    equipmentName: 'Caméra Giraffe, Pack Éclairage',
    agentName: 'Sylvain Grazia',
    propertyAddress: '8 Rue de la Paix, Paris',
    startDate: '2026-08-10 09:30',
    endDate: '2026-08-10 11:30',
    status: 'Confirmée',
    mandateNumber: '2026-092',
    projectName: 'Penthouse Haussmann'
  }
];

export interface ReserverCameraViewProps {
  onOpenModal?: () => void;
}

export const ReserverCameraView: React.FC<ReserverCameraViewProps> = ({ onOpenModal }) => {
  const [reservations, setReservations] = useState<CameraReservation[]>(() => {
    try {
      const saved = localStorage.getItem('novasphere_camera_reservations_v1');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Erreur lecture réservations caméra:', e);
    }
    return SEED_RESERVATIONS;
  });

  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('novasphere_camera_reservations_v1', JSON.stringify(reservations));
    } catch (e) {
      console.warn('Erreur sauvegarde réservations:', e);
    }
  }, [reservations]);

  const handleAddReservation = (newRes: CameraReservation) => {
    setReservations([newRes, ...reservations]);
  };

  const handleTriggerOpen = () => {
    if (onOpenModal) {
      onOpenModal();
    } else {
      setShowModal(true);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white animate-fade-in">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/5 p-6 rounded-3xl border border-white/10">
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

      {/* Reservations List */}
      <div className="space-y-3">
        <h2 className="text-sm font-extrabold text-slate-300 uppercase tracking-wider px-1">
          Réservations enregistrées ({reservations.length})
        </h2>

        {reservations.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-white/5 rounded-3xl border border-white/10 space-y-3">
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
          reservations.map((r) => (
            <div
              key={r.id}
              className="p-5 bg-[#09151c] border border-[#182e38] hover:border-purple-500/40 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all shadow-md group"
            >
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

                  <h3 className="font-bold text-white text-base">{r.propertyAddress}</h3>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-0.5">
                    <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                      <Clock className="w-3.5 h-3.5 text-purple-400" />
                      {r.startDate} {r.endDate ? `-> ${r.endDate}` : ''}
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
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                  r.status === 'Confirmée'
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                }`}>
                  {r.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Internal Modal fallback if opened directly in this component */}
      <CameraReservationModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onAddReservation={handleAddReservation}
      />
    </div>
  );
};

export default ReserverCameraView;
