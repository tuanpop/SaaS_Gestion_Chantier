# Startup Studio Pipeline — SaaS_Gestion_Chantier

## Stack
[À remplir selon le projet]

## Commandes projet
- install : `npm install` / `pip install -r requirements.txt` / `dotnet restore`
- dev : `npm run dev` / `uvicorn main:app` / `dotnet run`
- test : `npm test` / `pytest` / `dotnet test`
- lint : `npm run lint` / `dotnet format`
- build : `npm run build` / `dotnet publish`

## Mémoire — chargement lazy

Au démarrage, l'index global et l'état projet sont chargés automatiquement.
Pour charger plus de contexte :
```
@memoria charge le contexte du projet
@memoria charge DECISIONS
@memoria charge TECH_CONTEXT
```
En fin de session, toujours mettre à jour :
```
@memoria mets à jour la mémoire après cette session
```

## Pipeline des agents

### Mode A — Greenfield (idée → app)
```
Sora → Makoto → Kira → Ryō
                         ↓
         Shinji (en premier — sa Decision Table est binding)
                         ↓
            Hana + Kakashi (en parallèle, après Shinji)
                         ↓
                      Itachi (Phase 3)
                         ↓
            Amelia PLAN → validation humaine → Amelia EXECUTE
                         ↓
            Tanjiro + Yuki (en parallèle avec Amelia EXECUTE)
                         ↓
                      Itachi (Phase 4)
                         ↓
                   Zoro → Levi
```

### Mode B — Onboarding projet existant
```
Gojo (analyse + produit tous les artifacts)
→ ensuite Mode C ou D disponibles
```

### Mode C — Nouvelle feature
```
Ryō (Mode C) → Shinji → Hana + Kakashi → Itachi → Amelia → Tanjiro → Itachi → Zoro → Levi
```

### Mode D — Debug standalone
```
Zoro (lit docs/bug_report.md)
```

## Gates humaines (HITL)

| # | Moment | Ce que tu fais |
|---|--------|----------------|
| 1 | Après Sora | Réponds aux questions dans le chat |
| 2 | Après Makoto | Valide GO/NO-GO dans market-research.md |
| 3 | Après Kira | Valide le scope MoSCoW dans product-requirements.md |
| 4 | Après Itachi Phase 3 | Lis coherence_phase3.md — corrige les FAIL |
| 5 | Après Amelia PLAN | **CRITIQUE** — valide IMPLEMENTATION_PLAN.md avant tout code |
| 6 | Après Itachi Phase 4 | Lis coherence_phase4.md — corrige les FAIL |
| 7 | Après deploy preview | **CRITIQUE** — valide l'URL preview avant prod |

**Règle absolue secrets** : ne jamais passer de clés API ou tokens à Claude. `.env.local` uniquement.

## Conventions
- Typage strict, zéro `any`
- Validation Zod sur toutes les routes API
- Tests : 1 happy path + 1 edge case minimum par feature
- Commits atomiques par task
- Logs : `lib/logger.ts` uniquement, jamais `console.log`

## Don't
- JAMAIS commiter des secrets
- JAMAIS skip Itachi avant de passer à la phase suivante
- JAMAIS modifier les tests pour les faire passer
- JAMAIS ajouter une dépendance sans la documenter dans DECISIONLOG.md
- JAMAIS déployer en prod sans validation humaine de la preview
- JAMAIS lancer Hana ou Kakashi avant que architecture.md de Shinji existe

## Agents disponibles
| Agent | Rôle | Modèle |
|-------|------|--------|
| @sora | Intake / clarification idée | sonnet |
| @makoto | Analyse marché | sonnet |
| @kira | PRD | sonnet |
| @ryo | Specs fonctionnelles + user stories | sonnet |
| @hana | UX / maquettes HTML | sonnet |
| @shinji | Architecture (binding downstream) | **opus** |
| @kakashi | Sécurité STRIDE | **opus** |
| @itachi | Quality Gate cohérence | sonnet |
| @amelia | Développement (plan + exécution) | sonnet |
| @tanjiro | DevOps / déploiement | sonnet |
| @yuki | LLM Engineer (si uses_llm) | sonnet |
| @zoro | Debugger | sonnet |
| @levi | QA / Tests | sonnet |
| @gojo | Onboarding projet existant | sonnet |
| @memoria | Gestionnaire mémoire | sonnet |

## Structure du projet
```
.claude/
├── agents/        ← 15 agents
├── hooks/         ← session-start, block-rm, lint-on-edit, require-tests
└── settings.json  ← hooks configurés

memory/            ← mémoire locale projet
├── PROJECT_STATE.md
├── DECISIONS.md
└── TECH_CONTEXT.md

docs/
├── IDEA.md        ← point de départ Mode A
├── CLARIFICATIONS.md ← réponses Sora
└── bug_report.md  ← point de départ Mode D

artifacts/
├── 01-market/     ← Makoto
├── 02-prd/        ← Kira
├── 03-specs/      ← Ryō
├── 04-ux/         ← Hana
├── 05-architecture/ ← Shinji
├── 06-security/   ← Kakashi
├── 07-code/       ← Amelia
├── 08-infra/      ← Tanjiro
├── 09-llm/        ← Yuki
├── 10-qa/         ← Levi
└── quality-gate/  ← Itachi

CLAUDE.md          ← ce fichier
DECISIONLOG.md     ← décisions architecturales
SESSIONLOG.md      ← historique sessions agents
```
