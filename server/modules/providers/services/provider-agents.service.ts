import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type {
  ProviderAgent,
  ProviderAgentListOptions,
} from '@/shared/types.js';

export const providerAgentsService = {
  /**
   * Lists custom agents visible to one provider.
   *
   * Only providers with an agents facet (OpenCode today) report records;
   * everything else resolves to an empty list so callers need no
   * per-provider branching.
   */
  async listProviderAgents(
    providerName: string,
    options?: ProviderAgentListOptions,
  ): Promise<ProviderAgent[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.agents?.listAgents(options) ?? [];
  },
};
