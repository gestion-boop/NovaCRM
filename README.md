# Nova CRM

CRM multi-agences (Conseils Finances, ImmoSphera, NovaVisio) — React + Vite +
TypeScript + Tailwind, avec Supabase pour la base, l'authentification et le
stockage.

## Démarrer en local

```bash
npm install
npm run dev          # http://localhost:3000
```

Copier `.env.example` en `.env` et y renseigner les vraies valeurs. **Ne jamais
mettre de vraie clé dans `.env.example`** : ce fichier est versionné, `.env` ne
l'est pas.

## Emplacement du dossier de travail

Le projet ne doit **pas** vivre dans un dossier synchronisé (iCloud Drive,
Google Drive, Dropbox). Ces services « évincent » le contenu des fichiers pour
gagner de la place : le fichier garde sa taille mais se lit vide, ce qui produit
des builds silencieusement cassés — un `tailwind.config.ts` vidé a déjà généré
une CSS sans aucune classe, donc une application sans style en production.

## Thème (mode nuit / mode jour)

Les couleurs sont pilotées par des jetons définis une seule fois par thème dans
`src/index.css` (`--nv-surface-*`, `--ink-*`). Les composants utilisent encore
beaucoup de couleurs Tailwind arbitraires (`bg-[#0a1e20]`) : la correspondance
entre ces couleurs et les jetons est **générée**, pas écrite à la main.

```bash
npm run theme:check   # signale si les listes générées sont périmées
npm run theme:sync    # les régénère dans src/index.css
```

À lancer après avoir ajouté un écran, sinon ses fonds resteront sombres en mode
jour. Tout bloc qui pose du texte par-dessus le fond de page doit porter la
classe `.nv-panel` — sans elle, la photo d'arrière-plan passe derrière le texte.

## Déploiement

| Branche | Domaine | Usage |
|---|---|---|
| `test` | `test.nova360.space` | validation avant mise en ligne |
| `main` | `app.nova360.space` | production, vue par toute l'équipe |

Le circuit : pousser sur `test`, vérifier sur `test.nova360.space`, puis
fusionner dans `main` pour la production. Une mise en production déclenche une
notification de mise à jour pour tous les utilisateurs connectés.

`novasphere.nova360.space` et `client.nova360.space` (portail client) suivent
également la production : vérifier qu'ils pointent bien sur le bon déploiement
après toute opération manuelle sur les domaines.
