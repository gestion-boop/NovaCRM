const KEY = (uid: string) => `contact-types-v1-${uid}`;

export const DEFAULT_CONTACT_TYPES = [
  "Téléphone",
  "Email",
  "Rendez-vous",
  "Salon / Événement",
  "Recommandation",
  "Site web",
  "Autre",
];

export const loadContactTypes = (uid: string | undefined): string[] => {
  if (!uid) return DEFAULT_CONTACT_TYPES;
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (!raw) return DEFAULT_CONTACT_TYPES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_CONTACT_TYPES;
  } catch {
    return DEFAULT_CONTACT_TYPES;
  }
};

export const saveContactTypes = (uid: string, list: string[]) => {
  try { localStorage.setItem(KEY(uid), JSON.stringify(list)); } catch {}
  window.dispatchEvent(new CustomEvent("contact-types-updated"));
};