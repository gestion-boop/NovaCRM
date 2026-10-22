import { getAuthedUser, resolvePublicOrigin, supabaseAdmin } from '../_supabaseAdmin.js';

/**
 * POST /api/ai/agent — Assistant IA NovaSphere, propulsé par Claude
 * (Anthropic) plutôt que Gemini. Même contrat d'entrée/sortie que la
 * version Gemini précédente ({ text, functionCalls }), pour que
 * AssistantIAView.tsx n'ait rien à changer côté client — seul le moteur
 * change, et son exécution des actions (créer un contact/tâche/note/RDV)
 * reste entièrement côté client via les hooks existants.
 */

// Ticket "Paramètres/Nova/Utilisateurs/Annonces" (2/16) : droit
// "nova_super_assistant" — réservé exclusivement au compte de Sylvain
// Grazia, identifié par son UUID Supabase (jamais son nom affiché, qui
// pourrait changer ou être usurpé par un profil mal renseigné). Fondation
// pure ici : calcule le droit et l'expose au system prompt, mais aucune
// action n'est encore réservée derrière (viendra avec les capacités
// étendues du ticket #161). Même UUID que SYLVAIN_USER_ID dans
// send-system-email/upload-client-document (compte système unique).
const NOVA_SUPER_ASSISTANT_USER_ID = '4f6eea64-ce42-40ff-b0cd-bbd68cb5ca29';

async function resolveIsNovaSuperAssistant(req: any): Promise<boolean> {
  try {
    const user = await getAuthedUser(req);
    return user.id === NOVA_SUPER_ASSISTANT_USER_ID;
  } catch {
    // Pas de jeton (ou invalide) : traité comme non-privilégié, jamais
    // bloquant pour l'usage normal de Nova par le reste de l'équipe.
    return false;
  }
}

const TOOLS = [
  {
    name: 'create_contact',
    description: 'Créer un contact (lead/client) dans le CRM.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nom complet du contact.' },
        email: { type: 'string', description: "Email du contact, si fourni." },
        phone: { type: 'string', description: 'Téléphone du contact, si fourni.' },
        clientType: {
          type: 'string',
          enum: ['buyer', 'seller', 'investor', 'other'],
          description: "Type de client : buyer (acheteur), seller (vendeur), investor (investisseur), other.",
        },
        notes: { type: 'string', description: 'Notes ou informations complémentaires, si fournies.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_task',
    description: "Créer une tâche/rappel dans le CRM. Calcule dueDate toi-même à partir de la date du jour donnée dans le system prompt (ex: \"demain\", \"dans 3 jours\").",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre de la tâche.' },
        dueDate: { type: 'string', description: "Date d'échéance au format AAAA-MM-JJ. Calcule-la à partir de la date du jour si l'utilisateur donne une date relative (demain, dans 3 jours...)." },
        priority: {
          type: 'string',
          enum: ['Basse', 'Moyenne', 'Haute', 'Urgent'],
          description: 'Priorité de la tâche.',
        },
        type: {
          type: 'string',
          enum: ['Appel', 'Rendez-vous', 'Relance', 'Document', 'Tâche'],
          description: 'Type de tâche.',
        },
        contactId: {
          type: 'string',
          description: "Identifiant (uuid) du contact concerné, si la tâche porte sur un client précis. Choisis-le dans la liste \"Contacts existants\" du system prompt en retrouvant le nom cité par l'utilisateur — n'invente jamais un identifiant, laisse ce champ vide si le contact n'est pas dans la liste.",
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_note',
    description: "Créer une note. Si elle concerne un client précis, renseigne contactId pour qu'elle apparaisse sur sa fiche.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        contactId: {
          type: 'string',
          description: "Identifiant (uuid) du contact concerné, si la note porte sur un client précis. Choisis-le dans la liste \"Contacts existants\" du system prompt en retrouvant le nom cité par l'utilisateur — n'invente jamais un identifiant, laisse ce champ vide si le contact n'est pas dans la liste.",
        },
      },
      required: ['title', 'content'],
    },
  },
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16 et 14/16) :
  // "recherche/désambiguïsation du client, date/heure/durée/type/lieu/
  // participants, résumé avant validation, synchronisation Google Agenda si
  // activée, envoi optionnel d'une confirmation au client". Contrairement à
  // create_task/create_note/create_contact (exécutés immédiatement), ce
  // rendez-vous ne s'exécute JAMAIS sans confirmation manuelle explicite —
  // même mécanisme que invite_client_guest (voir CALENDAR_TOOLS,
  // AssistantIAView.tsx).
  {
    name: 'create_appointment',
    description: "Prépare un rendez-vous (jamais créé immédiatement — l'utilisateur confirme toujours dans une carte dédiée). Calcule date/time comme pour create_task à partir de la date du jour donnée dans le system prompt.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre du rendez-vous.' },
        date: { type: 'string', description: "Date au format AAAA-MM-JJ, calculée à partir de la date du jour si relative (\"demain\", \"vendredi prochain\"...)." },
        time: { type: 'string', description: 'Heure de début au format HH:MM (24h). 09:00 par défaut si non précisé.' },
        durationMinutes: { type: 'number', description: 'Durée en minutes (30 par défaut si non précisé).' },
        location: { type: 'string', description: 'Lieu du rendez-vous, si précisé.' },
        type: {
          type: 'string',
          enum: ['Rendez-vous Banque', 'Visite Immobilière', 'Signature Notaire', 'Réunion Agence', 'Tâche', 'Réservation Caméra'],
          description: 'Type de rendez-vous — choisis le plus adapté au contexte.',
        },
        contactId: {
          type: 'string',
          description: "Identifiant (uuid) du client concerné, choisi dans la liste \"Contacts existants\" — n'invente jamais un identifiant, laisse vide si le client n'est pas dans la liste (utilise alors clientName).",
        },
        clientName: { type: 'string', description: "Nom du client si aucun contactId ne correspond (client non trouvé dans le CRM, ou rendez-vous interne sans client)." },
        attendees: { type: 'string', description: "Adresses e-mail des participants à inviter, séparées par des virgules, si précisées." },
        sendClientConfirmation: { type: 'boolean', description: "true si l'utilisateur veut explicitement qu'une confirmation soit envoyée au client par e-mail (jamais par défaut — uniquement si demandé)." },
      },
      required: ['title', 'date'],
    },
  },
  // Demande explicite : "Nova puisse avoir la possibilité de créer à la
  // demande de l'utilisateur des tickets Support, il devra déterminer
  // l'urgence et dire ce qui se passe afin qu'il puisse reformuler
  // correctement" — jamais créé immédiatement (même mécanisme de
  // confirmation manuelle que create_appointment, voir CALENDAR_TOOLS
  // côté client) : Nova reformule proprement le problème, propose une
  // priorité, l'utilisateur valide avant tout envoi aux admins.
  {
    name: 'create_support_ticket',
    description: "Prépare un ticket Support à destination des administrateurs du CRM (jamais créé immédiatement — l'utilisateur confirme toujours dans une carte dédiée). Utilise cet outil dès que l'utilisateur signale un problème, un bug, un blocage, ou demande explicitement de créer un ticket support/de contacter le support.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "Titre court et clair du ticket (quelques mots), reformulé proprement à partir de ce que l'utilisateur a décrit — jamais une simple recopie brute de ses mots si mal formulés." },
        description: { type: 'string', description: "Description complète et claire du problème, en français correct et professionnel : ce qui se passe, où (quel écran/quelle fonctionnalité), depuis quand si précisé. Reformule fidèlement sans rien inventer ni omettre." },
        category: {
          type: 'string',
          enum: ['bug', 'technique', 'fonctionnalite', 'autre'],
          description: "bug = quelque chose ne fonctionne pas comme prévu ; technique = problème d'accès/connexion/performance ; fonctionnalite = demande d'amélioration ou de nouvelle fonctionnalité ; autre = si aucune catégorie ne convient.",
        },
        priority: {
          type: 'string',
          enum: ['basse', 'normale', 'urgente'],
          description: "Détermine toi-même l'urgence à partir du contexte : basse (mineur, gêne sans bloquer) — normale (important, à traiter rapidement mais pas bloquant) — urgente (majeur, bloque le travail ou affecte un client).",
        },
      },
      required: ['title', 'description', 'category', 'priority'],
    },
  },
  // Ticket #251 : "envoie un mail à Dupont pour lui demander ses
  // justificatifs" — jamais un envoi direct (même mécanisme de confirmation
  // manuelle que create_appointment/create_support_ticket, voir EMAIL_TOOLS
  // côté client). Nova ne renseigne jamais l'adresse elle-même : le client
  // (contactId) est résolu ici, mais c'est TOUJOURS la vraie adresse
  // enregistrée sur sa fiche qui sera utilisée à l'affichage — jamais une
  // adresse inventée par le modèle.
  {
    name: 'send_client_email',
    description: "Prépare un e-mail à destination d'un client déjà présent dans le CRM (jamais créé/envoyé immédiatement — l'utilisateur confirme toujours dans une carte dédiée, avec possibilité de modifier avant envoi). Identifie le client à partir du nom cité, de la fiche actuellement ouverte (voir contexte \"Client actuellement affiché\"), ou de la conversation en cours. Si PLUSIEURS contacts correspondent au nom donné, NE CHOISIS JAMAIS au hasard — pose une question pour demander lequel. N'invente JAMAIS d'adresse e-mail : contactId doit venir exactement de la liste \"Contacts existants\", jamais un id halluciné.",
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: "Identifiant (uuid) du client, choisi dans la liste \"Contacts existants\" — obligatoire dès qu'un client précis a pu être identifié sans ambiguïté (y compris via la fiche actuellement ouverte)." },
        clientName: { type: 'string', description: "Nom du client tel que cité par l'utilisateur ou déduit du contexte, pour affichage même si contactId est vide (aucun contact correspondant trouvé)." },
        subject: { type: 'string', description: "Objet de l'e-mail, reformulé proprement et professionnellement à partir de la demande." },
        body: { type: 'string', description: "Corps de l'e-mail, reformulé dans un français clair et professionnel à partir de la demande — jamais un simple copier-coller de mots mal formulés. Ne pas ajouter de formule de politesse finale ni de nom : la signature de l'utilisateur est ajoutée automatiquement en dessous." },
      },
      required: ['subject', 'body'],
    },
  },
  {
    name: 'get_daily_summary',
    description: "Bilan d'UNE journée précise (tâches ET rendez-vous de ce jour-là — aujourd'hui par défaut, mais aussi n'importe quel autre jour : \"lundi\", \"lundi prochain\", \"demain\", \"le 3 septembre\"...). Utilise le paramètre scope pour répondre à une demande ciblée — ex: \"quelles sont mes tâches aujourd'hui ?\" -> scope='tasks' (ne donne QUE les tâches) ; \"quels sont mes rendez-vous de lundi ?\" -> scope='appointments', date=le lundi calculé ; \"donne-moi toute la journée de lundi, tâches et rendez-vous\" -> scope='both', date=le lundi calculé.",
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['both', 'tasks', 'appointments'],
          description: "Ce que l'utilisateur a réellement demandé : 'tasks' pour seulement les tâches, 'appointments' pour seulement les rendez-vous, 'both' pour un bilan complet (défaut).",
        },
        date: {
          type: 'string',
          description: "Date du jour demandé, au format YYYY-MM-DD. Calcule-la toi-même à partir de la date actuelle donnée plus bas dans ce prompt (ex: \"lundi prochain\", \"demain\", \"vendredi\") — ne redemande jamais cette date à l'utilisateur. Omets ce paramètre pour aujourd'hui (comportement par défaut).",
        },
      },
    },
  },
  {
    name: 'get_upcoming_brief',
    description: "Résumé des prochains éléments (7 jours). Même logique de scope que get_daily_summary — ex: \"quelles sont mes prochaines tâches ?\" -> scope='tasks' ; \"quels sont mes prochains rendez-vous ?\" -> scope='appointments'.",
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['both', 'tasks', 'appointments'],
          description: "Ce que l'utilisateur a réellement demandé : 'tasks' pour seulement les tâches, 'appointments' pour seulement les rendez-vous, 'both' pour les deux (défaut).",
        },
      },
    },
  },
  {
    // Demande explicite (30/08/2026, signalé) : "il me dit qu'il n'a pas
    // accès aux tâches... quand je demande quelles sont les tâches en
    // cours" — vrai trou, pas une limitation halluciné : get_daily_summary
    // ne couvre qu'UN jour précis, get_upcoming_brief seulement les 7
    // prochains jours — aucun des deux ne couvre les tâches déjà en retard
    // (échéance dans le passé), quelle que soit son ancienneté.
    name: 'get_overdue_tasks',
    description: "Liste TOUTES les tâches non terminées dont l'échéance est déjà passée (peu importe depuis quand), toutes dates confondues — pas limité à aujourd'hui ni aux 7 prochains jours. Utilise cet outil pour \"quelles sont mes tâches en retard ?\", \"mes tâches en cours\", \"qu'est-ce que j'ai en attente\", ou toute question sur des tâches en souffrance sans jour précisé.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  // Demande explicite (28/08/2026) : "Nova + statistiques" — répond
  // directement à des questions comme "combien de dossiers Isabelle a en
  // Compromis ?" sans passer par la tuile Statistiques. Même source de
  // données que StatistiquesEtiquettesView.tsx (pipeline Transactions V2,
  // agence ImmoSphera), calculée côté client (AssistantIAView.tsx) — aucun
  // aller-retour serveur supplémentaire nécessaire.
  // Demande explicite (28/08/2026) : "Nova + pipeline" — faire avancer un
  // dossier par une simple phrase ("fais passer le dossier Cachot en
  // Compromis"), sans ouvrir le pipeline. Résolu par NOM (pas d'id à choisir
  // dans une liste, contrairement aux contacts) — voir executeFunctionCall
  // dans AssistantIAView.tsx, qui recherche le dossier dans TOUS les deals
  // déjà chargés côté client (jamais limité aux 15 envoyés au modèle).
  {
    name: 'move_lead_stage',
    description: "Fait avancer (ou reculer) un dossier/lead vers une autre étape du pipeline commercial. Utilise cet outil dès que l'utilisateur demande de changer l'étape/le statut d'un dossier client précis (ex: \"passe le dossier Dupont en Compromis\", \"le dossier Martin est signé\").",
    input_schema: {
      type: 'object',
      properties: {
        leadName: { type: 'string', description: "Nom (ou fragment de nom) du client/dossier concerné, tel que cité par l'utilisateur — jamais un identifiant, la résolution se fait par nom." },
        stageName: { type: 'string', description: "Nom de l'étape cible du pipeline, tel que cité par l'utilisateur (ex: \"Compromis\", \"Offre d'achat\", \"Signature\") — pas besoin de l'orthographe exacte de l'étape en base, une correspondance approximative suffit." },
      },
      required: ['leadName', 'stageName'],
    },
  },
  // Demande explicite : Nova sait déjà créer une tâche (create_task) mais
  // pas en modifier une existante (reporter, marquer faite, changer sa
  // priorité...) — même principe de résolution par NOM que move_lead_stage
  // ci-dessus : Nova ne connaît jamais l'identifiant d'une tâche, seulement
  // son titre tel que cité par l'utilisateur. Exécuté côté client
  // (AssistantIAView.tsx), qui recherche parmi les tâches déjà chargées.
  {
    name: 'update_task',
    description: "Modifie une tâche/rappel déjà existant : reporter son échéance, la marquer faite/à faire, changer sa priorité ou son type, la renommer. Utilise cet outil dès que l'utilisateur parle d'une tâche qui existe déjà (\"déplace la tâche relance Dupont à vendredi\", \"marque comme faite la tâche d'appel de Martin\") — jamais pour en créer une nouvelle (create_task).",
    input_schema: {
      type: 'object',
      properties: {
        taskName: { type: 'string', description: "Nom (ou fragment de titre) de la tâche à modifier, tel que cité par l'utilisateur — jamais un identifiant, la résolution se fait par nom." },
        newDueDate: { type: 'string', description: "Nouvelle date d'échéance au format AAAA-MM-JJ, si l'utilisateur demande de reporter/avancer la tâche. Calcule-la à partir de la date du jour si elle est donnée de façon relative (demain, vendredi prochain...)." },
        completed: { type: 'boolean', description: "true pour marquer la tâche comme faite, false pour la remettre à faire." },
        priority: {
          type: 'string',
          enum: ['Basse', 'Moyenne', 'Haute', 'Urgent'],
          description: 'Nouvelle priorité de la tâche, si demandée.',
        },
        type: {
          type: 'string',
          enum: ['Appel', 'Rendez-vous', 'Relance', 'Document', 'Tâche'],
          description: 'Nouveau type de tâche, si demandé.',
        },
        newTitle: { type: 'string', description: 'Nouveau titre de la tâche, si un renommage est demandé.' },
      },
      required: ['taskName'],
    },
  },
  {
    name: 'get_pipeline_stats',
    description: "Statistiques en direct du pipeline Transactions V2 d'ImmoSphera : nombre de dossiers par agent et par étape (Offre d'achat, Compromis, Signature). Utilise cet outil pour toute question sur le nombre de dossiers, la répartition par agent, ou l'avancement du pipeline commercial ImmoSphera.",
    input_schema: {
      type: 'object',
      properties: {
        agentName: {
          type: 'string',
          description: "Optionnel : ne renvoyer que les statistiques d'un agent précis, cité par son nom (ex. \"Isabelle\"). Laisser vide pour la vue de tous les agents.",
        },
      },
    },
  },
  // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (13/16) : recherche dans
  // le Google Drive du compte CONNECTÉ (jamais un accès élargi/serveur) —
  // exécuté côté client (AssistantIAView.tsx) avec le jeton OAuth déjà en
  // cache, ce qui garantit mécaniquement le respect des permissions Google
  // déjà existantes (l'API ne renvoie jamais un fichier hors de portée de
  // ce compte). Disponible pour toute l'équipe, pas réservé à
  // nova_super_assistant : une recherche est une action sans risque.
  {
    name: 'search_drive_documents',
    description: "Recherche des documents dans le GOOGLE DRIVE du compte actuellement connecté (par nom, type de fichier, ou les plus récents). N'utilise cet outil que si l'utilisateur mentionne Google Drive, ou ne précise pas de service particulier — utilise search_kdrive_documents à la place s'il mentionne explicitement kDrive/Infomaniak.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Mots-clés à chercher dans le nom du document. Laisse vide si l'utilisateur demande juste les documents récents." },
        mimeType: {
          type: 'string',
          enum: ['document', 'spreadsheet', 'presentation', 'pdf', 'image', 'folder', 'any'],
          description: 'Type de fichier recherché, si précisé (document = Google Docs, spreadsheet = Google Sheets...).',
        },
        recent: { type: 'boolean', description: "true si l'utilisateur veut voir ses documents récents plutôt que chercher par mot-clé (ex: \"mes derniers documents\", \"qu'est-ce que j'ai modifié récemment\")." },
      },
    },
  },
  // Ticket #267 : "serais-tu capable de chercher des documents ou autres
  // dans kDrive aussi ?" — pendant kDrive (Infomaniak) de
  // search_drive_documents, exécuté CÔTÉ SERVEUR (contrairement à son
  // équivalent Google) car le jeton kDrive est stocké côté serveur
  // (user_kdrive_tokens), jamais transmis au navigateur.
  {
    name: 'search_kdrive_documents',
    description: "Recherche des documents dans le KDRIVE (Infomaniak) du compte actuellement connecté. N'utilise cet outil que si l'utilisateur mentionne explicitement kDrive ou Infomaniak — utilise search_drive_documents pour Google Drive ou une demande générique.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Mots-clés à chercher dans le nom du document. Laisse vide si l'utilisateur demande juste les documents récents." },
      },
    },
  },
  // Connecte Nova IA au catalogue Immosphera360 : recherche de biens
  // immobiliers réels (base `immosphera_properties`), pas une invention du
  // modèle. Les résultats sont affichés en vignettes (photo + descriptif)
  // côté client — voir AssistantIAView.tsx.
  {
    name: 'search_properties',
    description: "Recherche des biens immobiliers réels dans le catalogue Immosphera360 (ventes et locations). Utilise cet outil dès que l'utilisateur demande de trouver/voir des biens, une maison, un appartement, une villa, etc. Renseigne TOUS les critères mentionnés par l'utilisateur, aussi précisément que possible (type de bien, budget, surface, pièces, chambres, DPE, terrasse, piscine, localisation...) — un filtre incomplet renvoie des biens hors-critères, ce qui n'est pas acceptable pour une recherche digne d'une agence immobilière.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Mots-clés libres (ville, quartier, secteur, OU numéro de mandat) à chercher dans le titre/l'adresse/la localisation/le numéro de mandat. Ne pas y mettre le type de bien, le prix, la surface etc. — utilise les champs dédiés ci-dessous pour ça, sinon ils ne filtrent pas correctement." },
        listingType: { type: 'string', enum: ['vente', 'location'], description: 'Type d\'annonce, si précisé.' },
        propertyType: {
          type: 'string',
          enum: ['maison', 'appartement', 'terrain', 'professionnel', 'autre'],
          description: 'Type de bien, si précisé ("une maison", "un appartement", "un local"...).',
        },
        minPrice: { type: 'number', description: "Prix minimum, si l'utilisateur donne une fourchette de prix (ex: \"entre 250 000 et 270 000 €\" → minPrice=250000). Ne pas oublier ce champ dès qu'une fourchette est demandée, sinon des biens moins chers que la borne basse remontent à tort." },
        maxPrice: { type: 'number', description: 'Prix maximum, si précisé.' },
        minSurface: { type: 'number', description: 'Surface habitable minimum en m², si précisée.' },
        maxSurface: { type: 'number', description: 'Surface habitable maximum en m², si précisée.' },
        minRooms: { type: 'number', description: 'Nombre de pièces minimum, si précisé (distinct des chambres).' },
        minBedrooms: { type: 'number', description: 'Nombre de chambres minimum, si précisé.' },
        terrace: { type: 'boolean', description: 'true si l\'utilisateur veut explicitement une terrasse.' },
        pool: { type: 'boolean', description: 'true si l\'utilisateur veut explicitement une piscine.' },
        maxDpe: {
          type: 'string',
          enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
          description: 'Classe DPE la moins bonne acceptée (ex: "DPE D minimum" ou "pas trop énergivore, D max" → maxDpe="D" — accepte A à D, exclut E/F/G). Ne mettre que si l\'utilisateur parle d\'énergie/DPE/consommation.',
        },
      },
    },
  },
  // Ticket #250 : génération d'image à la demande, dans le style des
  // pancartes/expressions Nova déjà en place (voir AnnouncementBanner.tsx),
  // avec le logo de l'agence active intégré automatiquement. Exécuté côté
  // serveur (comme search_properties) : nécessite GEMINI_API_KEY, jamais
  // exposée au client.
  {
    name: 'generate_image',
    description: "Génère une image dans le style visuel NovaSphere (mascotte Nova + pancarte), intégrant automatiquement le logo de l'agence active. Utilise cet outil dès qu'on te demande de créer/générer une image ou un visuel (ex: \"j'ai signé un acte, crée une image\", \"crée une image de succès\", \"fais un visuel réponse demandée\"). Si la demande est trop vague pour choisir un style (aucun des 9 ci-dessous ne correspond clairement), repose une question au lieu d'appeler cet outil au hasard.",
    input_schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['info', 'a_verifier', 'important', 'succes', 'veille', 'reponse_demandee', 'signature_compromis', 'signature_acte', 'sondage'],
          description: "Style/thème demandé : info = information courante (or), a_verifier = à vérifier (ambre), important = urgent (rouge), succes = offre d'achat validée (vert), veille = suivi calme (bleu), reponse_demandee = réponse attendue (rouge), signature_compromis = signature d'un compromis (or, mascotte dédiée), signature_acte = signature d'un acte authentique (or, mascotte dédiée), sondage = question à l'équipe (or).",
        },
        details: { type: 'string', description: "Précisions libres de l'utilisateur à refléter dans l'image (ex: nom du dossier, occasion précise), si mentionnées. Ne jamais inventer de détail non dit." },
      },
      required: ['intent'],
    },
  },
  // Ticket #26 (nouvelle base) : Nova IA n'avait strictement aucune capacité
  // de recherche — outil serveur natif de l'API Anthropic (recherche web
  // réelle, pas une invention du modèle), pour la rendre aussi ouverte que
  // ChatGPT sur les demandes d'information générale.
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 3,
  },
  // Ticket "Clients invités" (13/13) : Nova IA pilote le portail "Espace
  // client" — jamais exécuté directement (voir la confirmation manuelle
  // obligatoire côté AssistantIAView.tsx), contrairement aux autres outils
  // ci-dessus qui s'exécutent immédiatement.
  {
    name: 'invite_client_guest',
    description: "Invite un client déjà présent dans le CRM dans son \"Espace client\" (accès mobile où il échange avec son conseiller et envoie des documents). N'invente JAMAIS de contactId — uniquement un contact de la liste \"Contacts existants\". Ne crée jamais de nouvelle fiche à cette occasion : si le client n'existe pas dans le CRM, dis-le et propose de créer sa fiche d'abord (create_contact), jamais l'inverse dans le même appel.",
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: "Identifiant (uuid) du contact à inviter, choisi dans la liste \"Contacts existants\"." },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'request_client_document',
    description: "Demande un document à un client déjà invité dans son Espace client.",
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: "Identifiant (uuid) du contact, choisi dans la liste \"Contacts existants\"." },
        docType: {
          type: 'string',
          enum: ["Pièce d'identité", 'Justificatif de domicile', 'Relevé bancaire', 'Bulletin de salaire', "Avis d'imposition", 'Compromis', 'Document bancaire', 'Autre'],
          description: 'Type de document demandé.',
        },
        deadline: { type: 'string', description: "Date limite au format AAAA-MM-JJ, si l'utilisateur en donne une (calcule-la comme pour create_task)." },
        message: { type: 'string', description: 'Message pour le client, si précisé.' },
      },
      required: ['contactId', 'docType'],
    },
  },
  {
    name: 'set_client_guest_access_status',
    description: "Suspend, réactive ou révoque l'accès Espace client d'un client déjà invité.",
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: "Identifiant (uuid) du contact, choisi dans la liste \"Contacts existants\"." },
        action: { type: 'string', enum: ['suspend', 'reactivate', 'revoke'], description: 'suspend = suspendre temporairement, reactivate = réactiver, revoke = révoquer définitivement (coupe uniquement la connexion, la fiche et son historique restent intacts).' },
      },
      required: ['contactId', 'action'],
    },
  },
];

// Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16) : capacités
// étendues (inviter/désactiver un collaborateur, automatisations, annonces)
// — réservées au droit "nova_super_assistant" (ticket #151), donc même pas
// PROPOSÉES à Claude pour le reste de l'équipe (outils absents de leur
// liste, plutôt qu'un simple refus après coup). Toutes exigent une
// confirmation manuelle côté client (voir NOVA_ADMIN_TOOLS,
// AssistantIAView.tsx) et sont journalisées après exécution réelle
// (nova_action_log, migration 20260826210000).
const NOVA_ADMIN_TOOLS = [
  {
    name: 'invite_collaborator',
    description: "Invite un NOUVEAU collaborateur (membre de l'équipe, pas un client) dans NovaSphere par e-mail. N'utilise JAMAIS cet outil pour un client — voir invite_client_guest pour ça.",
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Adresse e-mail du collaborateur.' },
        fullName: { type: 'string', description: 'Nom complet, si connu.' },
        role: { type: 'string', enum: ['commercial', 'intern', 'super_admin'], description: 'Rôle attribué (commercial par défaut si non précisé).' },
        agencyIds: { type: 'array', items: { type: 'string' }, description: "Identifiants des agences autorisées, si précisées par l'utilisateur." },
      },
      required: ['email'],
    },
  },
  {
    name: 'set_collaborator_active_status',
    description: "Active ou désactive l'accès CRM d'un collaborateur déjà existant (jamais un client — voir set_client_guest_access_status pour ça). N'invente jamais d'identifiant : utilise uniquement un id présent dans la liste \"Collaborateurs\" du system prompt.",
    input_schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Identifiant (uuid) du collaborateur, choisi dans la liste "Collaborateurs".' },
        isActive: { type: 'boolean', description: 'true pour réactiver, false pour désactiver.' },
      },
      required: ['userId', 'isActive'],
    },
  },
  {
    name: 'create_pipeline_automation',
    description: "Crée une automatisation de pipeline pour une société donnée : quand un client atteint une étape précise, Nova proposera plus tard de préparer un e-mail (jamais d'envoi automatique/silencieux).",
    input_schema: {
      type: 'object',
      properties: {
        agencyId: { type: 'string', description: "Identifiant de la société (Conseils Finances, ImmoSphera, NovaVisio...), à déduire du contexte (agence active) si l'utilisateur ne la précise pas." },
        stageName: { type: 'string', description: "Nom de l'étape du pipeline qui déclenche l'automatisation." },
        emailSubject: { type: 'string', description: "Sujet de l'e-mail à préparer." },
        emailBody: { type: 'string', description: "Corps de l'e-mail à préparer (peut contenir des variables comme {{prenom}})." },
      },
      required: ['agencyId', 'stageName', 'emailSubject', 'emailBody'],
    },
  },
  {
    name: 'create_announcement',
    description: "Publie une annonce visible par l'équipe (bandeau + mascotte Nova). Choisis toujours le niveau le plus adapté au contenu réel du message — jamais 'important' par défaut.",
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: "Contenu de l'annonce." },
        level: { type: 'string', enum: ['info', 'a_verifier', 'important', 'succes', 'veille', 'reponse_demandee', 'signature_compromis', 'signature_acte'], description: "info = or (information courante), a_verifier = ambre (à vérifier/attention), important = rouge (lecture obligatoire, aucun moyen de fermer sans confirmer), succes = vert (offre d'achat validée), veille = bleu (suivi calme, rien d'urgent), reponse_demandee = rouge (une réponse du destinataire est explicitement attendue), signature_compromis = or (signature d'un compromis, feu d'artifice), signature_acte = or (signature d'un acte authentique, feu d'artifice)." },
        agencyIds: { type: 'array', items: { type: 'string' }, description: "Sociétés ciblées ; vide ou absent = toutes les agences." },
        // Demande explicite (28/08/2026) : "ça pourra aussi travailler sur
        // un sondage — qui vient à la plage samedi prochain, présent/absent
        // — et ça crée le sondage." Le sondage lui-même (options, votes,
        // affichage) existe déjà côté annonces (announcement_poll_options,
        // AnnouncementBanner.tsx) — seule l'entrée par Nova manquait.
        pollOptions: {
          type: 'array',
          items: { type: 'string' },
          description: "Optionnel : transforme l'annonce en sondage avec ces options de réponse (2 à 4, ex. [\"Présent\", \"Absent\"]) — uniquement si l'utilisateur demande explicitement un sondage/une question à réponses (ex. \"qui vient... présent/absent ?\"). Laisser vide pour une annonce simple.",
        },
      },
      required: ['message', 'level'],
    },
  },
];

// Exécute la recherche de biens Immosphera360 (base réelle, pas une
// invention du modèle) et retourne une sélection compacte pour Claude ET
// pour l'affichage en vignettes côté client.
async function runPropertySearch(args: any) {
  const { supabaseAdmin } = await import('../_supabaseAdmin.js');
  let q = supabaseAdmin
    .from('immosphera_properties')
    .select('id, title, description, address, location, price, surface_area, rooms, bedrooms, property_type, listing_type, images, listing_url, tech_details')
    // Biens masqués (hidden_at) : exclus de la recherche IA, comme de la
    // grille classique — restent en base pour être réactivés plus tard.
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    // 8 était trop bas — une ville avec 15 biens réels n'en montrait que 8
    // au mieux (souvent moins, une fois les faux positifs de `description`
    // retirés ci-dessous) alors que la recherche manuelle les montre tous.
    .limit(24);

  // Bug trouvé en test réel : la base stocke listing_type en anglais
  // ("sale"/"rental"), alors que l'outil (et Claude) raisonnent en français
  // ("vente"/"location") — la correspondance "location" → "rent" (au lieu
  // de "rental") ne matchait jamais rien, 0 résultat systématique dès que
  // quelqu'un cherchait une location.
  if (args?.listingType) {
    const listingTypeMap: Record<string, string> = { vente: 'sale', location: 'rental' };
    q = q.eq('listing_type', listingTypeMap[args.listingType] || args.listingType);
  }
  // Demande explicite : un filtre "digne des plus grandes agences" —
  // prendre en compte tout ce qui figure sur une fiche de bien, pas
  // seulement le prix/les chambres.
  if (args?.propertyType) {
    const propertyTypeMap: Record<string, string> = {
      maison: 'house',
      appartement: 'apartment',
      terrain: 'land',
      professionnel: 'commercial',
      autre: 'other',
    };
    q = q.eq('property_type', propertyTypeMap[args.propertyType] || args.propertyType);
  }
  // Bug trouvé en test réel : "entre 250 000 et 270 000 €" ne filtrait que
  // sur la borne haute (maxPrice) — la borne basse n'existait pas du tout
  // dans l'outil, donc des biens bien moins chers (ex: 160 000 €) passaient
  // le filtre sans problème.
  if (typeof args?.minPrice === 'number') q = q.gte('price', args.minPrice);
  if (typeof args?.maxPrice === 'number') q = q.lte('price', args.maxPrice);
  if (typeof args?.minSurface === 'number') q = q.gte('surface_area', args.minSurface);
  if (typeof args?.maxSurface === 'number') q = q.lte('surface_area', args.maxSurface);
  if (typeof args?.minRooms === 'number') q = q.gte('rooms', args.minRooms);
  if (typeof args?.minBedrooms === 'number') q = q.gte('bedrooms', args.minBedrooms);
  // Terrasse/piscine/DPE sont stockés dans tech_details (jsonb), pas des
  // colonnes dédiées — filtrage via le chemin JSON directement en base.
  if (args?.terrace === true) q = q.eq('tech_details->>terrace', 'Oui');
  if (args?.pool === true) q = q.in('tech_details->>pool', ['Oui', 'Possible']);
  if (args?.maxDpe && typeof args.maxDpe === 'string') {
    q = q.lte('tech_details->>dpe', args.maxDpe.toUpperCase());
  }
  if (args?.query) {
    const term = String(args.query).trim();
    // Signalé : "quand je tape Narbonne j'ai tous les biens, mais l'IA n'en
    // propose que 3" — cause trouvée, matcher aussi sur `description`
    // remontait des biens qui ne sont PAS à Narbonne mais qui la MENTIONNENT
    // juste en passant ("à 20 minutes de Narbonne, 25 de Béziers..."),
    // polluant les résultats de faux positifs. La recherche manuelle (barre
    // de recherche classique) ne matche elle que titre/adresse/localisation
    // — aligné ici sur exactement les mêmes champs pour un matching des
    // villes qui corresponde vraiment aux biens, cohérent entre les deux.
    // Ajouté (15 septembre, demande explicite) : mandate_number, pour
    // qu'un numéro de mandat tapé dans la barre retrouve le bien — même
    // alignement avec la recherche manuelle, voir usePropertyFilters.ts.
    if (term) q = q.or(`title.ilike.%${term}%,address.ilike.%${term}%,location.ilike.%${term}%,mandate_number.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) return { properties: [] as any[], error: error.message };

  // Description/images complètes pour la fiche détail affichée côté client
  // (ticket #61) — une version tronquée et sans galerie est envoyée à part
  // à Claude (voir tool_result plus bas), pour ne pas gonfler les tokens.
  const properties = (data || []).map((p: any) => {
    const td = (p.tech_details || {}) as Record<string, string>;
    return {
      id: p.id,
      title: p.title,
      description: p.description || '',
      address: p.address,
      price: p.price,
      surfaceArea: p.surface_area,
      rooms: p.rooms,
      bedrooms: p.bedrooms,
      propertyType: p.property_type,
      listingType: p.listing_type,
      dpe: td.dpe || null,
      ges: td.ges || null,
      terrace: td.terrace === 'Oui',
      pool: td.pool === 'Oui' || td.pool === 'Possible',
      image: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null,
      images: Array.isArray(p.images) ? p.images : [],
      listingUrl: p.listing_url,
    };
  });

  return { properties };
}

// Ticket #250 : style associé à chaque intent, aligné sur LEVEL_META côté
// client (AnnouncementBanner.tsx) — même vocabulaire, mêmes mascottes, pour
// qu'une image générée par Nova ressemble vraiment aux pancartes déjà en
// place plutôt que de repartir de zéro à chaque fois.
const IMAGE_INTENT_META: Record<string, { label: string; mascotte: string; colorHint: string }> = {
  info: { label: 'Information', mascotte: 'nova-neutre.png', colorHint: 'doré/or NovaSphere, sobre et professionnel' },
  a_verifier: { label: 'À vérifier', mascotte: 'nova-attention.png', colorHint: 'ambre/orange, incite à la prudence' },
  important: { label: 'Important', mascotte: 'nova-erreur.png', colorHint: 'rouge, urgence, lecture obligatoire' },
  succes: { label: "Offre d'achat validée", mascotte: 'nova-succes.png', colorHint: 'vert émeraude, bonne nouvelle, célébration' },
  veille: { label: 'Veille', mascotte: 'nova-veille.png', colorHint: 'bleu calme, suivi tranquille' },
  reponse_demandee: { label: 'Réponse demandée SVP', mascotte: 'nova-erreur.png', colorHint: 'rose/rouge vif, une réponse est attendue' },
  signature_compromis: { label: 'Signature compromis', mascotte: 'nova-signature.png', colorHint: 'doré/or chaleureux, signature du compromis' },
  signature_acte: { label: 'Signature acte authentique', mascotte: 'nova-signature.png', colorHint: 'doré/or chaleureux, signature officielle finalisée' },
  sondage: { label: 'Sondage', mascotte: 'nova-neutre.png', colorHint: 'doré/or NovaSphere, ton posé, question ouverte à l\'équipe' },
};

// Duplique volontairement la logique de normalisation de
// src/lib/agency-logos.ts (fichier client, non importable depuis une
// fonction serverless Vercel isolée) — mêmes règles, même résultat.
function agencyLogoSlug(name?: string | null): string {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const n = norm(name || '');
  if (n.includes('conseil')) return 'conseils-finances';
  if (n.includes('immosphera') || n.includes('immo')) return 'immosphera';
  if (n.includes('novavisio') || n.includes('visio')) return 'novavisio';
  return 'novasphere';
}

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mimeType = r.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await r.arrayBuffer());
    return { data: buf.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

// Exécute la génération d'image (Gemini "nano banana", multimodal
// image-in/image-out) avec le logo de l'agence active et la mascotte Nova
// de référence fournis en entrée, pour une composition cohérente avec
// l'identité visuelle déjà en place plutôt qu'une image générique.
async function runGenerateImage(args: any, ctx: { publicOrigin: string; agencyName?: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "Génération d'image indisponible pour le moment (service non configuré)." };

  const intent = typeof args?.intent === 'string' ? args.intent : '';
  const meta = IMAGE_INTENT_META[intent];
  if (!meta) return { error: "Style d'image non reconnu — précise par exemple : succès, information, à vérifier, important, veille, réponse demandée, signature d'un acte ou sondage." };

  const origin = ctx.publicOrigin;
  const [mascotte, logo] = await Promise.all([
    fetchAsBase64(`${origin}nova/expressions/${meta.mascotte}`),
    fetchAsBase64(`${origin}agency-logos/${agencyLogoSlug(ctx.agencyName)}.png`),
  ]);

  if (!mascotte) return { error: "Génération d'image impossible : la mascotte Nova de référence n'a pas pu être chargée." };

  const details = typeof args?.details === 'string' && args.details.trim() ? args.details.trim() : '';

  const promptParts: any[] = [
    {
      text: `Crée un visuel carré professionnel et sobre pour le CRM immobilier/financier NovaSphere, thème "${meta.label}"${details ? ` (${details})` : ''}.
Style graphique : identique à la mascotte Nova fournie en première image de référence (robot rond noir/or aux expressions lumineuses néon) — reprends EXACTEMENT ce personnage et ce style, ne dessine jamais un autre robot ou personnage.
Ambiance colorée dominante : ${meta.colorHint}.
Composition : la mascotte Nova bien visible, fond dégradé sombre élégant cohérent avec son style, sans aucun texte écrit dans l'image (le texte est ajouté séparément par l'application).${
        logo
          ? ' Intègre discrètement le logo de la société fourni en deuxième image de référence, en petit médaillon en haut à droite du visuel — reproduis-le fidèlement, ne le déforme pas, ne le redessine pas.'
          : ''
      }
Format carré, haute qualité, aucun texte, aucune typographie, aucune lettre visible dans l'image.`,
    },
    { inlineData: { mimeType: mascotte.mimeType, data: mascotte.data } },
  ];
  if (logo) promptParts.push({ inlineData: { mimeType: logo.mimeType, data: logo.data } });

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: promptParts }],
      config: { responseModalities: ['IMAGE'] },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p.inlineData?.data);
    if (!imagePart) return { error: "La génération n'a produit aucune image — reformule ta demande ou réessaie." };

    return {
      image: { data: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType || 'image/png' },
      intent,
      label: meta.label,
    };
  } catch (e: any) {
    console.error('[generate_image] échec Gemini:', e?.message || e, e?.response?.data || '');
    return { error: `Génération d'image échouée : ${e?.message || 'erreur inconnue'}.` };
  }
}

const INFOMANIAK_TOKEN_URL = 'https://login.infomaniak.com/token';

// Ticket #267 : jeton kDrive de l'utilisateur, rafraîchi si expiré (comme
// pour Google Workspace, mais côté serveur ici — le jeton kDrive n'existe
// que dans user_kdrive_tokens, jamais côté navigateur).
async function getValidKdriveToken(userId: string): Promise<{ accessToken: string; driveId: string } | { error: string }> {
  const { supabaseAdmin } = await import('../_supabaseAdmin.js');
  const { data: rows } = await supabaseAdmin
    .from('user_kdrive_tokens')
    .select('access_token, refresh_token, expires_at, drive_id')
    .eq('user_id', userId)
    .limit(1);
  const row = rows?.[0] as any;
  if (!row) return { error: "kDrive n'est pas connecté — rendez-vous dans Paramètres pour le connecter." };
  if (!row.drive_id) {
    return { error: "kDrive est connecté mais son identifiant de drive n'a pas pu être détecté automatiquement — renseignez-le manuellement dans Paramètres." };
  }

  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 30000;
  if (!expired) return { accessToken: row.access_token, driveId: row.drive_id };

  if (!row.refresh_token) return { error: 'Session kDrive expirée — reconnectez kDrive dans Paramètres.' };
  const clientId = process.env.INFOMANIAK_CLIENT_ID;
  const clientSecret = process.env.INFOMANIAK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { error: 'Intégration kDrive non configurée.' };

  try {
    const r = await fetch(INFOMANIAK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: row.refresh_token,
      }),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) return { error: 'Session kDrive expirée — reconnectez kDrive dans Paramètres.' };

    const expiresAt = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
    await supabaseAdmin
      .from('user_kdrive_tokens')
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token || row.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    return { accessToken: data.access_token, driveId: row.drive_id };
  } catch {
    return { error: 'Session kDrive expirée — reconnectez kDrive dans Paramètres.' };
  }
}

// Ticket #267 : recherche de documents dans le kDrive de l'utilisateur —
// endpoint officiel (voir Infomaniak/mcp-server-kdrive) :
// GET /3/drive/{driveId}/files/search?query=...&limit=...
async function runSearchKdrive(args: any, userId: string) {
  const auth = await getValidKdriveToken(userId);
  if ('error' in auth) return { error: auth.error };

  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  const params = new URLSearchParams({ limit: '10' });
  if (query) params.set('query', query);

  try {
    const r = await fetch(`https://api.infomaniak.com/3/drive/${auth.driveId}/files/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[search_kdrive_documents] échec API:', data);
      return { error: 'La recherche kDrive a échoué.' };
    }
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const files = items.slice(0, 10).map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.type === 'dir' || f.type === 'directory' ? 'dossier' : 'fichier',
      updatedAt: f.last_modified_at || f.updated_at || null,
    }));
    return { files };
  } catch (e: any) {
    return { error: `Recherche kDrive échouée : ${e?.message || 'erreur inconnue'}.` };
  }
}

// Ticket #250 : generate_image ajoute un second aller-retour Claude + un
// appel Gemini image-gen — dépasse la limite par défaut de 10s des
// fonctions Vercel Hobby. 60s = le plafond autorisé sur ce plan.
export const config = { maxDuration: 60 };

// Le plan Vercel Hobby plafonne à 12 fonctions serverless par déploiement —
// déjà atteint (voir les commentaires similaires ailleurs dans /api). Les
// deux fonctionnalités suivantes (résumé quotidien programmé, synthèse
// vocale ElevenLabs) sont donc regroupées ICI plutôt que dans des fichiers
// séparés, routées manuellement dans le handler principal plus bas — même
// principe que api/settings/bootstrap.ts pour le callback kDrive.

// "Rachel" (21m00Tcm4TlvDq8ikWAM) était le premier choix, mais son usage via
// l'API ElevenLabs nécessite un abonnement payant (testé en direct, erreur
// 402 "paid_plan_required" sur le compte gratuit actuel). "Roger" avait
// fonctionné ensuite, puis choix définitif de l'utilisateur après écoute de
// plusieurs voix : "Charlie" (homme, australien, énergique). Les voix
// françaises natives du compte (Léa, Yara, Manon, Olivier) nécessitent
// toutes un abonnement payant — non utilisables tant que le compte reste
// gratuit.
const ELEVENLABS_VOICE_ID = 'IKne3meq5aSn9XLyUdCD'; // Charlie
const ELEVENLABS_TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

// Le markdown de Nova (**gras**, listes à puces, émojis) ne doit jamais être
// lu tel quel à voix haute ("étoile étoile gras étoile étoile").
function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^[•\-]\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .trim();
}

// POST /api/ai/agent avec { mode: 'speak', text } — voir toggleSpeakMessage
// dans AssistantIAView.tsx.
async function handleSpeak(req: any, res: any) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Synthèse vocale non configurée (ELEVENLABS_API_KEY manquante)." });
    return;
  }
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'Texte manquant.' });
    return;
  }
  const cleaned = stripMarkdownForSpeech(text).slice(0, 2000);
  try {
    const elevenRes = await fetch(ELEVENLABS_TTS_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: cleaned,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!elevenRes.ok) {
      const errBody = await elevenRes.text().catch(() => '');
      console.error('[ElevenLabs]', elevenRes.status, errBody);
      res.status(502).json({ error: 'La synthèse vocale a échoué.' });
      return;
    }
    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(audioBuffer);
  } catch (err: any) {
    console.error('[speak]', err);
    res.status(500).json({ error: err?.message || 'Erreur inconnue.' });
  }
}

// GET /api/ai/agent?cron=daily-summary — déclenché par Vercel Cron (voir
// vercel.json, "0 9 * * *"). Portée volontairement limitée aux RAPPELS
// (table `reminders`) — les évènements Google Calendar dépendent du jeton
// OAuth propre à chaque utilisateur, jamais mis en cache côté serveur.
async function handleDailySummaryCron(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers?.authorization || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Non autorisé.' });
    return;
  }
  try {
    const { data: users, error: usersError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('push_daily_reminders', true)
      .eq('is_active', true);
    if (usersError) throw usersError;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    let notified = 0;
    for (const user of users || []) {
      const { data: dueReminders } = await supabaseAdmin
        .from('reminders')
        .select('title, lead_id')
        .or(`user_id.eq.${user.id},assigned_to.eq.${user.id}`)
        .eq('is_done', false)
        .gte('due_at', todayStart.toISOString())
        .lt('due_at', todayEnd.toISOString());

      const count = dueReminders?.length || 0;
      if (count === 0) continue;

      // Signalé : "je voudrais avoir le nom du client [à côté] de ce qu'il
      // est prévu de faire avec lui" — même correctif que côté Nova
      // (AssistantIAView.tsx, taskSummaryLine) : le titre seul ("Att
      // documents client") ne distingue pas deux rappels similaires pour
      // deux clients différents.
      const leadIds = Array.from(new Set((dueReminders || []).map((r: any) => r.lead_id).filter(Boolean)));
      const { data: leadsForReminders } = leadIds.length
        ? await supabaseAdmin.from('leads').select('id, full_name, first_name, last_name').in('id', leadIds)
        : { data: [] as any[] };
      const leadNameById: Record<string, string> = {};
      (leadsForReminders || []).forEach((l: any) => {
        leadNameById[l.id] = l.full_name || [l.first_name, l.last_name].filter(Boolean).join(' ') || '';
      });

      const firstName = (user.full_name || '').split(' ')[0] || '';
      const titles = (dueReminders || [])
        .slice(0, 5)
        .map((r: any) => {
          const clientName = r.lead_id ? leadNameById[r.lead_id] : '';
          return clientName ? `• ${clientName} — ${r.title}` : `• ${r.title}`;
        })
        .join('\n');
      const body = `${count} rappel${count > 1 ? 's' : ''} aujourd'hui :\n${titles}${count > 5 ? `\n… et ${count - 5} de plus.` : ''}`;

      await supabaseAdmin.from('notifications').insert({
        user_id: user.id,
        type: 'daily_summary',
        title: `☀️ Bonjour ${firstName}, votre journée`,
        body,
        link: '/rappels',
        entity_type: 'reminder',
        entity_id: null,
        is_read: false,
      } as any);

      await supabaseAdmin
        .rpc('invoke_send_push' as any, {
          _user_ids: [user.id],
          _title: `☀️ Bonjour ${firstName}, votre journée`,
          _message: `${count} rappel${count > 1 ? 's' : ''} aujourd'hui.`,
          _url: '/rappels',
          _tag: 'daily-summary',
        } as any)
        .then(() => {}, () => {});

      notified += 1;
    }

    // Demande explicite : "quand on déplace un dossier dans une colonne, un
    // message de relance programmé (3/5/10/15 jours)... Nova nous dise où
    // on en est." Même cron (une seule exécution quotidienne suffit pour
    // une granularité en jours) — table `deal_followups`, voir la migration
    // dédiée. Annulée automatiquement si le dossier a bougé entretemps
    // (Pipeline.tsx, cancelPendingFollowups) : n'arrive donc ici QUE pour
    // les dossiers réellement restés sans mouvement.
    let followupsNotified = 0;
    try {
      const { data: dueFollowups } = await supabaseAdmin
        .from('deal_followups' as any)
        .select('id, lead_id, created_by, message')
        .eq('status', 'pending')
        .lte('due_at', new Date().toISOString());

      for (const f of (dueFollowups || []) as any[]) {
        if (!f.created_by) continue;
        const { data: lead } = await supabaseAdmin.from('leads').select('full_name, first_name, last_name').eq('id', f.lead_id).maybeSingle();
        const leadName = (lead as any)?.full_name || [(lead as any)?.first_name, (lead as any)?.last_name].filter(Boolean).join(' ') || 'ce dossier';

        await supabaseAdmin.from('notifications').insert({
          user_id: f.created_by,
          type: 'deal_followup',
          title: '🔔 Nova — Relance programmée',
          body: f.message || `Où en êtes-vous sur le dossier de ${leadName} ?`,
          link: '/pipeline',
          entity_type: 'lead',
          entity_id: f.lead_id,
          is_read: false,
        } as any);

        await supabaseAdmin
          .rpc('invoke_send_push' as any, {
            _user_ids: [f.created_by],
            _title: '🔔 Nova — Relance programmée',
            _message: f.message || `Où en êtes-vous sur le dossier de ${leadName} ?`,
            _url: '/pipeline',
            _tag: 'deal-followup',
          } as any)
          .then(() => {}, () => {});

        await supabaseAdmin.from('deal_followups' as any).update({ status: 'notified', notified_at: new Date().toISOString() } as any).eq('id', f.id);
        followupsNotified += 1;
      }
    } catch (followupErr) {
      // La table peut ne pas encore exister tant que la migration dédiée
      // n'a pas été exécutée — ne doit jamais faire échouer le bilan
      // quotidien lui-même, déjà traité au-dessus.
      console.warn('[cron/deal-followups]', followupErr);
    }

    res.status(200).json({ ok: true, notified, followupsNotified, totalUsers: (users || []).length });
  } catch (err: any) {
    console.error('[cron/daily-summary]', err);
    res.status(500).json({ error: err?.message || 'Erreur inconnue.' });
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === 'GET' && req.query?.cron === 'daily-summary') {
    return handleDailySummaryCron(req, res);
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  if (req.body?.mode === 'speak') {
    return handleSpeak(req, res);
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée.' });
      return;
    }

    const { prompt, messages = [], context = {} } = req.body || {};
    const isNovaSuperAssistant = await resolveIsNovaSuperAssistant(req);
    // Ticket #267 : id utilisateur nécessaire pour retrouver son jeton
    // kDrive — jamais bloquant si absent/invalide (comme ci-dessus).
    const currentUserId = await getAuthedUser(req).then((u) => u.id).catch(() => null);

    const claudeMessages = (messages as any[]).map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
    if (prompt) claudeMessages.push({ role: 'user', content: prompt });

    // L'API Messages exige une alternance stricte user/assistant et un
    // premier message "user" — l'historique client (démarrant par le
    // message de bienvenue "ai") peut violer ça ; on nettoie.
    const cleaned: { role: string; content: string }[] = [];
    for (const m of claudeMessages) {
      if (cleaned.length === 0 && m.role !== 'user') continue;
      if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === m.role) {
        cleaned[cleaned.length - 1].content += `\n${m.content}`;
      } else {
        cleaned.push({ ...m });
      }
    }

    const systemPrompt = `Tu es Nova, l'assistant IA NovaSphere. Réponds en français, de façon concise et utile.

RÈGLE LA PLUS IMPORTANTE DE CE PROMPT — PRIORITAIRE SUR TOUTE AUTRE CONSIGNE DEMANDANT DE POSER DES QUESTIONS EN CAS D'AMBIGUÏTÉ : quand un nom de client est cité pour une action (note, tâche, affiche, rendez-vous, e-mail...), tu DOIS toi-même regarder la liste "Contacts existants" plus bas dans ce prompt AVANT de répondre quoi que ce soit — jamais demander à l'utilisateur si c'est un client existant ou nouveau, jamais demander son email/téléphone. Un contact trouvé (même avec l'ordre des mots différent, ex: "Dupont Frédéric" = "Frédéric Dupont") : utilise son contactId, agis immédiatement. Aucun contact trouvé : appelle create_contact (avec juste le nom, email/téléphone sont facultatifs) DANS LA MÊME RÉPONSE que toutes les autres actions demandées, contactId vide sur les autres outils. La seule vraie raison de poser une question ici : plusieurs contacts différents correspondent au même nom cité. Ceci s'applique même si tu hésites — préfère toujours vérifier la liste et agir plutôt que demander.

Mémoire de conversation : CONTRAIREMENT à un assistant IA classique, tes échanges avec cet utilisateur sont automatiquement sauvegardés et RECHARGÉS à chaque ouverture de Nova (même après avoir fermé l'application, changé d'appareil, ou plusieurs jours plus tard) — un seul fil continu par utilisateur, jusqu'à ce qu'il clique sur "Effacer l'historique". Si on te demande si tu as de la mémoire ou si tu te souviens des échanges précédents, réponds OUI clairement et explique ce mécanisme précis — ne réponds JAMAIS par la réserve générique habituelle des assistants IA ("je n'ai pas de mémoire au-delà de cette conversation", "c'est une limite technique normale"), qui est FAUSSE ici et donnerait une information incorrecte à l'utilisateur sur une fonctionnalité réelle du CRM.

NE JAMAIS AFFIRMER UNE LIMITATION SANS VÉRIFIER LA LISTE D'OUTILS CI-DESSOUS D'ABORD : cette conversation étant conservée en mémoire (voir ci-dessus), tu as pu dire par le passé, dans un tour précédent, que tu ne pouvais pas faire quelque chose — cette affirmation passée peut être PÉRIMÉE (tes outils évoluent). Avant de répondre "je n'ai pas d'outil pour ça"/"je ne peux pas faire ça", relis attentivement la liste des outils disponibles dans ce message précis, ne te fie jamais à ce que tu as pu dire avant dans la conversation. Exemple concret et fréquent : get_daily_summary accepte un paramètre "date" — il PERMET de répondre à "quelles sont mes tâches/rendez-vous de lundi (ou n'importe quel autre jour)", ce n'est PAS une limitation, ne dis jamais le contraire. Si un doute persiste sur une vraie limitation, essaie d'abord l'outil qui semble le plus proche plutôt que de conclure trop vite à l'impossibilité.

NE JAMAIS DIRE QU'UNE ACTION EST « DÉJÀ FAITE » SANS L'AVOIR RÉELLEMENT EXÉCUTÉE DANS CE TOUR-CI : la mémoire de conversation (voir ci-dessus) sert à te souvenir du CONTEXTE (préférences, discussions passées) — jamais à sauter l'exécution d'une nouvelle demande. Chaque message qui demande une action (créer une note/tâche/contact/rendez-vous...) est une demande NEUVE et INDÉPENDANTE, comme si la conversation repartait de zéro pour cette action précise — même si un échange très similaire apparaît plus tôt dans l'historique (un autre client, une tâche au libellé proche, une note qui ressemble). Une ressemblance avec un tour passé n'est JAMAIS une preuve que c'est déjà fait pour la demande actuelle : appelle systématiquement l'outil correspondant à CE message-ci, pour LE contact concerné maintenant. Ne réponds "c'est déjà fait" QUE si l'action a réellement été exécutée (tool_use) dans CETTE réponse, ou si l'utilisateur demande explicitement un rappel du passé ("est-ce que j'ai déjà créé cette tâche ?") — et même alors, vérifie précisément de quel contact/tâche il parle avant de répondre, sans généraliser depuis un cas similaire mais différent.

Style d'écriture : aère tes réponses (retours à la ligne, listes à puces courtes) plutôt qu'un seul bloc dense — surtout dès que tu donnes plusieurs informations (tâches, rendez-vous, résultats...). Un emoji sobre en début de ligne ou de section peut aider à repérer l'information (📋 tâche, 📅 rendez-vous, ✅ succès...), mais jamais plus d'un par ligne et jamais dans le corps d'une phrase — reste professionnel avant tout, ce n'est pas un ton familier.

Version courte à voix haute (mode vocal de Nova, "nébuleuse") — IMPORTANT, la voix (ElevenLabs) est payante à chaque mot prononcé, minimise-la systématiquement : ta réponse écrite ci-dessus peut être détaillée, mais dès qu'elle dépasse UNE phrase courte (liste, énumération, description longue, contenu d'un e-mail, plusieurs résultats, statistiques...), termine ta réponse par UNE ligne finale, seule sur sa ligne, EXACTEMENT au format suivant, jamais visible ni mentionnée par toi dans le texte normal :
[[SPEECH: version orale très courte ici]]
Règles de cette version orale, strictes : UNE SEULE phrase courte dans l'écrasante majorité des cas (deux maximum si vraiment indispensable) ; 5 à 12 mots idéalement, 20 mots maximum sauf nécessité absolue ; ne lis jamais une liste en entier, jamais le contenu complet d'un e-mail/document, jamais des coordonnées/téléphone/informations financières détaillées (dis plutôt "j'ai trouvé les informations demandées" et laisse l'écran afficher le détail) ; va droit à l'essentiel plutôt que de reformuler poliment ce qui est déjà écrit (ex: "C'est fait, la tâche est créée." plutôt qu'une phrase longue). N'ajoute PAS ce marqueur quand ta réponse écrite est déjà courte et se prête telle quelle à l'oral (dans ce cas, elle sera lue telle quelle) — inutile de le dupliquer inutilement.
Si ta réponse ne mérite vraiment aucune lecture à voix haute (ex: simple confirmation déjà evidente à l'écran, liste de résultats qui se suffit visuellement), termine plutôt par la ligne seule : [[NO_SPEECH]] — à privilégier chaque fois que c'est raisonnable pour économiser des crédits, mais jamais pour une réponse directe à une question posée à l'oral par l'utilisateur (elle mérite toujours une réponse orale, même très brève).

Reformulation des notes/tâches/rendez-vous dictés : le contenu (content de create_note, title/description de create_appointment...) vient souvent d'une dictée vocale — phrasé oral, hésitations, mots mal coordonnés. Réécris-le systématiquement dans un français clair, professionnel et bien construit AVANT de le transmettre à l'outil, sans jamais changer le sens, ajouter une information non dite, ou omettre un fait mentionné — uniquement une reformulation fidèle, jamais une réinterprétation. Le titre d'une note/tâche/RDV doit rester court et factuel ; les détails vont dans le champ content/description, reformulés proprement.

Demande floue ou ambiguë : n'invente JAMAIS un détail manquant ni ne devine une action risquée quand une commande n'est pas claire — comporte-toi comme un coach patient face à quelqu'un qui ne connaît rien à l'informatique. Repose une question simple et précise pour lever le doute, plutôt que d'agir sur une supposition ou de renvoyer une erreur technique. Ne demande JAMAIS plusieurs précisions à la fois dans des messages séparés qui se suivent — si plusieurs informations manquent pour une seule action (ex: un rendez-vous sans heure ni lieu), regroupe-les en UNE seule question claire et courte, facile à lire et à répondre d'un coup (pour ne pas multiplier les allers-retours). N'hésite jamais à reformuler ce que tu as compris avant d'agir si le doute porte sur une action sensible ou irréversible.

Client existant ou nouveau — NE JAMAIS DEMANDER, VÉRIFIE TOI-MÊME : chaque question posée coûte un aller-retour ET un appel vocal payant (ElevenLabs) inutile. Dès qu'un nom de client est cité (note, tâche, affiche, rendez-vous...), cherche D'ABORD ce nom dans la liste "Contacts existants" ci-dessous (correspondance même partielle/approximative — ex: "Dupont Frédéric" doit être rapproché de "Frédéric Dupont" dans la liste, l'ordre des mots ne compte pas). Si un contact correspond clairement : utilise directement son contactId, appelle les outils tout de suite, ne demande JAMAIS "est-ce un client existant ?" — tu as la liste sous les yeux, vérifie-la avant de répondre. Si AUCUN contact ne correspond : considère qu'il s'agit d'un nouveau client et appelle create_contact DANS LA MÊME RÉPONSE que TOUS les autres outils demandés (note, tâche, affiche, rendez-vous...) — jamais create_contact seul en attendant un tour suivant pour le reste, tu n'auras pas d'autre occasion de finir le travail. Tu ne connais pas encore le contactId définitif (il n'existe pas tant que create_contact n'a pas été exécuté) : laisse simplement contactId vide sur les autres outils, l'utilisateur les rattachera si besoin — ne JAMAIS attendre de connaître ce contactId pour appeler les autres outils. Aucune confirmation à demander : citer un nom + un contexte (rendez-vous, dossier...) exprime déjà l'intention de créer sa fiche. Email et téléphone sont FACULTATIFS sur create_contact (seul "name" est obligatoire) — ne les demande JAMAIS avant de créer le contact, laisse-les simplement vides si l'utilisateur ne les a pas donnés spontanément, l'utilisateur les complétera plus tard sur la fiche s'il le souhaite ; ce n'est jamais un motif pour retarder la création ou poser une question. Ne pose une question que dans le cas réellement ambigu où PLUSIEURS contacts correspondent au nom cité (ex: deux "Martin" différents) — jamais pour trancher "nouveau ou existant", jamais pour demander des coordonnées optionnelles.

Immosphera360 : dès qu'on te demande de trouver/voir des biens immobiliers (maison, appartement, villa...), utilise l'outil search_properties — les résultats s'affichent automatiquement en vignettes avec photo pour l'utilisateur, donc ta réponse texte doit rester courte (ne redécris pas chaque bien en détail, les vignettes s'en chargent) : un mot d'intro, éventuellement le nombre de biens trouvés. Si l'utilisateur donne une FOURCHETTE de prix ("entre 250 000 et 270 000 €"), renseigne TOUJOURS à la fois minPrice ET maxPrice — ne mets jamais seulement maxPrice dans ce cas, sinon des biens moins chers que la borne basse remonteraient à tort. Recherche digne d'une grande agence immobilière : extrais et renseigne TOUS les critères mentionnés (type de bien, budget, surface, pièces, chambres, terrasse, piscine, DPE, vente/location, secteur...), pas seulement le prix — un client qui précise "maison avec piscine et terrasse, 4 chambres, DPE D minimum, entre 300 et 400k à Narbonne" doit voir ces 7 critères transmis à l'outil, pas 2 ou 3.

Tu n'es pas limité au CRM : utilise l'outil de recherche web librement dès qu'une question porte sur une information générale, une actualité, un prix, une réglementation ou toute donnée que tu ne connais pas avec certitude — comme le ferait ChatGPT. N'hésite jamais à chercher plutôt que de dire que tu ne peux pas.

generate_image : si le résultat de l'outil contient une erreur, rapporte-la simplement comme un problème technique passager ("la génération d'image n'a pas fonctionné, réessaie dans un instant") sans jamais deviner ou inventer une cause précise (ne dis jamais "crédits épuisés", "quota dépassé" ou toute autre explication que le résultat ne t'a pas donnée explicitement) — tu ne connais pas la cause réelle, ne l'invente pas.

Ticket support (create_support_ticket) : dès qu'un utilisateur signale un problème/bug/blocage ou demande de contacter le support, reformule proprement ce qu'il a décrit (titre court + description claire et complète, en français correct) et détermine toi-même la priorité (basse/normale/urgente) selon la gravité et l'impact décrits — ne demande jamais explicitement à l'utilisateur de choisir lui-même la priorité, c'est ton rôle de l'évaluer à partir du contexte.

E-mail client (send_client_email) : dès qu'on te demande d'écrire/envoyer un e-mail à un client déjà présent dans le CRM. Résolution du client, dans cet ordre de priorité : 1) un nom explicitement cité dans la demande, 2) le "Client actuellement affiché" ci-dessous si l'utilisateur dit "lui"/"elle"/"ce client"/ne précise pas de nom, 3) un client déjà mentionné plus tôt dans la conversation. Si le nom cité correspond à PLUSIEURS contacts dans la liste, ne choisis JAMAIS au hasard — pose une question pour demander lequel (ex: "Il y a deux clients nommés Martin : Sophie Martin et Paul Martin, lequel ?"). Si aucun contact ne correspond, laisse contactId vide et renseigne clientName — l'utilisateur verra clairement qu'aucune fiche n'a été trouvée plutôt qu'une erreur technique. N'ajoute jamais de formule de politesse finale/signature dans le corps : elle est ajoutée automatiquement.

RÈGLE IMPÉRATIVE — ne jamais confondre "envoyer un e-mail" avec "créer un rendez-vous" : dès que l'utilisateur emploie un verbe d'envoi de message ("envoie un mail", "écris à", "préviens-le par mail", "mail à...") tu appelles TOUJOURS send_client_email, JAMAIS create_appointment — même si la phrase contient par ailleurs des mots évoquant un rendez-vous ou une catégorie de create_appointment (ex: "banque", "notaire", "signature", "visite") : ces mots ne décrivent alors que le CONTENU du message, pas une action de calendrier à créer. Un bug déjà survenu : "envoie un mail à Untel, le dossier est en banque" a été mal interprété comme "crée un rendez-vous Rendez-vous Banque" à cause du mot "banque" seul, sans jamais envoyer le moindre e-mail — ce mot doit au contraire finir DANS le corps du mail rédigé (ex: "Je vous confirme que votre dossier est actuellement en banque."), jamais interprété comme une catégorie de rendez-vous. En cas de demande réellement ambiguë (ni verbe d'envoi ni mention explicite de rendez-vous/date/heure), pose une question plutôt que de deviner.

Espace client (invite_client_guest, request_client_document, set_client_guest_access_status), create_appointment, create_support_ticket, send_client_email${isNovaSuperAssistant ? ', ainsi que invite_collaborator, set_collaborator_active_status, create_pipeline_automation et create_announcement' : ''} : contrairement aux autres actions, celles-ci ne s'exécutent JAMAIS immédiatement — l'utilisateur doit toujours confirmer manuellement dans une carte dédiée avant que quoi que ce soit ne se passe réellement. Ne dis donc jamais "c'est fait" pour ces outils-là : dis plutôt que tu prépares la demande et que la confirmation apparaît ci-dessous. Vérifie toujours mentalement que l'action est cohérente avant de l'appeler (ex: ne désactive jamais un collaborateur sur un simple sous-entendu, demande confirmation explicite du nom si le moindre doute existe).

Annonce en félicitations (create_announcement) : une signature de compromis utilise TOUJOURS le niveau "signature_compromis", une signature d'acte authentique utilise TOUJOURS le niveau "signature_acte" (jamais "succes" ni "important", et jamais l'un à la place de l'autre). Les deux déclenchent la même mise en avant (feu d'artifice, mascotte Nova en pleine page). Exemples : "annonce la signature du compromis de X" → signature_compromis ; "annonce la signature de l'acte de X en félicitant Y" → signature_acte. Rédige un message chaleureux et bref citant la personne félicitée par son prénom.

Sondage (create_announcement, pollOptions) : dès que l'utilisateur demande un sondage ou une question à choix ("qui vient... présent/absent ?", "qui est pour/contre ?"...), renseigne pollOptions avec les options de réponse évidentes de la question (le système affiche ensuite un vrai sondage avec boutons de vote et compteur en direct) — ne mets JAMAIS pollOptions pour une annonce qui n'est pas explicitement une question à choix.

Règle impérative sur les demandes combinées : si l'utilisateur demande plusieurs actions dans le même message (par exemple créer un contact ET une tâche ET une note ET un rappel), tu dois appeler TOUS les outils correspondants dans cette même réponse, en une seule fois — n'en fais jamais qu'un seul en attendant un tour suivant, tu n'auras pas d'autre occasion de finir le travail. Compte le nombre d'actions distinctes demandées AVANT de répondre (ex: "crée-moi une tâche et une note" = 2 actions = 2 appels d'outils obligatoires, jamais un seul) — si tu hésites sur un détail (date, priorité...), déduis une valeur raisonnable plutôt que de sauter l'action entièrement ou de la reporter à un message suivant : il vaut mieux créer la tâche avec une échéance par défaut que ne pas la créer du tout. Un contact créé dans le même message peut aussi recevoir immédiatement sa tâche et sa note associées, même si tu ne connais pas encore son contactId définitif : laisse alors contactId vide sur la tâche/note, l'utilisateur les rattachera si besoin.

Date et heure actuelles : ${
          (context as any)?.currentDate || 'inconnue'
        }. Agence active: ${
          (context as any)?.activeAgency?.name || 'Toutes'
        }. Utilise toujours cette date pour calculer une date relative (demain, dans 3 jours, vendredi prochain...) donnée par l'utilisateur — ne redemande jamais la date du jour, tu la connais déjà.

Table des 14 prochains jours (nom du jour — date ISO), à utiliser TELLE QUELLE, QUEL QUE SOIT L'OUTIL CONCERNÉ (get_daily_summary, get_upcoming_brief, create_task "dueDate", create_appointment, ou tout autre champ date), dès que l'utilisateur nomme un jour ("lundi", "vendredi prochain", "demain"...) — ne calcule JAMAIS une date toi-même par arithmétique de calendrier (erreur fréquente, ex: confondre mardi et mercredi), cherche systématiquement la ligne correspondante ci-dessous :
${
  Array.isArray((context as any)?.upcomingDates) && (context as any).upcomingDates.length > 0
    ? (context as any).upcomingDates.map((d: any) => `- ${d.label} — ${d.date}`).join('\n')
    : '(table non fournie)'
}

${
  (context as any)?.userLocation?.lat != null && (context as any)?.userLocation?.lon != null
    ? `Position géographique actuelle de l'utilisateur (géolocalisation navigateur) : latitude ${(context as any).userLocation.lat}, longitude ${(context as any).userLocation.lon}. Utilise-la pour toute question de proximité, de distance ou d'itinéraire ("où est le McDo le plus proche ?", "à quelle distance est cette adresse ?", "comment aller à..."), en t'appuyant sur la recherche web pour trouver les lieux réels autour de cette position — ne dis jamais que tu ne peux pas localiser l'utilisateur, tu as sa position.`
    : "Position géographique de l'utilisateur non disponible (géolocalisation refusée ou indisponible) — si une question porte sur la proximité/distance, précise-le et demande l'adresse ou la ville de référence."
}

Sociétés/agences existantes (id — nom), à utiliser pour renseigner agencyIds de create_announcement quand l'utilisateur cite une société par son nom (ex. "à toute l'équipe ImmoSphera") — ne mets JAMAIS un id qui ne vient pas exactement de cette liste ; laisse agencyIds vide (jamais rempli au hasard) si l'utilisateur dit "toutes les agences"/"tout le monde"/ne précise rien :
${
  Array.isArray((context as any)?.agencies) && (context as any).agencies.length > 0
    ? (context as any).agencies.map((a: any) => `- ${a.id} — ${a.name}`).join('\n')
    : '(liste des agences non fournie)'
}

${
  (context as any)?.currentClientId
    ? `Client actuellement affiché à l'écran (fiche ouverte) : ${(context as any).currentClientId}. Utilise-le comme contactId par défaut pour send_client_email si l'utilisateur dit "lui"/"elle"/"ce client"/"le client" sans citer de nom précis.\n\n`
    : ''
}Contacts existants (id — nom), à utiliser pour renseigner contactId quand l'utilisateur cite un client par son nom — ne mets JAMAIS un contactId qui ne vient pas exactement de cette liste :
${
  Array.isArray((context as any)?.contacts) && (context as any).contacts.length > 0
    ? (context as any).contacts
        .slice(0, 60)
        .map((c: any) => `- ${c.id} — ${c.name}`)
        .join('\n')
    : '(aucun contact fourni)'
}${
  isNovaSuperAssistant
    ? `\n\nCollaborateurs existants (id — nom — rôle), à utiliser pour renseigner userId de set_collaborator_active_status — ne mets JAMAIS un userId qui ne vient pas exactement de cette liste, et ne confonds jamais un collaborateur avec un contact/client :\n${
        Array.isArray((context as any)?.collaborators) && (context as any).collaborators.length > 0
          ? (context as any).collaborators
              .slice(0, 60)
              .map((c: any) => `- ${c.id} — ${c.name} — ${c.role}`)
              .join('\n')
          : '(aucun collaborateur fourni)'
      }`
    : ''
}`;

    // Ticket "Paramètres/Nova/Utilisateurs/Annonces" (12/16) : les outils
    // sensibles (NOVA_ADMIN_TOOLS) ne sont même pas PROPOSÉS au modèle pour
    // le reste de l'équipe — pas seulement refusés après coup.
    const activeTools = isNovaSuperAssistant ? [...TOOLS, ...NOVA_ADMIN_TOOLS] : TOOLS;

    const callClaude = async (msgs: any[]) => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          // Relevé (#26 : recherche web, puis signalé : tâches/notes parfois
          // ignorées sur une demande combinée) — plusieurs tool_use dans la
          // même réponse (contact + tâche + note + rappel...) peuvent
          // dépasser 2048 tokens cumulés, tronquant silencieusement les
          // derniers appels d'outils de la liste.
          max_tokens: 4096,
          system: systemPrompt,
          messages: msgs,
          tools: activeTools,
        }),
      });
      return r.json().catch(() => ({}));
    };

    let data = await callClaude(cleaned);
    if (data?.error) {
      res.status(500).json({ error: data.error.message || 'Erreur Claude.' });
      return;
    }

    let content: any[] = data.content || [];
    let properties: any[] | undefined;

    // ── Rattrapage des demandes combinées (31/08/2026) ──────────────────────
    // Signalé : « quand on demande à Nova de créer une note ET une tâche, des
    // fois il ne crée pas l'un des deux ».
    //
    // Le serveur renvoie bien tous les appels d'outils reçus, et le client les
    // exécute tous en boucle — la perte est en amont : le modèle n'émet
    // parfois qu'un seul `tool_use` malgré la règle impérative du prompt
    // système, qui lui demande déjà explicitement de tous les émettre d'un
    // coup. Une consigne ne suffit donc pas ; on vérifie.
    //
    // Quand la demande est visiblement multiple (« et », « puis », « ainsi
    // que »…) et qu'un seul outil a été appelé, on relance Claude une fois en
    // lui montrant sa propre réponse et en lui demandant les outils manquants.
    // Ciblé volontairement : une seule passe supplémentaire, et seulement dans
    // ce cas précis, pour ne pas doubler le coût de chaque échange.
    const dernierMessageUtilisateur = [...cleaned].reverse()
      .find((m: any) => m.role === 'user');
    const texteDemande = typeof dernierMessageUtilisateur?.content === 'string'
      ? dernierMessageUtilisateur.content
      : (dernierMessageUtilisateur?.content || [])
          .filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ');
    const demandeMultiple = /\b(et|puis|ainsi que|également|aussi)\b/i.test(texteDemande || '');
    const outilsAppeles = content.filter((b: any) => b.type === 'tool_use');

    if (demandeMultiple && outilsAppeles.length === 1) {
      const relance = await callClaude([
        ...cleaned,
        { role: 'assistant', content },
        {
          role: 'user',
          content: [{
            type: 'text',
            text: `Tu n'as appelé qu'un seul outil (${outilsAppeles[0].name}) alors que ma demande en contenait plusieurs. `
              + `Appelle MAINTENANT, dans cette réponse, les outils correspondant aux actions restantes — `
              + `sans redemander de précisions et sans refaire celle déjà faite. `
              + `Si tu hésites sur un détail, choisis une valeur raisonnable. `
              + `Si vraiment il ne restait rien à faire, réponds simplement "OK" sans appeler d'outil.`,
          }],
        },
      ]);
      const complement = (relance?.content || [])
        .filter((b: any) => b.type === 'tool_use' && b.name !== outilsAppeles[0].name);
      if (complement.length > 0) content = [...content, ...complement];
    }

    // search_properties s'exécute côté serveur (contrairement aux autres
    // outils, exécutés côté client) : on relance Claude avec le résultat
    // réel pour qu'il termine sa réponse en connaissance de cause, tout en
    // renvoyant la liste brute au client pour l'affichage en vignettes.
    const propertySearchCall = content.find((b) => b.type === 'tool_use' && b.name === 'search_properties');
    if (propertySearchCall) {
      const result = await runPropertySearch(propertySearchCall.input || {});
      properties = result.properties;

      // Version allégée pour Claude (pas la galerie complète ni la
      // description intégrale) — le client, lui, reçoit `properties`
      // au complet pour la fiche détail (ticket #61).
      const resultForClaude = {
        ...result,
        properties: (result.properties || []).map((p: any) => ({
          ...p,
          description: p.description ? String(p.description).slice(0, 220) : '',
          images: undefined,
        })),
      };

      const followUpMessages = [
        ...cleaned,
        { role: 'assistant', content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: propertySearchCall.id,
              content: JSON.stringify(resultForClaude),
            },
          ],
        },
      ];
      data = await callClaude(followUpMessages);
      if (!data?.error) content = data.content || [];
    }

    // Ticket #250 : génération d'image, exécutée côté serveur (nécessite
    // GEMINI_API_KEY) — même principe que search_properties ci-dessus.
    let generatedImage: { dataUrl: string; intent: string; label: string } | undefined;
    const generateImageCall = content.find((b) => b.type === 'tool_use' && b.name === 'generate_image');
    if (generateImageCall) {
      const result = await runGenerateImage(generateImageCall.input || {}, {
        publicOrigin: resolvePublicOrigin(req),
        agencyName: (context as any)?.activeAgency?.name,
      });

      // Jamais l'image complète (lourde, en base64) renvoyée à Claude —
      // seul un texte court lui permet de conclure sa réponse normalement.
      const resultForClaude = result.error
        ? { error: result.error }
        : { success: true, label: result.label };

      const followUpMessages = [
        ...cleaned,
        { role: 'assistant', content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: generateImageCall.id,
              content: JSON.stringify(resultForClaude),
              ...(result.error ? { is_error: true } : {}),
            },
          ],
        },
      ];
      data = await callClaude(followUpMessages);
      if (!data?.error) content = data.content || [];

      if (result.image) {
        generatedImage = {
          dataUrl: `data:${result.image.mimeType};base64,${result.image.data}`,
          intent: result.intent,
          label: result.label,
        };
      }
    }

    // Ticket #267 : search_kdrive_documents, exécuté côté serveur (jeton
    // jamais transmis au client) — même principe que generate_image
    // ci-dessus.
    const searchKdriveCall = content.find((b) => b.type === 'tool_use' && b.name === 'search_kdrive_documents');
    if (searchKdriveCall) {
      const result = currentUserId
        ? await runSearchKdrive(searchKdriveCall.input || {}, currentUserId)
        : { error: 'Utilisateur non authentifié.' };

      const followUpMessages = [
        ...cleaned,
        { role: 'assistant', content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: searchKdriveCall.id,
              content: JSON.stringify(result),
              ...(result.error ? { is_error: true } : {}),
            },
          ],
        },
      ];
      data = await callClaude(followUpMessages);
      if (!data?.error) content = data.content || [];
    }

    const rawText = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    // Architecture vocale à deux niveaux ("display_text" / "speech_text") :
    // Claude peut terminer sa réponse par un marqueur dédié (voir prompt
    // système, "Version courte à voix haute") — jamais affiché tel quel
    // dans le chat, extrait ici et renvoyé à part. Objectif : en mode vocal
    // (nébuleuse), Nova ne doit jamais lire à voix haute une longue liste,
    // un e-mail entier ou des données sensibles — seulement un résumé
    // court décidé par Claude lui-même. Le texte affiché à l'écran, lui,
    // reste toujours complet.
    let text = rawText;
    let speechText: string | null = null;
    let shouldSpeak = true;
    const noSpeechMatch = text.match(/\n?\[\[NO_SPEECH\]\]\s*$/);
    if (noSpeechMatch) {
      shouldSpeak = false;
      text = text.slice(0, noSpeechMatch.index).trim();
    } else {
      const speechMatch = text.match(/\n?\[\[SPEECH:\s*([^\]]+?)\s*\]\]\s*$/);
      if (speechMatch) {
        speechText = speechMatch[1].trim();
        text = text.slice(0, speechMatch.index).trim();
        // Garde-fou crédits ElevenLabs : la consigne demande 5-20 mots,
        // mais le modèle ne la respecte pas toujours parfaitement — coupe
        // au-delà d'une marge large plutôt que d'envoyer un texte long en
        // synthèse vocale payante.
        const words = speechText.split(/\s+/);
        if (words.length > 40) speechText = `${words.slice(0, 40).join(' ')}…`;
      }
    }

    const functionCalls = content
      .filter((b) => b.type === 'tool_use' && b.name !== 'search_properties' && b.name !== 'generate_image' && b.name !== 'search_kdrive_documents')
      .map((b) => ({ name: b.name, args: b.input || {} }));

    res.status(200).json({
      text,
      speechText,
      shouldSpeak,
      functionCalls,
      isNovaSuperAssistant,
      ...(properties ? { properties } : {}),
      ...(generatedImage ? { generatedImage } : {}),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erreur Claude.' });
  }
}
