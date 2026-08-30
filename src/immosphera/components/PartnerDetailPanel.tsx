import { useState } from "react";
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
  // Visionneuse en grand ("in frame"), avec navigation gauche/droite façon
  // carrousel s'il y a plusieurs fichiers — demande explicite.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <p className="font-bold text-base">
              {p.first_name.charAt(0).toUpperCase() + p.first_name.slice(1).toLowerCase()}{" "}
              {p.last_name.toUpperCase()}
            </p>
            {p.company && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Building2 className="h-3.5 w-3.5" /> {p.company}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Category badge */}
        <div className="px-5 pb-3">
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
            {CATEGORY_MAP[p.category] || p.category}
          </span>
        </div>

        {/* Contact info */}
        <div className="px-5 space-y-3 text-sm">
          {p.phone && (
            <a href={`tel:${p.phone}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Phone className="h-4 w-4 shrink-0" /> {p.phone}
            </a>
          )}
          {p.email && (
            <a href={`mailto:${p.email}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <Mail className="h-4 w-4 shrink-0" /> {p.email}
            </a>
          )}
          {p.intervention_area && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" /> {p.intervention_area}
            </p>
          )}
          {website && (
            <a
              href={website.startsWith("http") ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Globe className="h-4 w-4 shrink-0" /> {website}
            </a>
          )}
        </div>

        {/* Notes - full text */}
        {p.notes && (
          <div className="px-5 pt-4 pb-5">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Notes</p>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">{p.notes}</p>
          </div>
        )}

        {/* Carte de visite / photos / documents — miniatures cliquables,
            ouvrent la visionneuse en grand ci-dessous. */}
        {documents.length > 0 && (
          <div className="px-5 pt-1 pb-5">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Documents</p>
            <div className="grid grid-cols-4 gap-2">
              {documents.map((doc, i) => (
                <button
                  key={doc.url}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="aspect-square rounded-lg overflow-hidden border border-border bg-muted hover:border-primary/50 transition-colors"
                  title={doc.name}
                >
                  {doc.type === "image" ? (
                    <img src={doc.url} alt={doc.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground p-1">
                      <FileText className="h-5 w-5" />
                      <span className="text-[9px] text-center line-clamp-2">{doc.name}</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!p.notes && documents.length === 0 && <div className="h-5" />}
      </div>

      {/* Visionneuse en grand ("in frame") — flèches gauche/droite pour
          passer au document suivant/précédent s'il y en a plusieurs. */}
      {lightboxIndex !== null && documents[lightboxIndex] && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 sm:p-10"
          onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          {documents.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((i) => (i === null ? null : (i - 1 + documents.length) % documents.length));
              }}
              className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 p-2 sm:p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
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
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            ) : (
              <iframe
                src={documents[lightboxIndex].url}
                title={documents[lightboxIndex].name}
                className="w-full h-[80vh] rounded-lg bg-white"
              />
            )}
            <p className="text-white/70 text-xs">
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
              className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 p-2 sm:p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Suivant"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
