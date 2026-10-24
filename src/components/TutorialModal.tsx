import React from 'react';
import { X, Sparkles, LayoutDashboard, Users, Bell, GitFork } from 'lucide-react';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#0E1A20] border border-white/10 rounded-2xl max-w-2xl w-full p-6 shadow-2xl text-white relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl text-gray-400 hover:text-white bg-white/5"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#E5B842] text-black flex items-center justify-center font-bold">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Guide d'utilisation CRM NovaSphere</h2>
            <p className="text-xs text-gray-400">Bienvenue sur votre plateforme immobilière et de courtage en prêt</p>
          </div>
        </div>

        <div className="space-y-4 text-sm text-gray-300 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 flex gap-3">
            <LayoutDashboard className="w-5 h-5 text-[#E5B842] shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-white text-xs mb-0.5">1. Accueil & Tuiles Modulaires</h4>
              <p className="text-xs text-gray-400">
                L'écran Accueil regroupe vos raccourcis interactifs. Vous pouvez ajouter, réordonner et personnaliser l'apparence des tuiles selon vos besoins d'agence.
              </p>
            </div>
          </div>

          <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 flex gap-3">
            <Users className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-white text-xs mb-0.5">2. Gestion Clients & Leads</h4>
              <p className="text-xs text-gray-400">
                Consultez, filtrez et modifiez l'ensemble de vos leads prospects. Cliquez sur "+ Nouveau lead" en haut à droite à tout moment pour saisir un nouveau profil avec son questionnaire patrimoine.
              </p>
            </div>
          </div>

          <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 flex gap-3">
            <GitFork className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-white text-xs mb-0.5">3. Pipeline Kanban des Transactions</h4>
              <p className="text-xs text-gray-400">
                Suivez la progression de chaque dossier de prêt ou mandat de vente, de la prospection jusqu'à l'accord bancaire et la signature finale chez le notaire.
              </p>
            </div>
          </div>

          <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 flex gap-3">
            <Bell className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-white text-xs mb-0.5">4. Rappels, Notes & Outils d'Agence</h4>
              <p className="text-xs text-gray-400">
                Planifiez des alertes bancaires, gérez l'Agenda collectif, réservez le matériel photo/caméra pour vos visites virtuelles et échangez en direct avec vos équipes.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl text-xs font-bold text-black bg-[#E5B842] hover:bg-[#d9ab38]"
          >
            J'ai compris, démarrer
          </button>
        </div>
      </div>
    </div>
  );
};
export default TutorialModal;
