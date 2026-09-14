import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useImmoAuth as useAuth } from "@/immosphera/lib/access";
import { advisors, getAdvisorById, type Advisor } from "@/immosphera/lib/advisors";
import {
  geocodeAdresseAvecCodePostal,
  geocodeEntreeSecteur,
  entreeSecteurCorrespond,
  departementAutorise,
  rechercherCommunes,
  communesMemeCodePostal,
  DEPARTEMENTS_SECTEUR_LABEL,
  type GeoPoint,
  type SuggestionCommune,
} from "@/immosphera/lib/geo";
import { createTeardropIcon, adresseTooltipHtml } from "@/immosphera/lib/mapPins";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Send, Loader2, Maximize2, Minimize2, ChevronDown, ChevronUp, Compass, Pencil, X, Check, Search, Trash2, ListChecks } from "lucide-react";

// Demande explicite (14 septembre, v2 — après un premier essai à base de
// polygones dessinés à la main) : « dans les équipes, dans les fiches des
// agents, qu'on puisse définir des secteurs par exemple 11100, 11160,
// 11230 [...] ça peut créer des points sur une carte avec des couleurs,
// Laetitia un tracé jaune, Isabelle un tracé vert [...] et pour les
// contacts, comme dans Nova Visio : une adresse de prospection posée en
// fiche devient un point sur la carte, cliquable pour rouvrir la fiche. »
//
// Un secteur = UN conseiller (src/immosphera/lib/advisors.ts) + une liste
// de codes postaux + une couleur (immosphera_secteurs, une ligne par
// conseiller). Chaque code postal est géocodé (centroïde de la commune,
// pas de vraies limites administratives disponibles) et dessiné en cercle
// coloré — l'ensemble donne un "tracé" par recouvrement plutôt qu'un
// contour exact.

type Secteur = {
  id: string;
  agency_id: string;
  conseiller_id: string;
  couleur: string;
  codes_postaux: string[];
  // Demande explicite (14 septembre) : « pourquoi pas dessiner un secteur
  // aussi sur la carte qui englobe pas mal de codes postaux » — contour
  // libre optionnel, en complément des communes choisies via l'autocomplete
  // ci-dessous plutôt qu'à la place.
  polygone: GeoPoint[] | null;
};

type Contact = {
  id: string;
  nom: string;
  telephone: string | null;
  email: string | null;
  adresse: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  secteur_id: string | null;
  conseiller_origine_id: string | null;
  conseiller_assigne_id: string | null;
  statut: "nouveau" | "transfere" | "traite";
  created_at: string;
};

const COULEURS = [
  "#E0A21A",
  "#2f9e44",
  "#1971c2",
  "#e8590c",
  "#9c36b5",
  "#c92a2a",
  "#0c8599",
  // Couleurs plus foncées — demande explicite : « rajoute des couleurs
  // un peu plus foncées »
  "#8a6d1a",
  "#1e5f2c",
  "#144a80",
  "#8a3a0c",
  "#5c2170",
  "#7a1a1a",
  "#075662",
];
const RAYON_CERCLE_M = 2200;

const EMPTY_CONTACT = { nom: "", telephone: "", email: "", adresse: "", notes: "" };

export default function Secteurs() {
  const { user, peutGererSecteurs } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const secteurLayersRef = useRef<L.Circle[]>([]);
  const polygoneLayersRef = useRef<L.Polygon[]>([]);
  const draftLayerRef = useRef<L.Polygon | L.Polyline | null>(null);
  const pointsMarkersRef = useRef<L.Marker[]>([]);
  const contactMarkersRef = useRef<L.Marker[]>([]);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panneauOuvert, setPanneauOuvert] = useState(true);
  // Demande explicite : « un bouton qui ouvre un popup plus grand pour
  // supprimer des lieux avec une barre de recherche au cas où » — la liste
  // en ligne dans le panneau devient vite illisible avec 20+ communes.
  const [gererOuvertPour, setGererOuvertPour] = useState<string | null>(null);
  const [filtreGererCommunes, setFiltreGererCommunes] = useState("");
  // Couleur choisie dans le popup « Gérer les communes » (le sélecteur de
  // couleur a été déplacé ici depuis le panneau latéral).
  const [couleurEnEdition, setCouleurEnEdition] = useState<Record<string, string>>({});
  // Le code postal résolu est gardé avec chaque point (pas seulement les
  // coordonnées) — sert à afficher, à côté de chaque commune dans la liste
  // "villages enregistrés", ce à quoi elle a réellement été résolue (voir
  // plus bas) : rapporté « ça met Canet-en-Roussillon, je ne comprends pas
  // pourquoi » — sans repère visible, une résolution erronée passe inaperçue.
  const [centroides, setCentroides] = useState<Record<string, { point: GeoPoint; postcode: string | null }>>({});

  // Dessin de contour libre — conseiller pour lequel le dessin est en
  // cours (null = aucun), et les points déjà posés.
  const [dessinActif, setDessinActif] = useState<string | null>(null);
  const [pointsDraft, setPointsDraft] = useState<GeoPoint[]>([]);

  // Autocomplete de communes par conseiller (recherche en cours + résultats)
  const [rechercheCommune, setRechercheCommune] = useState<Record<string, string>>({});
  const [suggestionsCommune, setSuggestionsCommune] = useState<Record<string, SuggestionCommune[]>>({});
  const [communesVoisines, setCommunesVoisines] = useState<Record<string, SuggestionCommune[]>>({});

  const [ficheOuverte, setFicheOuverte] = useState(false);
  const [contactEnEdition, setContactEnEdition] = useState<Contact | null>(null);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT);
  const [enregistrementContact, setEnregistrementContact] = useState(false);

  const conseillerActuel: Advisor | undefined = useMemo(
    () => advisors.find((a) => a.email.toLowerCase() === (user?.email || "").toLowerCase()),
    [user?.email]
  );

  const { data: secteurs = [] } = useQuery({
    queryKey: ["immosphera-secteurs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("immosphera_secteurs" as any).select("*");
      if (error) throw error;
      return data as any as Secteur[];
    },
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["immosphera-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("immosphera_contacts" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any as Contact[];
    },
  });

  const secteurParConseiller = useMemo(() => new Map(secteurs.map((s) => [s.conseiller_id, s])), [secteurs]);
  const secteurParId = useMemo(() => new Map(secteurs.map((s) => [s.id, s])), [secteurs]);

  // Géocode toutes les entrées de secteur utilisées (code postal OU ville —
  // demande explicite : « mettre le code postal, également par ville, si
  // parfois on n'a pas le code postal en connaissance »), mis en cache
  // localStorage par geocodeEntreeSecteur lui-même.
  useEffect(() => {
    const toutesLesEntrees = Array.from(new Set(secteurs.flatMap((s) => s.codes_postaux)));
    const manquantes = toutesLesEntrees.filter((c) => !centroides[c]);
    if (manquantes.length === 0) return;
    // Rapporté : « j'ai mis beaucoup de secteur et cela ne s'affiche pas »
    // — un secteur avec de nombreuses communes géocodait chaque entrée
    // l'une après l'autre (boucle for + await), donc en attendant très
    // longtemps avant que les derniers cercles n'apparaissent. Toutes les
    // entrées manquantes sont maintenant géocodées EN PARALLÈLE.
    (async () => {
      const paires = await Promise.all(
        manquantes.map(async (entree) => {
          const resultat = await geocodeEntreeSecteur(entree);
          // Filtre défensif : une entrée hors Aude/Hérault/Pyrénées-
          // Orientales ne devrait déjà plus pouvoir être enregistrée (voir
          // la validation dans validerEtEnregistrerSecteur), mais une
          // donnée existante mal saisie avant cette règle ne doit pas
          // apparaître silencieusement.
          return resultat && departementAutorise(resultat.postcode)
            ? ([entree, { point: resultat.point, postcode: resultat.postcode }] as const)
            : null;
        })
      );
      const resultats = Object.fromEntries(
        paires.filter((p): p is readonly [string, { point: GeoPoint; postcode: string | null }] => p !== null)
      );
      if (Object.keys(resultats).length > 0) setCentroides((prev) => ({ ...prev, ...resultats }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secteurs]);

  // Init carte — centrée sur l'Aude/Hérault/Pyrénées-Orientales (demande
  // explicite : « la carte de l'Aude, l'Hérault et les Pyrénées-
  // Orientales »), plutôt que le point générique utilisé jusqu'ici.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { zoomControl: false });
    // Demande explicite (14 septembre, en réaction à une maquette envoyée
    // par le client) : « est-ce que tu peux présenter les cartes comme ça ?
    // ça serait plus sympa. » Un fond CARTO Voyager a été essayé pour un
    // rendu plus épuré, mais s'est révélé peu fiable (clé API exigée, puis
    // intégration qui ne fonctionnait toujours pas une fois la clé
    // configurée côté Vercel) — abandonné au profit d'OpenStreetMap
    // standard, gratuit, sans clé, et déjà utilisé partout ailleurs dans
    // le module (PropertyMap.tsx).
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
    map.setView([43.05, 2.75], 8);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Dessin d'un contour libre — chaque clic ajoute un point, tant que
  // `dessinActif` porte un conseiller.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (!dessinActif) return;
      setPointsDraft((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [dessinActif]);

  // Trace en cours (pointillé tant qu'il n'est pas fermé)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (draftLayerRef.current) {
      draftLayerRef.current.remove();
      draftLayerRef.current = null;
    }
    const couleur = dessinActif ? secteurParConseiller.get(dessinActif)?.couleur || "#E0A21A" : "#E0A21A";
    if (pointsDraft.length >= 3) {
      draftLayerRef.current = L.polygon(
        pointsDraft.map((p) => [p.lat, p.lng] as [number, number]),
        { color: couleur, weight: 2, dashArray: "6 4", fillOpacity: 0.15 }
      ).addTo(map);
    } else if (pointsDraft.length > 0) {
      draftLayerRef.current = L.polyline(
        pointsDraft.map((p) => [p.lat, p.lng] as [number, number]),
        { color: couleur, weight: 2, dashArray: "6 4" }
      ).addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsDraft, dessinActif]);

  // Points du contour en cours — déplaçables (glisser) et supprimables (clic)
  // demande explicite : « pourrait-on mettre des points et les bouger ? ou
  // les effacer ? »
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pointsMarkersRef.current.forEach((m) => m.remove());
    pointsMarkersRef.current = [];
    if (!dessinActif) return;
    const couleur = secteurParConseiller.get(dessinActif)?.couleur || "#E0A21A";
    pointsDraft.forEach((point, index) => {
      const icon = L.divIcon({
        className: "point-contour",
        html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${couleur};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:grab"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const marker = L.marker([point.lat, point.lng], { icon, draggable: true, title: "Glisser pour déplacer, clic pour supprimer" });
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        setPointsDraft((prev) => prev.map((p, i) => (i === index ? { lat: pos.lat, lng: pos.lng } : p)));
      });
      // Rapporté : « je ne peux pas supprimer des points » — un appel à
      // L.DomEvent.stopPropagation(e) ici attendait un événement DOM natif,
      // pas l'événement Leaflet reçu par ce handler ; l'appel plantait
      // silencieusement avant d'atteindre setPointsDraft juste en dessous.
      // Un clic sur un marqueur ne remonte de toute façon pas jusqu'au clic
      // "ajouter un point" de la carte (comportement Leaflet par défaut) :
      // inutile de l'arrêter à la main.
      marker.on("click", () => {
        setPointsDraft((prev) => prev.filter((_, i) => i !== index));
      });
      marker.addTo(map);
      pointsMarkersRef.current.push(marker);
    });
  }, [pointsDraft, dessinActif, secteurParConseiller]);

  // Contours enregistrés (un polygone par secteur qui en a un) — celui du
  // conseiller en cours d'édition est masqué : rapporté « quand je modifie
  // le contour, le reste reste sur l'écran », le tracé déjà enregistré
  // restait affiché EN PLUS du brouillon modifiable, dédoublant l'affichage.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    polygoneLayersRef.current.forEach((l) => l.remove());
    polygoneLayersRef.current = [];
    secteurs.forEach((s) => {
      if (s.conseiller_id === dessinActif) return;
      if (!Array.isArray(s.polygone) || s.polygone.length < 3) return;
      const conseiller = getAdvisorById(s.conseiller_id);
      const polygone = L.polygon(
        s.polygone.map((p) => [p.lat, p.lng] as [number, number]),
        { color: s.couleur, weight: 2, fillColor: s.couleur, fillOpacity: 0.12 }
      );
      polygone.bindTooltip(`<b>${conseiller?.name || "?"}</b>`, { sticky: true });
      polygone.addTo(map);
      polygoneLayersRef.current.push(polygone);
    });
  }, [secteurs, dessinActif]);

  // Cercles de secteur (un par code postal, coloré selon le conseiller) —
  // contour discret + remplissage doux, plusieurs cercles superposés donnant
  // l'effet de "tracé" continu façon aplat peint plutôt qu'un pointillé.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    secteurLayersRef.current.forEach((l) => l.remove());
    secteurLayersRef.current = [];
    secteurs.forEach((s) => {
      const conseiller = getAdvisorById(s.conseiller_id);
      s.codes_postaux.forEach((code) => {
        const centre = centroides[code]?.point;
        if (!centre) return;
        const cercle = L.circle([centre.lat, centre.lng], {
          radius: RAYON_CERCLE_M,
          color: s.couleur,
          weight: 1,
          opacity: 0.5,
          fillColor: s.couleur,
          fillOpacity: 0.22,
        });
        cercle.bindTooltip(`<b>${conseiller?.name || "?"}</b><br/>${code}`, { sticky: true });
        cercle.addTo(map);
        secteurLayersRef.current.push(cercle);
      });
    });
  }, [secteurs, centroides]);

  // Points contacts
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    contactMarkersRef.current.forEach((m) => m.remove());
    contactMarkersRef.current = [];
    contacts.forEach((c) => {
      if (c.latitude == null || c.longitude == null) return;
      const secteur = c.secteur_id ? secteurParId.get(c.secteur_id) : null;
      const couleur = secteur?.couleur || "#495057";
      // Pin façon Google Maps + survol = adresse — demande explicite :
      // « quand on rentre l'adresse du client, cela s'affiche dans la
      // carte du secteur comme un point [...] et qu'on survole avec la
      // souris [...] il y a automatiquement l'adresse du client ».
      const icon = createTeardropIcon(couleur, { size: 26 });
      const marker = L.marker([c.latitude, c.longitude], { icon });
      marker.bindTooltip(adresseTooltipHtml(c.adresse || "", c.nom), { direction: "top", offset: [0, -24] });
      marker.on("click", () => ouvrirFiche(c));
      marker.addTo(map);
      contactMarkersRef.current.push(marker);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, secteurParId]);

  // Fit bounds au premier chargement (secteurs, sinon contacts)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points: [number, number][] = [];
    secteurs.forEach((s) => s.codes_postaux.forEach((c) => centroides[c] && points.push([centroides[c].point.lat, centroides[c].point.lng])));
    contacts.forEach((c) => c.latitude != null && c.longitude != null && points.push([c.latitude, c.longitude]));
    if (points.length > 0) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroides, contacts.length]);

  // Plein écran (API native — même mécanisme que le bouton "Carte" des Biens)
  const toggleFullscreen = () => {
    if (!mapWrapperRef.current) return;
    if (!document.fullscreenElement) mapWrapperRef.current.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  // Leaflet doit recalculer sa taille après un changement de plein écran
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  const ouvrirFiche = (contact: Contact | null) => {
    setContactEnEdition(contact);
    setContactForm(
      contact
        ? { nom: contact.nom, telephone: contact.telephone || "", email: contact.email || "", adresse: contact.adresse, notes: contact.notes || "" }
        : EMPTY_CONTACT
    );
    setFicheOuverte(true);
  };

  const agencyIdRef = useRef<string | null>(null);
  const resoudreAgencyId = async () => {
    if (agencyIdRef.current) return agencyIdRef.current;
    const { data } = await supabase.from("agencies" as any).select("id, name").ilike("name", "%immosphera%").limit(1);
    const id = (data as any[])?.[0]?.id ?? null;
    agencyIdRef.current = id;
    return id;
  };

  // Enregistrer une fiche contact — nouvelle ou existante. L'adresse est
  // géocodée à chaque sauvegarde (elle a pu changer) pour retrouver le
  // secteur correspondant, comme dans Nova Visio.
  const enregistrerFiche = async () => {
    if (!contactForm.nom.trim() || !contactForm.adresse.trim()) {
      toast({ title: "Nom et adresse requis", variant: "destructive" });
      return;
    }
    setEnregistrementContact(true);
    try {
      const geo = await geocodeAdresseAvecCodePostal(contactForm.adresse);
      const secteurTrouve = geo
        ? secteurs.find((s) => s.codes_postaux.some((entree) => entreeSecteurCorrespond(entree, geo)))
        : null;

      const base = {
        nom: contactForm.nom.trim(),
        telephone: contactForm.telephone.trim() || null,
        email: contactForm.email.trim() || null,
        adresse: contactForm.adresse.trim(),
        latitude: geo?.lat ?? null,
        longitude: geo?.lng ?? null,
        notes: contactForm.notes.trim() || null,
        secteur_id: secteurTrouve?.id ?? null,
      };

      if (contactEnEdition) {
        const { error } = await supabase.from("immosphera_contacts" as any).update(base as any).eq("id", contactEnEdition.id);
        if (error) throw error;
      } else {
        const agencyId = await resoudreAgencyId();
        const { error } = await supabase.from("immosphera_contacts" as any).insert({
          ...base,
          agency_id: agencyId,
          conseiller_origine_id: conseillerActuel?.id ?? null,
          conseiller_assigne_id: conseillerActuel?.id ?? null,
          statut: "nouveau",
        } as any);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["immosphera-contacts"] });
      if (secteurTrouve && secteurTrouve.conseiller_id !== (contactEnEdition?.conseiller_assigne_id ?? conseillerActuel?.id)) {
        toast({
          title: `Cette adresse tombe dans le secteur de ${getAdvisorById(secteurTrouve.conseiller_id)?.name || "?"}`,
          description: "Pense à lui envoyer la fiche si besoin.",
        });
      } else {
        toast({ title: "Fiche enregistrée" });
      }
      setFicheOuverte(false);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setEnregistrementContact(false);
    }
  };

  const transfererContact = async (contact: Contact, conseillerId: string) => {
    const { error } = await supabase
      .from("immosphera_contacts" as any)
      .update({ conseiller_assigne_id: conseillerId, statut: "transfere", updated_at: new Date().toISOString() } as any)
      .eq("id", contact.id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["immosphera-contacts"] });
    const destinataire = getAdvisorById(conseillerId);
    toast({ title: destinataire ? `Fiche envoyée à ${destinataire.name}` : "Fiche envoyée" });
    try {
      if (destinataire?.email) {
        const { data: profil } = await supabase.from("profiles" as any).select("id").ilike("email", destinataire.email).maybeSingle();
        const profilId = (profil as any)?.id;
        if (profilId) {
          await supabase.rpc("create_notification" as any, {
            _user_id: profilId,
            _type: "immosphera_contact",
            _title: `📍 Nouveau contact hors secteur : ${contact.nom}`,
            _message: `${conseillerActuel?.name || "Un conseiller"} t'a envoyé ${contact.nom} (${contact.adresse}).`,
            _entity_type: "immosphera_contact",
            _entity_id: contact.id,
            _agency_id: null,
            _metadata: { url: "/immosphera/secteurs" },
          } as any);
        }
      }
    } catch (e) {
      console.warn("Notification de transfert de contact impossible :", e);
    }
  };

  // ── Édition des secteurs (super admin) ──────────────────────────────
  const [codesEnEdition, setCodesEnEdition] = useState<Record<string, string>>({});
  // Lu depuis suggererVoisines (async) pour exclure ce qui est déjà ajouté
  // au moment où la réponse arrive — un simple state ne suffit pas là, un
  // useState capturé dans une closure async reste figé à sa valeur du
  // moment de l'appel.
  const codesEnEditionRef = useRef(codesEnEdition);
  useEffect(() => {
    codesEnEditionRef.current = codesEnEdition;
  }, [codesEnEdition]);
  const sauvegarderSecteurMutation = useMutation({
    mutationFn: async ({
      conseillerId,
      codes,
      couleur,
      polygone,
    }: {
      conseillerId: string;
      codes: string[];
      couleur: string;
      // Omis = ne pas toucher au contour déjà enregistré (upsert Supabase :
      // seules les colonnes présentes dans l'objet sont mises à jour).
      polygone?: GeoPoint[] | null;
    }) => {
      const agencyId = await resoudreAgencyId();
      const payload: any = {
        agency_id: agencyId,
        conseiller_id: conseillerId,
        codes_postaux: codes,
        couleur,
        updated_at: new Date().toISOString(),
      };
      if (polygone !== undefined) payload.polygone = polygone;
      const { error } = await supabase
        .from("immosphera_secteurs" as any)
        .upsert(payload, { onConflict: "agency_id,conseiller_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["immosphera-secteurs"] });
      toast({ title: "Secteur mis à jour" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const demarrerDessin = (conseillerId: string) => {
    setDessinActif(conseillerId);
    // Reprend le contour existant s'il y en a déjà un (déplaçable/
    // supprimable comme les nouveaux points) plutôt que de repartir de
    // zéro et écraser ce qui était tracé.
    setPointsDraft(secteurParConseiller.get(conseillerId)?.polygone ?? []);
  };
  const annulerDessin = () => {
    setDessinActif(null);
    setPointsDraft([]);
  };
  const terminerDessin = () => {
    if (!dessinActif || pointsDraft.length < 3) {
      toast({ title: "Trace un contour d'au moins 3 points avant de terminer.", variant: "destructive" });
      return;
    }
    const secteur = secteurParConseiller.get(dessinActif);
    sauvegarderSecteurMutation.mutate({
      conseillerId: dessinActif,
      codes: secteur?.codes_postaux ?? [],
      couleur: secteur?.couleur ?? COULEURS[advisors.findIndex((a) => a.id === dessinActif) % COULEURS.length],
      polygone: pointsDraft,
    });
    setDessinActif(null);
    setPointsDraft([]);
  };
  const effacerContour = (conseillerId: string) => {
    const secteur = secteurParConseiller.get(conseillerId);
    if (!secteur) return;
    sauvegarderSecteurMutation.mutate({
      conseillerId,
      codes: secteur.codes_postaux,
      couleur: secteur.couleur,
      polygone: null,
    });
  };

  // Autocomplete communes — demande explicite : « un fichier déroulant, on
  // peut cliquer plusieurs villes » plutôt que de taper à la main.
  //
  // Rapporté : « rien ne s'affiche » après avoir collé une longue liste de
  // 26 communes séparées par des virgules — collée dans ce champ recherche
  // (une seule commune à la fois) plutôt que dans le champ liste en
  // dessous, elle ne matchait jamais rien et l'enregistrement suivant
  // sauvegardait 0 commune. Détecte une virgule = liste collée, résout
  // chaque nom séparément plutôt que de chercher la chaîne entière d'un
  // coup (qui ne peut rien matcher).
  const rechercherEtSuggerer = async (conseillerId: string, texte: string) => {
    setRechercheCommune((prev) => ({ ...prev, [conseillerId]: texte }));
    if (texte.includes(",")) {
      const termes = texte.split(",").map((t) => t.trim()).filter(Boolean);
      if (termes.length > 1) {
        setSuggestionsCommune((prev) => ({ ...prev, [conseillerId]: [] }));
        const resolues = await Promise.all(termes.map((t) => rechercherCommunes(t)));
        const introuvables: string[] = [];
        resolues.forEach((resultats, i) => {
          if (resultats[0]) ajouterCommuneSuggeree(conseillerId, resultats[0]);
          else introuvables.push(termes[i]);
        });
        setRechercheCommune((prev) => ({ ...prev, [conseillerId]: "" }));
        if (introuvables.length > 0) {
          toast({
            title: "Certaines communes n'ont pas été trouvées",
            description: introuvables.join(", "),
            variant: "destructive",
          });
        }
        return;
      }
    }
    const resultats = await rechercherCommunes(texte);
    setSuggestionsCommune((prev) => ({ ...prev, [conseillerId]: resultats }));
  };
  const ajouterCommuneSuggeree = (conseillerId: string, suggestion: SuggestionCommune) => {
    setCodesEnEdition((prev) => {
      const actuel = prev[conseillerId] ?? (secteurParConseiller.get(conseillerId)?.codes_postaux.join(", ") || "");
      const liste = actuel.split(",").map((s) => s.trim()).filter(Boolean);
      // Ajoute le NOM de la commune (validé par cette recherche), pas le
      // code postal : plusieurs villages voisins partagent souvent le même
      // code (voir suggererVoisines juste en dessous) — les ajouter tous
      // sous le même code ne changerait rien visuellement (un seul cercle,
      // déjà présent), alors que chaque nom se géocode individuellement et
      // dessine son propre cercle, reflétant la vraie dispersion du secteur.
      if (!liste.includes(suggestion.nom)) liste.push(suggestion.nom);
      return { ...prev, [conseillerId]: liste.join(", ") };
    });
    setRechercheCommune((prev) => ({ ...prev, [conseillerId]: "" }));
    setSuggestionsCommune((prev) => ({ ...prev, [conseillerId]: [] }));
    // Rapporté (avec le détail exact vérifié — « 11200 dessert 23 communes
    // et villages [...] c'est ça que je veux comme proposition ») : propose
    // TOUTES les communes qui partagent le même code postal que celle qu'on
    // vient d'ajouter, pas seulement les plus proches à vol d'oiseau.
    void suggererVoisines(conseillerId, suggestion);
  };
  const suggererVoisines = async (conseillerId: string, suggestion: SuggestionCommune) => {
    const voisines = await communesMemeCodePostal(suggestion.codePostal);
    // Rapporté : « quand je sélectionne, il faudrait que cela s'enlève de
    // la liste » — exclut tout ce qui est déjà dans le champ au moment où
    // la réponse arrive (pas seulement la commune qui vient d'être
    // cliquée), via la ref plutôt que le state directement capturé dans
    // cette fonction async, qui resterait figé à sa valeur de départ.
    const actuel =
      codesEnEditionRef.current[conseillerId] ?? (secteurParConseiller.get(conseillerId)?.codes_postaux.join(", ") || "");
    const dejaAjoutes = new Set(actuel.split(",").map((s) => s.trim()).filter(Boolean));
    setCommunesVoisines((prev) => ({
      ...prev,
      [conseillerId]: voisines.filter((v) => !dejaAjoutes.has(v.nom)),
    }));
  };

  // Valide chaque entrée AVANT d'enregistrer — demande explicite : « les
  // codes postaux et les villes doivent être impérativement de l'Aude, de
  // l'Hérault et des Pyrénées-Orientales, si jamais tu la codes autre part
  // c'est une erreur de ta part. » Une seule entrée hors zone (ou
  // introuvable) bloque tout l'enregistrement plutôt que de la filtrer en
  // silence — l'admin doit la corriger, pas la voir disparaître sans savoir
  // pourquoi.
  const [validationEnCours, setValidationEnCours] = useState<string | null>(null);
  const validerEtEnregistrerSecteur = async (conseillerId: string, codesBruts: string[], couleur: string) => {
    setValidationEnCours(conseillerId);
    try {
      const horsZone: string[] = [];
      const introuvables: string[] = [];
      const valides: string[] = [];
      const nouveauxCentroides: Record<string, { point: GeoPoint; postcode: string | null }> = {};
      // Géocodées en parallèle plutôt qu'une par une (voir le même
      // correctif sur l'effet de géocodage plus haut) : un secteur avec
      // beaucoup de communes mettait très longtemps à s'enregistrer.
      await Promise.all(
        codesBruts.map(async (entree) => {
          const resultat = await geocodeEntreeSecteur(entree);
          if (!resultat) {
            introuvables.push(entree);
            return;
          }
          if (!departementAutorise(resultat.postcode)) {
            horsZone.push(entree);
            return;
          }
          valides.push(entree);
          nouveauxCentroides[entree] = { point: resultat.point, postcode: resultat.postcode };
        })
      );
      // Rapporté : « quand je mets Lézignan, tous les villages ne se
      // mettent pas quand je clique sur enregistrer » — l'ancienne version
      // bloquait TOUT l'enregistrement si UNE SEULE entrée posait problème
      // (introuvable, hors zone), même parmi 20+ communes valides. Enregistre
      // maintenant celles qui sont valides, et prévient juste pour les
      // autres au lieu de tout perdre.
      if (introuvables.length > 0 || horsZone.length > 0) {
        toast({
          title: valides.length > 0 ? `${valides.length} commune${valides.length > 1 ? "s" : ""} enregistrée${valides.length > 1 ? "s" : ""}, le reste ignoré` : "Secteur non enregistré",
          description: [
            introuvables.length > 0 ? `Introuvable : ${introuvables.join(", ")}.` : "",
            horsZone.length > 0 ? `Hors ${DEPARTEMENTS_SECTEUR_LABEL} : ${horsZone.join(", ")}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
          variant: "destructive",
        });
        if (valides.length === 0) return;
      }
      setCentroides((prev) => ({ ...prev, ...nouveauxCentroides }));
      sauvegarderSecteurMutation.mutate({ conseillerId, codes: valides, couleur });
    } finally {
      setValidationEnCours(null);
    }
  };

  const statutLabel: Record<Contact["statut"], string> = { nouveau: "Nouveau", transfere: "Transféré", traite: "Traité" };

  return (
    <div className="p-3 md:flex md:gap-3">
      {/* Carte — hauteur explicite (comme l'onglet "Carte" des Biens, h-[88vh]) :
          la page ImmoSphera360 est montée dans un conteneur "overflow-y-auto"
          (App.tsx) où un simple h-full/flex-1 ne se propage pas de façon
          fiable, d'où la carte trop courte signalée (« elle n'est pas en
          plein écran »). Plein écran natif disponible en plus via le bouton. */}
      <div className="md:flex-1 flex flex-col mb-3 md:mb-0">
        <div className="flex items-center gap-2 pb-2">
          <h2 className="font-bold text-sm mr-auto">🗺️ Secteurs</h2>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => ouvrirFiche(null)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Nouvelle fiche
          </Button>
        </div>
        <div
          ref={mapWrapperRef}
          className={`relative rounded-2xl overflow-hidden border border-border bg-background ${
            isFullscreen ? "h-screen w-screen" : "h-[80vh]"
          }`}
        >
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Quitter le plein écran" : "Agrandir la carte"}
            className="absolute top-3 right-3 z-[1000] w-9 h-9 rounded-full bg-card/90 backdrop-blur-sm border border-border grid place-items-center hover:bg-card transition-colors shadow-md"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          {/* Bandeau titre + boussole — dans l'esprit de la maquette envoyée
              (« CARTOGRAPHIE DU SECTEUR »), sans chercher à reproduire ses
              formes peintes à la main sur une carte qui reste vivante. */}
          <div className="absolute top-3 left-3 z-[1000] px-4 py-2.5 rounded-xl bg-[#1b2b2e]/92 backdrop-blur-sm shadow-lg">
            <p className="text-[9px] tracking-[0.2em] text-[#E0A21A]/80 font-bold uppercase">Cartographie</p>
            <p className="text-sm font-bold text-white -mt-0.5">Secteurs des conseillers</p>
          </div>
          <div className="absolute top-3 right-16 z-[1000] w-9 h-9 rounded-full bg-card/90 backdrop-blur-sm border border-border grid place-items-center shadow-md">
            <Compass className="h-4 w-4 text-[#E0A21A]" />
          </div>

          {/* Légende — un point par conseiller ayant un secteur défini */}
          {secteurs.length > 0 && (
            <div className="absolute bottom-6 left-3 z-[1000] px-3 py-2 rounded-xl bg-card/92 backdrop-blur-sm border border-border shadow-lg space-y-1 max-w-[160px]">
              {secteurs.map((s) => {
                const conseiller = getAdvisorById(s.conseiller_id);
                if (!conseiller) return null;
                return (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.couleur }} />
                    <span className="text-[10px] font-semibold truncate">{conseiller.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div ref={mapContainerRef} className="absolute inset-0" />
        </div>
      </div>

      {/* Panneau latéral : secteurs (admin) + contacts */}
      <aside className="w-full md:w-96 shrink-0 border border-border rounded-2xl flex flex-col h-[80vh] overflow-y-auto">
        {peutGererSecteurs && (
          <div className="border-b border-border">
            <button
              className="w-full flex items-center gap-2 p-3 text-xs font-bold"
              onClick={() => setPanneauOuvert((v) => !v)}
            >
              Secteurs par conseiller
              {panneauOuvert ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
            </button>
            {panneauOuvert && (
              <div className="p-3 pt-0 space-y-3">
                <p className="text-[10px] text-muted-foreground -mt-1">
                  Code postal ou nom de ville, séparés par des virgules. Limité pour l'instant à {DEPARTEMENTS_SECTEUR_LABEL} — une entrée hors zone bloque l'enregistrement.
                </p>
                {advisors.map((a) => {
                  const secteur = secteurParConseiller.get(a.id);
                  const valeurCourante = codesEnEdition[a.id] ?? (secteur?.codes_postaux.join(", ") || "");
                  const couleur = secteur?.couleur || COULEURS[advisors.indexOf(a) % COULEURS.length];
                  const enTrainDeDessiner = dessinActif === a.id;
                  const suggestions = suggestionsCommune[a.id] ?? [];
                  return (
                    <div key={a.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                      <span className="w-3 h-3 rounded-full mt-1.5 shrink-0" style={{ background: couleur }} />
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-[11px] font-bold">{a.name}</p>

                        {/* Ajout ET suppression des communes vivent
                            maintenant ensemble dans le popup « Gérer les
                            communes » — demande explicite : « il faudrait
                            juste revoir l'incorporation des communes.
                            Mettre les communes quand on a le panneau pop up
                            comme ça on pourrait mieux voir ». Le bouton
                            reste visible même à 0 commune, pour pouvoir en
                            ajouter une première depuis le popup. */}
                        {(() => {
                          const listeActuelle = valeurCourante.split(",").map((s) => s.trim()).filter(Boolean);
                          return (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] w-full justify-start"
                              onClick={() => {
                                setGererOuvertPour(a.id);
                                setFiltreGererCommunes("");
                              }}
                            >
                              <ListChecks className="h-3.5 w-3.5 mr-1.5" />
                              {listeActuelle.length > 0
                                ? `Voir les ${listeActuelle.length} commune${listeActuelle.length > 1 ? "s" : ""}`
                                : "Gérer les communes"}
                            </Button>
                          );
                        })()}

                        <Input
                          value={valeurCourante}
                          onChange={(e) => setCodesEnEdition((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          placeholder="11100, Narbonne, 11160..."
                          className="h-7 text-[11px]"
                        />
                        {/* Le choix de couleur vit désormais dans le popup
                            « Gérer les communes » (avec la liste) — demande
                            explicite : « ajoute les couleurs comme ça on
                            les supprime dans l'autre interface ». */}
                        <div className="flex items-center gap-1 flex-wrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] ml-auto px-2"
                            disabled={validationEnCours === a.id}
                            onClick={() =>
                              validerEtEnregistrerSecteur(
                                a.id,
                                valeurCourante.split(",").map((s) => s.trim()).filter(Boolean),
                                couleur
                              )
                            }
                          >
                            {validationEnCours === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Enregistrer"}
                          </Button>
                        </div>

                        {/* Contour libre — demande explicite : « pourquoi
                            pas dessiner un secteur aussi sur la carte qui
                            englobe pas mal de codes postaux » */}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          {enTrainDeDessiner ? (
                            <>
                              <span className="text-[10px] text-muted-foreground">
                                Clique pour ajouter, glisse pour déplacer, clique un point pour l'effacer ({pointsDraft.length} pt{pointsDraft.length > 1 ? "s" : ""})
                              </span>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 ml-auto" onClick={terminerDessin}>
                                <Check className="h-3 w-3 mr-1" /> Terminer
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={annulerDessin}>
                                <X className="h-3 w-3" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2"
                                disabled={dessinActif !== null}
                                onClick={() => demarrerDessin(a.id)}
                              >
                                <Pencil className="h-3 w-3 mr-1" /> {secteur?.polygone ? "Modifier le contour" : "Dessiner un contour"}
                              </Button>
                              {secteur?.polygone && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] px-2 text-muted-foreground"
                                  onClick={() => effacerContour(a.id)}
                                >
                                  Effacer
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 p-3 border-b border-border">
          <h2 className="font-bold text-sm">Contacts ({contacts.length})</h2>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {contacts.length === 0 && <p className="text-xs text-muted-foreground p-4 text-center">Aucune fiche enregistrée.</p>}
          {contacts.map((c) => {
            const secteur = c.secteur_id ? secteurParId.get(c.secteur_id) : null;
            const origine = c.conseiller_origine_id ? getAdvisorById(c.conseiller_origine_id) : null;
            const assigne = c.conseiller_assigne_id ? getAdvisorById(c.conseiller_assigne_id) : null;
            return (
              <div key={c.id} className="p-3 space-y-1.5 cursor-pointer hover:bg-muted/30" onClick={() => ouvrirFiche(c)}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold">{c.nom}</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                    {statutLabel[c.statut]}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" /> {c.adresse}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                  {secteur ? (
                    <span className="px-1.5 py-0.5 rounded-full font-semibold text-white" style={{ background: secteur.couleur }}>
                      {getAdvisorById(secteur.conseiller_id)?.name || secteur.conseiller_id}
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Hors secteur</span>
                  )}
                  {origine && <span className="text-muted-foreground">de {origine.name}</span>}
                  {assigne && assigne.id !== origine?.id && <span className="text-muted-foreground">→ {assigne.name}</span>}
                </div>
                <div className="flex items-center gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                  <Select onValueChange={(id) => transfererContact(c, id)}>
                    <SelectTrigger className="h-7 text-[11px] flex-1">
                      <SelectValue placeholder="Envoyer à..." />
                    </SelectTrigger>
                    <SelectContent>
                      {advisors.map((a) => (
                        <SelectItem key={a.id} value={a.id} className="text-xs">
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Send className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Fiche contact — création ou édition, ouverte depuis la carte ou la liste */}
      <Dialog open={ficheOuverte} onOpenChange={setFicheOuverte}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{contactEnEdition ? "Fiche contact" : "Nouvelle fiche"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nom</Label>
              <Input value={contactForm.nom} onChange={(e) => setContactForm((f) => ({ ...f, nom: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Téléphone</Label>
                <Input value={contactForm.telephone} onChange={(e) => setContactForm((f) => ({ ...f, telephone: e.target.value }))} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Adresse</Label>
              <Input
                value={contactForm.adresse}
                onChange={(e) => setContactForm((f) => ({ ...f, adresse: e.target.value }))}
                placeholder="N° rue, code postal, ville"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Géocodée automatiquement, comme sur la carte Novavisio.</p>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={contactForm.notes} onChange={(e) => setContactForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <Button className="w-full" onClick={enregistrerFiche} disabled={enregistrementContact}>
              {enregistrementContact ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Gérer les communes d'un secteur — demande explicite : « un bouton
          qui ouvre un popup plus grand pour supprimer des lieux avec une
          barre de recherche au cas où ». */}
      <Dialog open={gererOuvertPour !== null} onOpenChange={(v) => !v && setGererOuvertPour(null)}>
        {/* z-[2000] : sans ça, la carte passait devant le popup — nos
            propres repères sur la carte (titre, boussole, légende) sont en
            z-[1000], bien au-dessus du z-50 par défaut du Dialog. */}
        <DialogContent className="z-[2000] max-w-2xl w-[calc(100vw-2rem)] h-[85vh] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Communes {gererOuvertPour && `— ${getAdvisorById(gererOuvertPour)?.name || ""}`}
            </DialogTitle>
          </DialogHeader>
          {gererOuvertPour &&
            (() => {
              const conseillerId = gererOuvertPour;
              const valeurCourante = codesEnEdition[conseillerId] ?? (secteurParConseiller.get(conseillerId)?.codes_postaux.join(", ") || "");
              const liste = valeurCourante.split(",").map((s) => s.trim()).filter(Boolean);
              const filtre = filtreGererCommunes.trim().toLowerCase();
              const listeFiltree = filtre ? liste.filter((entree) => entree.toLowerCase().includes(filtre)) : liste;
              const retirer = (entree: string) =>
                setCodesEnEdition((prev) => ({
                  ...prev,
                  [conseillerId]: liste.filter((e) => e !== entree).join(", "),
                }));
              const suggestionsAjout = suggestionsCommune[conseillerId] ?? [];
              const voisinesAjout = communesVoisines[conseillerId] ?? [];
              const secteurActuel = secteurParConseiller.get(conseillerId);
              const couleurActuelle =
                couleurEnEdition[conseillerId] ??
                secteurActuel?.couleur ??
                COULEURS[advisors.findIndex((a) => a.id === conseillerId) % COULEURS.length];
              return (
                <div className="flex-1 min-h-0 flex flex-col gap-3">
                  {/* Ajout — autocomplete (« un fichier déroulant, on peut
                      cliquer plusieurs villes ») déplacé ici depuis la
                      barre latérale, plus à l'aise dans ce grand popup. */}
                  <div className="relative shrink-0">
                    <Input
                      value={rechercheCommune[conseillerId] ?? ""}
                      onChange={(e) => rechercherEtSuggerer(conseillerId, e.target.value)}
                      placeholder="Chercher une commune à ajouter..."
                      className="h-9 text-sm"
                    />
                    {suggestionsAjout.length > 0 && (
                      <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {suggestionsAjout.map((s) => (
                          <button
                            key={`${s.nom}-${s.codePostal}`}
                            type="button"
                            onClick={() => ajouterCommuneSuggeree(conseillerId, s)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center justify-between gap-2"
                          >
                            <span>{s.nom}</span>
                            <span className="text-muted-foreground shrink-0">{s.codePostal}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Communes du même code postal — « 11200 dessert 23
                      communes et villages [...] c'est ça que je veux comme
                      proposition ». */}
                  {voisinesAjout.length > 0 && (
                    <div className="flex flex-wrap gap-1 shrink-0">
                      {voisinesAjout.map((v) => (
                        <button
                          key={`${v.nom}-${v.codePostal}`}
                          type="button"
                          onClick={() => {
                            ajouterCommuneSuggeree(conseillerId, v);
                            setCommunesVoisines((prev) => ({ ...prev, [conseillerId]: (prev[conseillerId] ?? []).filter((x) => x.nom !== v.nom) }));
                          }}
                          className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-muted hover:bg-muted/70 text-muted-foreground"
                        >
                          + {v.nom}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="relative shrink-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={filtreGererCommunes}
                      onChange={(e) => setFiltreGererCommunes(e.target.value)}
                      placeholder="Filtrer la liste..."
                      className="h-9 pl-8 text-sm"
                    />
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border p-2">
                    {listeFiltree.length === 0 && (
                      <p className="text-xs text-muted-foreground p-4 text-center">
                        {liste.length === 0 ? "Aucune commune pour l'instant." : "Aucune commune ne correspond à ce filtre."}
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {listeFiltree.map((entree) => {
                      const info = centroides[entree];
                      return (
                        <div key={entree} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/40">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{entree}</p>
                            {info?.postcode && <p className="text-[11px] text-muted-foreground">{info.postcode}</p>}
                          </div>
                          <Button size="sm" variant="ghost" className="text-destructive shrink-0" onClick={() => retirer(entree)}>
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Retirer
                          </Button>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                  {/* Choix de couleur — déplacé ici depuis le panneau
                      latéral, demande explicite : « ajoute les couleurs
                      comme ça on les supprime dans l'autre interface, ajoute
                      des couleurs un peu plus foncées ». */}
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    {COULEURS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={validationEnCours === conseillerId}
                        onClick={() => setCouleurEnEdition((prev) => ({ ...prev, [conseillerId]: c }))}
                        className={`w-5 h-5 rounded-full border-2 ${couleurActuelle === c ? "border-foreground" : "border-transparent"}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 shrink-0">
                    <p className="text-[11px] text-muted-foreground">
                      {liste.length} commune{liste.length > 1 ? "s" : ""} au total
                    </p>
                    <Button
                      size="sm"
                      disabled={validationEnCours === conseillerId}
                      onClick={async () => {
                        await validerEtEnregistrerSecteur(conseillerId, liste, couleurActuelle);
                        // Demande explicite : « quand on clic sur
                        // enregistrer cela ferme le pop up »
                        setGererOuvertPour(null);
                      }}
                    >
                      {validationEnCours === conseillerId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Enregistrer"}
                    </Button>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
