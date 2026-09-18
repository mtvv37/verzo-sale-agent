# VERZO Sales Agent

Un pipeline autonome qui : cherche des entreprises dans une niche donnée →
scrape leur site (emails, décideurs) → note l'opportunité avec Claude →
rédige un email + message LinkedIn personnalisés → sauvegarde tout dans un
CRM Supabase → **envoie automatiquement l'email** pour les leads à haut score,
sans clic humain (voir `CLAUDE.md`, section "SENDING").

C'est un projet Node autonome, indépendant du backend Solen (repo séparé).

## Ce qui est automatique vs manuel

| Étape | Automatique ? |
|---|---|
| Recherche de niche (Google Custom Search, gratuit) | ✅ auto |
| Scraping du site + extraction/devine d'email | ✅ auto |
| Scoring de l'opportunité (Claude) | ✅ auto |
| Rédaction email + LinkedIn (Claude) | ✅ auto |
| Sauvegarde CRM (Supabase) | ✅ auto |
| Envoi de l'email (score ≥ `AUTO_SEND_MIN_SCORE`, 85 par défaut) | ✅ **auto, zéro intervention** |
| Envoi de l'email (score entre 75 et le seuil) | ❌ manuel — `POST /leads/:id/approve` puis envoi auto au run suivant |
| Envoi du message LinkedIn | ❌ jamais auto (pas d'intégration LinkedIn) — reste un draft |

Le cron (`GET /cron/run`) enchaîne tout : recherche → scoring → rédaction →
envoi, dans le même appel. Garde-fous non désactivables par défaut :
- **Plafond quotidien** `DAILY_SEND_LIMIT` (10/jour par défaut) — protège ta
  réputation d'expéditeur (un compte Gmail perso qui envoie en masse sans
  historique de chauffe se fait vite flag spam).
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

- **Recherche** : Google Custom Search API, 100 requêtes/jour gratuites (le
  pipeline n'en consomme qu'une par exécution). Passe à un palier payant ou
  à SerpAPI si le volume devient un problème. (Deux approches essayées
  avant : DuckDuckGo scraping — bloqué, 403, depuis les IPs cloud/datacenter
  comme Vercel ; Brave Search API — désormais payant même pour le "gratuit".)
- **Emails** : d'abord cherchés en clair sur le site (contact, mentions
  légales, mailto:). S'il n'y en a pas, un pattern est deviné
  (`prenom.nom@domaine.com`, etc.) à partir d'un nom/rôle détecté sur le site
  — **non vérifié**, marqué `email_guessed: true` en CRM. Attends-toi à un
  taux de bounce plus élevé que sur ces adresses-là.

## Setup

```bash
cp .env.example .env   # remplis SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GOOGLE_CSE_API_KEY, GOOGLE_CSE_CX, GMAIL_USER, GMAIL_APP_PASSWORD, VERZO_SECRET
npm install
```

Crée la table CRM une fois dans ton projet Supabase :

```bash
# Contenu de db/schema.sql, à coller dans l'éditeur SQL Supabase
```

Gmail : active la double authentification sur le compte utilisé, puis génère
un "App Password" sur https://myaccount.google.com/apppasswords — c'est ça
qui va dans `GMAIL_APP_PASSWORD` (pas ton mot de passe de connexion).

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

## Déploiement + automatisation (optionnel)

Importe ce repo directement sur Vercel (root directory par défaut, pas de
sous-dossier à sélectionner) avec les mêmes variables d'env que
`.env.example`, plus `CRON_SECRET` (nom exact requis :
Vercel envoie alors automatiquement `Authorization: Bearer <CRON_SECRET>` sur
les appels cron, sans config supplémentaire).

Le cron déclenche `GET /cron/run` (niche fixée par `DEFAULT_NICHE_QUERY`) du
lundi au vendredi à 7h UTC — ajuste l'expression cron dans `vercel.json`
selon ton besoin. Il fait tout : sourcing, scoring, rédaction, **et envoi**
des leads à haut score, sans intervention.

## Structure

```
verzo-sale-agent/
├── CLAUDE.md              # règles de l'agent (ICP, workflow, règles d'envoi)
├── data/icp.md             # critères de qualification
├── prompts/                 # prompts de référence (utilisés comme doc, pas exécutés tel quel)
├── db/schema.sql            # table Supabase `leads`
├── src/
│   ├── search.js            # recherche de niche (Google Custom Search)
│   ├── scrape.js             # scraping site + extraction/devine d'email
│   ├── qualify.js            # scoring via Claude (data/icp.md)
│   ├── draft.js               # rédaction email/LinkedIn via Claude
│   ├── mailer.js              # envoi Gmail des leads approuvés
│   ├── pipeline.js            # orchestration search → scrape → qualify → draft → save
│   └── index.js                # serveur Express (endpoints manuels + cron)
├── scripts/                  # wrappers CLI (npm run pipeline / npm run send)
└── vercel.json               # déploiement + cron optionnels
```

## Prochaine étape suggérée

Teste sur ~20 cabinets de conseil/recrutement (niche choisie), relis
manuellement les 5-10 premiers drafts avant d'approuver quoi que ce soit.
Si la qualité des scores et des messages est bonne sans trop de correction,
augmente le volume — et seulement à ce moment-là, envisage de passer à une
API d'email finder payante (Hunter.io/Apollo) pour remplacer le pattern
guessing.
