# Domain Agnostic Audit Findings

## Prompt Layer (`apps/bot/src/openai-prompts.ts`)

| Area | Previous issue | Status | Notes |
|---|---|---|---|
| Parser instructions | Explicit "masters" wording in core rule text | Fixed | Replaced by "specialists", kept `master_query` as API field compatibility note. |
| Few-shot examples | Beauty-oriented sample (`haircut`) | Fixed | Replaced with domain-neutral sample (`diagnostics`). |
| Input context labels | "Master" and "Available masters" hardcoded | Fixed | Switched to tenant terminology-driven specialist labels. |

## AI Orchestrator (`apps/bot/src/ai-orchestrator.ts`)

| Area | Previous issue | Status | Notes |
|---|---|---|---|
| Booking prompts | Hardcoded "master" in user-facing prompts | Fixed | User-facing prompts now use tenant specialist terminology. |
| Confirm summary | Hardcoded "Service/Master" labels | Fixed | Summary is rendered via tenant terminology (`service`, `specialist`, `appointment`). |
| Specialist selection flow | Forced specialist choice when multiple specialists exist | Fixed | Added flow mode support: `required` / `optional` / `hidden`. |
| Artifact rendering | Static list titles (`Services`, `Masters`) | Fixed | List titles now use tenant terminology labels. |

## Deterministic FSM (`apps/bot/src/whatsapp-conversation.ts`)

| Area | Previous issue | Status | Notes |
|---|---|---|---|
| Service prompt | Static "Select a service" and "Services" | Fixed | Uses tenant terminology for singular/plural service labels. |
| Specialist prompt | Static "Choose a master" and "Masters" | Fixed | Uses tenant terminology for specialist labels. |
| Confirm summary | Static "Service/Master" fields | Fixed | Uses tenant terminology in both IT/EN summaries. |
| Specialist-step behavior | Specialist step always required in deterministic branch | Fixed | Deterministic branch now respects `flowConfig.specialistSelection`. |
| Back navigation | `choose_date -> choose_master` always | Fixed | Now respects `specialistSelection` mode. |

## Tenant Config Mapping (`apps/bot/src/index.ts`)

| Area | Previous issue | Status | Notes |
|---|---|---|---|
| Config schema | No terminology/flow config parsing in bot runtime | Fixed | Added `botConfig.terminology` and `botConfig.flowConfig` normalization. |
| Deterministic dependency wiring | No tenant config in deterministic FSM | Fixed | Added `getTenantConfig` in deterministic deps. |

## Worker (`apps/worker/src/index.ts`)

| Area | Observation | Status | Notes |
|---|---|---|---|
| Reminder/notification text | Uses generic booking wording, no beauty-specific terminology | No action needed | Texts are already domain-neutral enough for stage 39 scope. |

## Remaining Open Items (Next Iterations)

| Item | Why it remains |
|---|---|
| Internal identifiers and tokens still use `master` (`master:*`, `choose_master`) | Kept intentionally for backward compatibility and to avoid migration risk in active sessions. |
| Optional localization fallback for terminology in other channels | Current scope implemented for WhatsApp bot flow only. |
| QA smoke matrix for 3-4 business domains | Requires execution scenarios/data setup on runtime environment. |
