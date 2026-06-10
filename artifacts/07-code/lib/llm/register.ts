// lib/llm/register.ts — Enregistrement de la factory AnthropicClient
// Import ce fichier depuis les handlers Node qui utilisent getLLMClient().
// Ne pas importer depuis les composants client ou Edge routes.
// D-5-001 : ADR factory pattern — évite le bundling de @anthropic-ai/sdk côté Edge.

import { AnthropicClient } from './anthropic'
import { registerLLMClientFactory } from './client'

// Enregistrement de la factory au chargement du module
// (side-effect d'import — Node.js module cache garantit l'unicité)
registerLLMClientFactory(() => new AnthropicClient())
