# VERZO Sales Agent

Un pipeline autonome qui : cherche des entreprises dans une niche donnée →
scrape leur site (emails, décideurs) → note l'opportunité avec Claude →
rédige un email + message LinkedIn personnalisés → sauvegarde tout dans un
CRM Supabase. **Rien n'est envoyé sans validation humaine explicite** (voir
`CLAUDE.md`, règle non négociable).

C'est un projet Node autonome, indépendant du backend Solen (repo séparé).

## Ce qui est automatique vs manuel

| Étape | Automatique ? |
|---|---|
| Recherche de niche (DuckDuckGo, gratuit) | ✅ auto |
| Scraping du site + extraction/devine d'email | ✅ auto |
| Scoring de l'opportunité (Claude) | ✅ auto |
| Rédaction email + LinkedIn (Claude) | ✅ auto |
| Sauvegarde CRM (Supabase) | ✅ auto |
| **Validation avant envoi** | ❌ manuel — toi |
| Envoi effectif de l'email | ✅ auto, mais seulement pour les leads approuvés |

Tu peux planifier la recherche+scoring+rédaction en cron (tourne sans toi),
mais l'envoi reste bloqué tant que tu n'as pas approuvé chaque lead. C'est
volontaire : un premier envoi raté peut griller ta réputation d'expéditeur
avant même d'avoir un client.

## Limites connues (V1, gratuit)

- **Recherche** : scrape la page HTML de DuckDuckGo, pas d'API clé. Résultats
  parfois pauvres ou incomplets — passe à SerpAPI/Google CSE si le volume
  devient un problème.
- **Emails** : d'abord cherchés en clair sur le site (contact, mentions
  légales, mailto:). S'il n'y en a pas, un pattern est deviné
  (`prenom.nom@domaine.com`, etc.) à partir d'un nom/rôle détecté sur le site
  — **non vérifié**, marqué `email_guessed: true` en CRM. Attends-toi à un
  taux de bounce plus élevé que sur ces adresses-là.

## Setup

```bash
cp .env.example .env   # remplis SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, VERZO_SECRET
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
npm run pipeline -- "cabinet de recrutement Paris"

# 2. Voir les leads qualifiés (score > 75) et leurs drafts
npm start   # démarre le serveur sur :3001
curl -H "x-verzo-secret: $VERZO_SECRET" "http://localhost:3001/leads?status=QUALIFIED"

# 3. Approuver un lead après relecture du draft (email_draft / linkedin_draft)
curl -X POST -H "x-verzo-secret: $VERZO_SECRET" \
  "http://localhost:3001/leads/<id>/approve"

# 4. Envoyer les emails des leads approuvés
npm run send
```

## Déploiement + automatisation (optionnel)

Importe ce repo directement sur Vercel (root directory par défaut, pas de
sous-dossier à sélectionner) avec les mêmes variables d'env que
`.env.example`, plus `CRON_SECRET` (nom exact requis :
Vercel envoie alors automatiquement `Authorization: Bearer <CRON_SECRET>` sur
les appels cron, sans config supplémentaire).

Le cron déclenche `GET /cron/run` (niche fixée par `DEFAULT_NICHE_QUERY`) du
lundi au vendredi à 7h UTC — ajuste l'expression cron dans `vercel.json`
selon ton besoin. Il ne fait que sourcing + scoring + rédaction : l'envoi
reste manuel via `/leads/:id/approve` puis `/send-approved`.

## Structure

```
verzo-sales-agent/
├── CLAUDE.md              # règles de l'agent (ICP, workflow, règle d'approbation)
├── data/icp.md             # critères de qualification
├── prompts/                 # prompts de référence (utilisés comme doc, pas exécutés tel quel)
├── db/schema.sql            # table Supabase `leads`
├── src/
│   ├── search.js            # recherche de niche (DuckDuckGo, gratuit)
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
