/**
 * POST /api/immosphera/import-listing — Import automatique d'un bien
 * Immosphera360 à partir du lien de son annonce publique sur immosphera.fr
 * (demande explicite : "si on colle le lien directement du site Internet
 * où est le bien, est-ce qu'on pourrait pas récupérer toutes les
 * informations ?"). Le formulaire d'ajout/modif (PropertyFormModal.tsx)
 * appelle cet endpoint puis pré-remplit ses champs — l'utilisateur garde la
 * main pour relire/corriger avant d'enregistrer, rien n'est écrit en base ici.
 *
 * Restreint volontairement au domaine immosphera.fr (évite tout risque de
 * SSRF vers une URL arbitraire fournie par le client).
 */

const ALLOWED_HOST_RE = /(^|\.)immosphera\.fr$/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
}

// Se base uniquement sur le titre de l'annonce (+ tout début de la
// description) : les mots-clés cherchés ici ("bureau", "commerce"...) ne
// sont fiables qu'au sens "type de bien" — ils apparaissent trop souvent
// ailleurs dans une description longue (ex. "un bureau" = une pièce de la
// maison, pas un local commercial) pour être cherchés sur tout le texte.
function guessPropertyType(titleAndIntro: string): string {
  const t = titleAndIntro.toLowerCase();
  if (/appartement|studio/.test(t)) return 'apartment';
  if (/terrain\b/.test(t)) return 'land';
  if (/local commercial|locaux commerciaux|fonds de commerce|bureaux? à (louer|vendre)|entrepôt/.test(t)) return 'commercial';
  if (/maison|villa/.test(t)) return 'house';
  return 'house';
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: "URL manquante." });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ error: "URL invalide." });
      return;
    }

    if (!ALLOWED_HOST_RE.test(parsed.hostname)) {
      res.status(400).json({ error: "Seuls les liens immosphera.fr sont acceptés." });
      return;
    }

    const response = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NovaCRM-Import/1.0)' },
    });
    if (!response.ok) {
      res.status(502).json({ error: `Impossible de charger l'annonce (HTTP ${response.status}).` });
      return;
    }
    const html = await response.text();

    // --- JSON-LD (schema.org Product) : source principale, la plus fiable. ---
    let ld: any = null;
    const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    if (ldMatch) {
      try { ld = JSON.parse(ldMatch[1]); } catch { /* ignore */ }
    }
    const offer = ld?.offers;
    const item = offer?.itemOffered;

    const title: string = ld?.name || '';
    const price: number | null = typeof offer?.price === 'number' ? offer.price : null;
    const surfaceArea: number | null = typeof item?.floorSize?.value === 'number' ? item.floorSize.value : null;
    const locality: string = item?.address?.addressLocality || '';
    const postalCode: string = item?.address?.postalCode || '';
    const location = [locality, postalCode].filter(Boolean).join(', ');
    const photos: string[] = Array.isArray(item?.photo)
      ? item.photo.map((p: any) => p?.url).filter((u: any) => typeof u === 'string')
      : [];

    // --- Tableau de caractéristiques (paires "label / valeur" textblock) ---
    const specPairs: Record<string, string> = {};
    const specRe = /<span class="[^"]*textblock[^"]*">([^<]+)<\/span>[\s\S]{0,140}?<span class="[^"]*textblock[^"]*">([^<]+)<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = specRe.exec(html))) {
      const label = m[1].trim();
      const value = m[2].trim();
      if (label && value && !(label in specPairs)) specPairs[label] = value;
    }
    const rooms = specPairs['Pièces'] ? Number(specPairs['Pièces']) : (typeof item?.numberOfRooms === 'number' ? item.numberOfRooms : null);
    const bedrooms = specPairs['Chambres'] ? Number(specPairs['Chambres']) : null;
    const bathrooms = specPairs['Salle de bains'] ? Number(specPairs['Salle de bains'])
      : (typeof item?.numberOfBathroomsTotal === 'number' ? item.numberOfBathroomsTotal : null);
    const reference = specPairs['Référence'] || null;
    // Salle d'eau / WC : jamais récupérées jusqu'ici alors qu'elles figurent
    // souvent dans le tableau de caractéristiques du site, au même endroit
    // que "Salle de bains" — un `\d` de garde ici, car "WC" apparaît aussi
    // (vide, sans valeur chiffrée) dans le tableau "Détails des pièces" plus
    // bas sur certaines annonces, qu'on ne veut surtout pas récupérer.
    const shower = specPairs["Salle d'eau"] && /\d/.test(specPairs["Salle d'eau"]) ? specPairs["Salle d'eau"] : null;
    const wc = specPairs['WC'] && /\d/.test(specPairs['WC']) ? specPairs['WC'] : null;

    // --- Description complète + coordonnées du conseiller, sous le titre
    // "Descriptif du bien". Bug trouvé en test réel : selon l'annonce, ce
    // bloc est rendu tantôt dans un <p ...textblock...>, tantôt dans un
    // <span ...textblock...> — chercher seulement <p> faisait sauter ce
    // bloc pour atterrir sur le SUIVANT ayant la classe "textblock" (les
    // honoraires/DPE), donnant une "description" hors-sujet et aucune
    // coordonnée de conseiller. La regex ci-dessous capture n'importe quelle
    // balise (via une rétro-référence \1 sur son nom) du moment qu'elle a la
    // classe "textblock", ce qui couvre les deux gabarits.
    let description = decodeEntities(ld?.description || '');
    let agentEmail: string | null = null;
    let agentName: string | null = null;
    let agentPhone: string | null = null;
    const descIdx = html.indexOf('Descriptif du bien');
    if (descIdx >= 0) {
      const rest = html.slice(descIdx);
      const blockMatch = rest.match(/<(\w+)\s+class="[^"]*textblock[^"]*"[^>]*>([\s\S]*?)<\/\1>/);
      if (blockMatch) {
        const lines = blockMatch[2].split(/<br\s*\/?>/i).map((l) => stripTags(l));

        // Le bloc de coordonnées (nom / tél / email / fonction / RCS) varie
        // beaucoup d'un gabarit à l'autre : email parfois absent, nom avant
        // OU après le téléphone ("Pauline Immosphera / 07.../ email / ...")
        // vs ("...appelez-moi au 06.../ Christophe Hirsch"). On repère donc
        // les lignes tél/email dans une fenêtre de fin de texte, puis on
        // étend le "bloc contact" des deux côtés tant que les lignes
        // voisines sont courtes et ne ressemblent pas à une phrase — le nom
        // est ensuite la ligne courte restante qui n'est ni le tél/l'email
        // ni une mention RCS/SIRET/RSAC.
        const phoneRe = /(\+?\d[\d .-]{7,}\d)/;
        const emailRe = /[\w.+-]+@[\w.-]+\.\w+/;
        const rcsRe = /rcs|rsac|siret|rcp\b/i;
        const isSentenceLine = (l: string) => l.length > 90 || /[.!?]$/.test(l);

        const windowStart = Math.max(0, lines.length - 8);
        let phoneLineIdx = -1;
        let emailLineIdx = -1;
        for (let i = lines.length - 1; i >= windowStart; i--) {
          const line = lines[i];
          if (!line) continue;
          if (emailLineIdx === -1 && emailRe.test(line)) emailLineIdx = i;
          if (phoneLineIdx === -1 && !rcsRe.test(line) && phoneRe.test(line)) phoneLineIdx = i;
        }
        if (phoneLineIdx >= 0) agentPhone = lines[phoneLineIdx].match(phoneRe)?.[1]?.trim() || null;
        if (emailLineIdx >= 0) agentEmail = lines[emailLineIdx].match(emailRe)?.[0] || null;

        let cutFrom = lines.length;
        if (phoneLineIdx >= 0 || emailLineIdx >= 0) {
          const anchors = [phoneLineIdx, emailLineIdx].filter((i) => i >= 0);
          let blockStart = Math.min(...anchors);
          let blockEnd = Math.max(...anchors);
          while (blockStart - 1 >= windowStart && lines[blockStart - 1] && !isSentenceLine(lines[blockStart - 1])) {
            blockStart--;
          }
          while (blockEnd + 1 < lines.length && lines[blockEnd + 1] && lines[blockEnd + 1].length < 60 && !isSentenceLine(lines[blockEnd + 1])) {
            blockEnd++;
          }
          for (let i = blockStart; i <= blockEnd; i++) {
            const line = lines[i];
            if (!line || i === phoneLineIdx || i === emailLineIdx) continue;
            if (rcsRe.test(line) || /^(conseill|agent)/i.test(line)) continue;
            if (line.length < 45 && !agentName) agentName = line;
          }
          cutFrom = blockStart;
        }
        const fullText = stripTags(lines.slice(0, cutFrom).join('<br />'));
        if (fullText) description = fullText;
      }
    }

    // --- DPE / GES ("Classe énergie D, Classe climat C") ---
    const dpeMatch = html.match(/Classe énergie\s*([A-G])\s*,?\s*Classe climat\s*([A-G])/i);
    const dpe = dpeMatch ? dpeMatch[1].toUpperCase() : null;
    const ges = dpeMatch ? dpeMatch[2].toUpperCase() : null;

    // --- Terrasse / Piscine : jamais remontées jusqu'ici (toujours "Non"
    // par défaut dans le formulaire, même quand l'annonce les mentionne) —
    // détection par mot-clé dans le titre + la description, avec repli sur
    // "Non" seulement en cas de négation explicite.
    const amenityText = `${title} ${description}`;
    function detectAmenity(word: string): string | null {
      const t = amenityText.toLowerCase();
      if (new RegExp(`(sans|pas de|aucune?) ${word}`, 'i').test(t)) return 'Non';
      if (new RegExp(word, 'i').test(t)) return 'Oui';
      return null;
    }
    const terrace = detectAmenity('terrasse');
    const pool = detectAmenity('piscine');

    const listingType = /\/location\//i.test(parsed.pathname) ? 'rental' : 'sale';
    const propertyType = guessPropertyType(`${title} ${description.slice(0, 150)}`);

    res.status(200).json({
      title,
      location,
      price,
      surfaceArea,
      rooms,
      bedrooms,
      bathrooms,
      shower,
      wc,
      reference,
      description,
      dpe,
      ges,
      terrace,
      pool,
      listingType,
      propertyType,
      agentEmail,
      agentName,
      agentPhone,
      photos,
      sourceUrl: parsed.toString(),
    });
  } catch (err: any) {
    console.error('Erreur import annonce Immosphera', err);
    res.status(500).json({ error: err?.message || "Erreur lors de l'import de l'annonce." });
  }
}
