# Applications Google « internes », une par société

Décidé le 2 septembre 2026 : trois Google Workspace distincts (Conseils
Finances, Novavisio, ImmoSphera), donc trois projets Google Cloud déclarés
« Interne », un par société. Chaque collaborateur autorise Gmail, Drive et
Agenda sur l'application de sa société : plus de vérification Google, plus
d'écran d'avertissement, plus de jeton qui expire au bout de sept jours.

- Un guide PDF par société, à suivre depuis le compte administrateur du
  Workspace concerné (`Guide Google interne - <Société>.pdf`).
- `genere_guides.py` régénère les trois PDF (Chromium en mode headless).
- Côté application : `api/_googleUserOAuth.ts` (choix du client d'après
  l'adresse e-mail), `/api/google/connect` et `/api/google/callback`
  (réécrits vers `api/admin/drive/[agencyId].ts` dans `vercel.json`), et
  `reconnectGoogleWorkspace` dans `src/lib/workspace.ts`.
- Les clés se déposent dans Vercel (variables d'environnement, Production et
  Preview) et dans Supabase (secrets des Edge Functions), sous les noms
  `GOOGLE_OAUTH_CLIENT_ID_<SOCIÉTÉ>` / `GOOGLE_OAUTH_CLIENT_SECRET_<SOCIÉTÉ>`.
  Vercel ne lit une nouvelle variable qu'au déploiement suivant.

## Vérifier que la prod voit les clés

Ouvrir `https://app.nova360.space/api/google/connect` dans un navigateur :
la réponse indique, société par société, si les deux clés sont présentes
dans cet environnement (`true`/`false`), sans jamais afficher une valeur.

Piège rencontré le 2 septembre : des variables saisies dans l'onglet
« Shared » (équipe Vercel) ne s'appliquent pas au projet tant qu'elles ne
lui sont pas rattachées. Les saisir dans le projet `crm-novasphere-v2`
(Settings → Environment Variables, onglet « Project »), Production et
Preview cochés, puis redéployer.
