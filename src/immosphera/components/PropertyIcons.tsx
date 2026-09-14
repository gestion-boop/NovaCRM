/** Branded icons for property links – used in PropertyCard & PropertyDetail */
import { forwardRef } from "react";
import { Video, RotateCw } from "lucide-react";

export const VirtualTourIcon = forwardRef<HTMLDivElement, { className?: string }>(
  ({ className = "h-5 w-5" }, ref) => (
    <div ref={ref} className={`${className} flex items-center justify-center text-[#F9C977]`}>
      <Video className="w-full h-full" />
    </div>
  )
);
VirtualTourIcon.displayName = "VirtualTourIcon";

export const Giraffe360Icon = forwardRef<HTMLDivElement, { className?: string; withBg?: boolean }>(
  ({ className = "h-5 w-5" }, ref) => (
    <div ref={ref} className={`${className} rounded-full flex items-center justify-center bg-[#F7BC5F]/15 text-[#F9C977]`}>
      <RotateCw className="w-3/4 h-3/4" />
    </div>
  )
);
Giraffe360Icon.displayName = "Giraffe360Icon";

export function WebsiteIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <img
      src="/Logo Immosphera.png"
      alt="Immosphera"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}

// Demande explicite (15 septembre) : « je veux que tu intègres celui-ci
// pour le casque [...] car celui que tu as mis n'est pas joli » — l'icône
// lucide "Headset" (filaire, générique) remplacée par un dessin sur mesure
// fidèle à la forme du casque VR envoyé en référence (coque blanche
// arrondie en pilule, bandeau, 3 capteurs en façade) — sans logo de
// marque, jamais reçu en fichier exploitable côté serveur (image collée
// dans la conversation, aucun accès aux pixels bruts).
export function VrHeadsetIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Bandeau */}
      <path
        d="M15 4C15 2 16.5 1 18 1H30C31.5 1 33 2 33 4V8C33 8 30 6.5 24 6.5C18 6.5 15 8 15 8V4Z"
        fill="currentColor"
        opacity="0.55"
      />
      {/* Coque principale (pilule) */}
      <rect x="2" y="9" width="44" height="20" rx="10" fill="currentColor" />
      {/* Capteurs en façade */}
      <rect x="17" y="16" width="3" height="6" rx="1.5" fill="black" opacity="0.35" />
      <rect x="22.5" y="16" width="3" height="6" rx="1.5" fill="black" opacity="0.35" />
      <rect x="28" y="16" width="3" height="6" rx="1.5" fill="black" opacity="0.35" />
    </svg>
  );
}
