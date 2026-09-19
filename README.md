# VERZO Sales Agent

Un pipeline autonome qui : cherche des entreprises dans une niche donnée →
scrape leur site (emails, décideurs) → note l'opportunité avec Claude →
rédige un email + message LinkedIn personnalisés → sauvegarde tout dans un
CRM Supabase → **envoie automatiquement l'email** pour les leads à haut score,
sans clic humain (voir `CLAUDE.md`, section "SENDING").

C'est un projet Node autonome, indépendant du backend Solen (repo séparé).

## Dashboard mobile

`https://TON-URL.vercel.app/dashboard?key=<VERZO_SECRET>` — liste des leads,
filtrable par statut, drafts consultables, bouton d'approbation pour les
leads sous le seuil d'auto-envoi. Ouvre-le une fois sur ton téléphone (la clé
se sauvegarde en local), puis "Ajouter à l'écran d'accueil" pour un accès
rapide façon app.

## Ce qui est automatique vs manuel

| Étape | Automatique ? |
|---|---|
| Recherche de niche (Serper.dev, crédits gratuits) | ✅ auto |
| Scraping du site + extraction/devine d'email | ✅ auto |
| Scoring de l'opportunité (Claude) | ✅ auto |
| Rédaction email + LinkedIn (Claude) | ✅ auto |
| Sauvegarde CRM (Supabase) | ✅ auto |
| Envoi de l'email (score ≥ `AUTO_SEND_MIN_SCORE`, 85 par défaut) | ✅ **auto, zéro intervention** |
| Envoi de l'email (score entre 75 et le seuil) | ❌ manuel — `POST /leads/:id/approve` puis envoi auto au run suivant |
| Envoi du message LinkedIn | ❌ jamais auto (pas d'intégration LinkedIn) — reste un draft |

Le cron (`GET /cron/run`, déclenché toutes les heures par GitHub Actions —
voir "Déploiement + automatisation") enchaîne tout : recherche → scoring →
rédaction → envoi, dans le même appel. Garde-fous non désactivables par
défaut :
- **Plafonds quotidien et horaire** `DAILY_SEND_LIMIT` / `HOURLY_SEND_LIMIT`
  — protègent la réputation d'expéditeur d'un domaine encore jeune (voir
  "Montée en charge" plus bas pour le calendrier recommandé).
- **Lien de désabonnement** ajouté automatiquement à chaque email envoyé
  (répondre "STOP") — c'est une exigence légale de base pour du cold email
  B2B en France, pas juste une option.
- Seuls les leads **score ≥ 85** partent sans relecture. En dessous (75-84),
  ils restent en CRM en attente d'une approbation manuelle si tu veux quand
  même les contacter.

Ajuste `AUTO_SEND_MIN_SCORE` et `DAILY_SEND_LIMIT` dans `.env` selon ta
tolérance au risque — mais ne les retire pas sans le vouloir vraiment : voir
l'avertissement dans `CLAUDE.md`.

## Limites connues (V1)

- **Recherche** : Serper.dev, crédits gratuits à l'inscription (le pipeline
  n'en consomme qu'un par exécution). Passe à un palier payant si le volume
  devient un problème. (Trois approches essayées avant : DuckDuckGo scraping
  — bloqué, 403, depuis les IPs cloud/datacenter comme Vercel ; Brave Search
  API — désormais payant même pour le "gratuit" ; Google Custom Search API —
  exige un projet Google Cloud avec facturation activée même sous le quota
  gratuit.)
- **Emails** : d'abord cherchés en clair sur le site (contact, mentions
  légales, mailto:). S'il n'y en a pas, un pattern est deviné
  (`prenom.nom@domaine.com`, etc.) à partir d'un nom/rôle détecté sur le site
  — **non vérifié**, marqué `email_guessed: true` en CRM. Attends-toi à un
  taux de bounce plus élevé que sur ces adresses-là.

## Setup

```bash
cp .env.example .env   # remplis SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, SERPER_API_KEY, SMTP_*, VERZO_SECRET
npm install
```

Crée la table CRM une fois dans ton projet Supabase :

```bash
# Contenu de db/schema.sql, à coller dans l'éditeur SQL Supabase
```

Envoi SMTP : utilise n'importe quelle vraie boîte mail.
- **Hostinger** (ou tout hébergeur mail pro) : dans le panel, cherche "Configurer le client de messagerie" / "manual setup" pour ta boîte — ça donne host/port SMTP. Typiquement `smtp.hostinger.com` port `465`, mot de passe = celui de la boîte mail.
- **Gmail** : active la double authentification, puis génère un "App Password" sur https://myaccount.google.com/apppasswords (pas ton mot de passe de connexion). Host `smtp.gmail.com`, port `465`.

## Usage en local

```bash
# 1. Lancer une recherche + qualification + rédaction pour une niche
#    (n'envoie rien : npm run pipeline ne fait que sourcing+drafting)
npm run pipeline -- "cabinet de recrutement Paris"

# 2. Voir les leads qualifiés (score > 75) et leurs drafts
npm start   # démarre le serveur sur :3001
curl -H "x-verzo-secret: $VERZO_SECRET" "http://localhost:3001/leads?status=QUALIFIED"

# 3. (optionnel) Approuver un lead sous le seuil d'auto-envoi
curl -X POST -H "x-verzo-secret: $VERZO_SECRET" \
  "http://localhost:3001/leads/<id>/approve"

# 4. Envoyer (auto-envoie les scores >= AUTO_SEND_MIN_SCORE + les leads approuvés)
npm run send

# En prod (via /run ou /cron/run), les étapes 1 et 4 sont enchaînées automatiquement.
```

## Déploiement + automatisation

Importe ce repo directement sur Vercel (root directory par défaut, pas de
sous-dossier à sélectionner) avec les mêmes variables d'env que
`.env.example`.

### Planification horaire (GitHub Actions)

Vercel Hobby ne permet qu'un cron par jour max — insuffisant pour un rythme
horaire. La planification se fait donc via GitHub Actions
(`.github/workflows/hourly-outreach.yml`), gratuit et sans cette limite :

1. Dans les **Settings** du repo GitHub → **Secrets and variables → Actions**
   → ajoute un secret `CRON_SECRET` avec la même valeur que celle mise dans
   Vercel.
2. Le workflow appelle `GET /cron/run` du lundi au vendredi, environ toutes
   les heures entre 8h et 18h (heure de Paris — voir le commentaire dans le
   fichier pour la nuance UTC/été-hiver). Ajuste l'expression cron dans le
   fichier si besoin.
3. Chaque exécution : sourcing (niche choisie au hasard parmi
   `DEFAULT_NICHE_QUERIES`) → scoring → rédaction → **envoi** des leads
   éligibles, plafonné par `HOURLY_SEND_LIMIT` et `DAILY_SEND_LIMIT`.
4. Tu peux aussi déclencher un run manuellement depuis l'onglet **Actions**
   du repo GitHub (bouton "Run workflow").

### Montée en charge

`verzo.studio` est un domaine d'envoi tout jeune — monter direct à pleine
vitesse (15/h, 150/jour) risque de le faire flaguer spam. Calendrier suggéré,
à ajuster selon ce que tu observes (taux de bounce, plaintes spam si visibles
depuis le panel Hostinger) :

| Semaine | `DAILY_SEND_LIMIT` | `HOURLY_SEND_LIMIT` |
|---|---|---|
| 1 (défaut actuel) | 25 | 5 |
| 2 | 60 | 8 |
| 3 | 100 | 12 |
| 4+ (cible) | 150 | 15 |

Change ces deux variables dans Vercel, redeploy, pas besoin de toucher au
code.

## Structure

```
verzo-sale-agent/
├── CLAUDE.md              # règles de l'agent (ICP, workflow, règles d'envoi)
├── data/icp.md             # critères de qualification
├── prompts/                 # prompts de référence (utilisés comme doc, pas exécutés tel quel)
├── db/schema.sql            # table Supabase `leads`
├── src/
│   ├── search.js            # recherche de niche (Serper.dev)
│   ├── scrape.js             # scraping site + extraction/devine d'email
│   ├── qualify.js            # scoring via Claude (data/icp.md)
│   ├── draft.js               # rédaction email/LinkedIn via Claude, ou template fixe si EMAIL_TEMPLATE_BODY est défini
│   ├── mailer.js              # envoi SMTP des leads approuvés
│   ├── pipeline.js            # orchestration search → scrape → qualify → draft → save
│   └── index.js                # serveur Express (endpoints manuels + cron)
├── scripts/                  # wrappers CLI (npm run pipeline / npm run send)
├── public/dashboard.html     # dashboard mobile (voir section ci-dessus)
├── .github/workflows/         # planification horaire (GitHub Actions)
└── vercel.json               # déploiement
```

## Prochaine étape suggérée

Teste sur ~20 cabinets de conseil/recrutement (niche choisie), relis
manuellement les 5-10 premiers drafts avant d'approuver quoi que ce soit.
Si la qualité des scores et des messages est bonne sans trop de correction,
augmente le volume — et seulement à ce moment-là, envisage de passer à une
API d'email finder payante (Hunter.io/Apollo) pour remplacer le pattern
guessing.
