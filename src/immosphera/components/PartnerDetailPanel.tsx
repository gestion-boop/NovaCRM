import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Phone, Mail, MapPin, Building2, Globe, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type PartnerDoc = { url: string; name: string; type: "image" | "pdf" | "other" };

const CATEGORY_MAP: Record<string, string> = {
  architecte: "Architecte",
  automatisme: "Automatisme (portail, volet…)",
  carreleur: "Carreleur",
  chauffagiste: "Chauffagiste",
  climaticien: "Climatisation",
  courtier: "Courtier",
  courtier_travaux: "Courtier en travaux",
  couvreur: "Couvreur",
  demenageur: "Déménageur",
  diagnostiqueur: "Diagnostiqueur",
  electricien: "Électricien",
  expert_fissure: "Expert fissure bâtiment",
  geometre: "Géomètre",
  jardinier: "Jardinier / Paysagiste",
  macon: "Maçon",
  menuisier: "Menuisier",
  multiservices: "Multiservices",
  notaire: "Notaire",
  peintre: "Peintre",
  platrier: "Plâtrier",
  plombier: "Plombier",
  serrurier: "Serrurier",
  terrassier: "Terrassier",
  autre: "Autre",
};

type Partner = Tables<"immosphera_partners">;

interface Props {
  partner: Partner;
  onClose: () => void;
}

export function PartnerDetailPanel({ partner: p, onClose }: Props) {
  const website = (p as any).website as string | null;
  const documents: PartnerDoc[] = Array.isArray((p as any).documents) ? (p as any).documents : [];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Fermeture par touche Échap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightboxIndex !== null) {
          setLightboxIndex(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, onClose]);

  const firstName = p.first_name || "";
  const lastName = p.last_name || "";
  const fullName = [firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(), lastName.toUpperCase()].filter(Boolean).join(" ") || "Partenaire";
  const initials = `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase() || "P";

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#0E1A20] text-white rounded-3xl border border-white/20 shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header de la fiche */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-[#0B151A]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#F7BC5F]/25 to-amber-600/30 border border-[#F7BC5F]/40 flex items-center justify-center text-[#FAD592] font-black text-sm shrink-0 shadow-[0_0_12px_rgba(247,188,95,0.25)]">
              {initials || <Building2 className="w-5 h-5 text-[#F7BC5F]" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-base text-white tracking-wide truncate">
                {fullName}
              </h3>
              {p.company && (
                <p className="text-xs text-[#FAD592] flex items-center gap-1.5 mt-0.5 truncate font-medium">
                  <Building2 className="h-3.5 w-3.5 text-[#F7BC5F] shrink-0" /> {p.company}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            title="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corps scrollable */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm">
          {/* Badge de catégorie */}
          <div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-[#F7BC5F]/15 text-[#FAD592] border border-[#F7BC5F]/35 shadow-sm">
              {CATEGORY_MAP[p.category] || p.category}
            </span>
          </div>

          {/* Coordonnées de contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {p.phone && (
              <a
                href={`tel:${p.phone}`}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-200 hover:text-[#F7BC5F] transition-all group"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Phone className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Téléphone</p>
                  <p className="text-xs font-semibold truncate group-hover:underline">{p.phone}</p>
                </div>
              </a>
            )}

            {p.email && (
              <a
                href={`mailto:${p.email}`}
                className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-200 hover:text-[#F7BC5F] transition-all group"
              >
                <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Mail className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Email</p>
                  <p className="text-xs font-semibold truncate group-hover:underline">{p.email}</p>
                </div>
              </a>
            )}

            {p.intervention_area && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.04] border border-white/10 text-slate-200">
                <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <MapPin className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Secteur</p>
                  <p className="text-xs font-semibold truncate">{p.intervention_area}</p>
                </div>
              </div>
            )}

            {website && (
              <a
                href={website.startsWith("http") ? website : `https://${website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-slate-200 hover:text-[#F7BC5F] transition-all group"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                  <Globe className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Site web</p>
                  <p className="text-xs font-semibold truncate group-hover:underline">{website}</p>
                </div>
              </a>
            )}
          </div>

          {/* Notes */}
          {p.notes && (
            <div className="p-3.5 rounded-2xl bg-[#061216] border border-white/10">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Notes & Remarques</p>
              <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">{p.notes}</p>
            </div>
          )}

          {/* Documents / Pièces jointes */}
          {documents.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Documents & Pièces jointes ({documents.length})</p>
              <div className="grid grid-cols-4 gap-2.5">
                {documents.map((doc, i) => (
                  <button
                    key={doc.url}
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="aspect-square rounded-xl overflow-hidden border border-white/15 bg-white/5 hover:border-[#F7BC5F] transition-all cursor-pointer group relative flex flex-col items-center justify-center p-1"
                    title={doc.name}
                  >
                    {doc.type === "image" ? (
                      <img src={doc.url} alt={doc.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-300 p-1">
                        <FileText className="h-5 w-5 text-[#F7BC5F]" />
                        <span className="text-[9px] text-center line-clamp-2 text-slate-400">{doc.name}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-end bg-[#0B151A] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>

      {/* Visionneuse en grand ("in frame") */}
      {lightboxIndex !== null && documents[lightboxIndex] && (
        <div
          className="fixed inset-0 z-[100000] bg-black/95 flex items-center justify-center p-4 sm:p-10 animate-in fade-in duration-150"
          onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
            className="absolute top-4 right-4 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            title="Fermer la visionneuse"
          >
            <X className="h-6 w-6" />
          </button>

          {documents.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((i) => (i === null ? null : (i - 1 + documents.length) % documents.length));
              }}
              className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              title="Précédent"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          <div className="max-w-4xl w-full max-h-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {documents[lightboxIndex].type === "image" ? (
              <img
                src={documents[lightboxIndex].url}
                alt={documents[lightboxIndex].name}
                className="max-w-full max-h-[82vh] object-contain rounded-xl shadow-2xl border border-white/10"
              />
            ) : (
              <iframe
                src={documents[lightboxIndex].url}
                title={documents[lightboxIndex].name}
                className="w-full h-[82vh] rounded-xl bg-white border border-white/10 shadow-2xl"
              />
            )}
            <p className="text-white/80 text-xs font-medium">
              {documents[lightboxIndex].name}
              {documents.length > 1 && ` — ${lightboxIndex + 1}/${documents.length}`}
            </p>
          </div>

          {documents.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((i) => (i === null ? null : (i + 1) % documents.length));
              }}
              className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              title="Suivant"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
