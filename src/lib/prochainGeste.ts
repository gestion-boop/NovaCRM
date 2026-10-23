/**
 * La phrase unique sous les priorités de l'accueil.
 * Le rendez-vous du jour passe devant les compteurs : c'est le seul
 * geste qui a une heure. Sinon, messages, puis mails, puis rappels.
 */

export interface EvenementAgenda {
  summary?: string;
  start?: { dateTime?: string; date?: string };
}

export interface RendezVousProchain {
  debut: Date;
  titre: string;
  journeeEntiere: boolean;
}

export type DestinationGeste = 'agenda' | 'chat' | 'mail-unread' | 'rappels';

export interface ProchainGeste {
  texte: string;
  nav: DestinationGeste;
}

export function instantEvenement(event: EvenementAgenda): { debut: Date; journeeEntiere: boolean } | null {
  if (event.start?.dateTime) {
    const debut = new Date(event.start.dateTime);
    if (Number.isNaN(debut.getTime())) return null;
    return { debut, journeeEntiere: false };
  }
  const jour = event.start?.date?.slice(0, 10);
  if (!jour) return null;
  const [annee, mois, quantieme] = jour.split('-').map(Number);
  if (!annee || !mois || !quantieme) return null;
  return { debut: new Date(annee, mois - 1, quantieme), journeeEntiere: true };
}

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function titreCourt(brut: string | undefined): string {
  const titre = (brut || '').replace(/\s+/g, ' ').trim() || 'Rendez-vous';
  return titre.length > 42 ? `${titre.slice(0, 41).trimEnd()}…` : titre;
}

function heureFr(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getHours()} h ${minutes}`;
}

/** Premier rendez-vous encore dans la journée.
 *  Une journée entière reste en fond : l'heure précise passe devant. */
export function prochainRendezVous(events: EvenementAgenda[], maintenant: Date): RendezVousProchain | null {
  let journee: RendezVousProchain | null = null;
  for (const event of events) {
    const instant = instantEvenement(event);
    if (!instant || !memeJour(instant.debut, maintenant)) continue;
    const choisi = { debut: instant.debut, titre: titreCourt(event.summary), journeeEntiere: instant.journeeEntiere };
    if (!instant.journeeEntiere) return choisi;
    if (!journee) journee = choisi;
  }
  return journee;
}

export function texteProchainGeste(opts: {
  maintenant: Date;
  rendezVous: RendezVousProchain | null;
  messagesNonLus: number;
  mailsNonLus: number;
  rappelsDuJour: number;
}): ProchainGeste | null {
  const rdv = opts.rendezVous;
  if (rdv && memeJour(rdv.debut, opts.maintenant)) {
    const texte = rdv.journeeEntiere ? `Aujourd'hui · ${rdv.titre}` : `${heureFr(rdv.debut)} · ${rdv.titre}`;
    return { texte, nav: 'agenda' };
  }
  if (opts.messagesNonLus > 0) {
    const n = opts.messagesNonLus;
    return { texte: n === 1 ? '1 message sans réponse' : `${n} messages sans réponse`, nav: 'chat' };
  }
  if (opts.mailsNonLus > 0) {
    const n = opts.mailsNonLus;
    return { texte: n === 1 ? '1 mail non lu' : `${n} mails non lus`, nav: 'mail-unread' };
  }
  if (opts.rappelsDuJour > 0) {
    const n = opts.rappelsDuJour;
    return { texte: n === 1 ? '1 rappel à traiter' : `${n} rappels à traiter`, nav: 'rappels' };
  }
  return null;
}
