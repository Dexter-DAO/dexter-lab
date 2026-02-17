import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { LanguageModelV1 } from '~/lib/modules/llm/ai-sdk-stub';
import { createAnthropic } from '~/lib/modules/llm/ai-sdk-stub';
import type { IProviderSetting } from '~/types/model';

export default class AnthropicProvider extends BaseProvider {
  name = 'Anthropic';
  getApiKeyLink = 'https://console.anthropic.com/settings/keys';

  config = {
    baseUrlKey: 'ANTHROPIC_API_BASE_URL',
    apiTokenKey: 'ANTHROPIC_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /*
     * Claude 4.6 - Latest flagship
     */
    // Claude Opus 4.6: Most intelligent model, 200K context (1M beta), 128K output
    {
      name: 'claude-opus-4-6',
      label: 'Claude Opus 4.6',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 128000,
    },

    /*
     * Claude 4.5 Models
     */
    // Claude Sonnet 4.5: Fast and capable, 200K context (1M beta), 64K output
    {
      name: 'claude-sonnet-4-5-20250929',
      label: 'Claude Sonnet 4.5',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 64000,
    },

    // Claude Haiku 4.5: Fastest near-frontier model, 200K context, 64K output
    {
      name: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 64000,
    },

    // Claude Opus 4.5: Previous flagship
    {
      name: 'claude-opus-4-5-20251101',
      label: 'Claude Opus 4.5',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 32000,
    },

    /*
     * Claude 3.5 Models - Stable fallbacks
     */
    {
      name: 'claude-3-5-sonnet-20241022',
      label: 'Claude 3.5 Sonnet',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 128000,
    },

    {
      name: 'claude-3-haiku-20240307',
      label: 'Claude 3 Haiku',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 128000,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'ANTHROPIC_API_BASE_URL',
      defaultApiTokenKey: 'ANTHROPIC_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const fetchBase = baseUrl || 'https://api.anthropic.com';

    const response = await fetch(`${fetchBase}/v1/models`, {
      headers: {
        'x-api-key': `${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
    });

    const res = (await response.json()) as any;
    const staticModelIds = this.staticModels.map((m) => m.name);

    const data = res.data.filter((model: any) => model.type === 'model' && !staticModelIds.includes(model.id));

    return data.map((m: any) => {
      // Get accurate context window from Anthropic API
      let contextWindow = 32000; // default fallback

      // Anthropic provides max_tokens in their API response
      if (m.max_tokens) {
        contextWindow = m.max_tokens;
      } else if (m.id?.includes('claude-3-5-sonnet')) {
        contextWindow = 200000; // Claude 3.5 Sonnet has 200k context
      } else if (m.id?.includes('claude-3-haiku')) {
        contextWindow = 200000; // Claude 3 Haiku has 200k context
      } else if (m.id?.includes('claude-3-opus')) {
        contextWindow = 200000; // Claude 3 Opus has 200k context
      } else if (m.id?.includes('claude-3-sonnet')) {
        contextWindow = 200000; // Claude 3 Sonnet has 200k context
      }

      // Determine completion token limits based on specific model
      let maxCompletionTokens = 128000; // default

      if (m.id?.includes('claude-opus-4-6')) {
        maxCompletionTokens = 128000; // Claude Opus 4.6: 128K output
      } else if (m.id?.includes('claude-opus-4')) {
        maxCompletionTokens = 32000; // Claude Opus 4.5 and earlier: 32K output
      } else if (m.id?.includes('claude-sonnet-4') || m.id?.includes('claude-haiku-4')) {
        maxCompletionTokens = 64000; // Claude Sonnet/Haiku 4.x: 64K output
      }

      return {
        name: m.id,
        label: `${m.display_name} (${Math.floor(contextWindow / 1000)}k context)`,
        provider: this.name,
        maxTokenAllowed: contextWindow,
        maxCompletionTokens,
      };
    });
  }

  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => LanguageModelV1 = (options) => {
    const { apiKeys, providerSettings, serverEnv, model } = options;
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'ANTHROPIC_API_BASE_URL',
      defaultApiTokenKey: 'ANTHROPIC_API_KEY',
    });
    const anthropic = createAnthropic({
      baseURL: baseUrl || 'https://api.anthropic.com',
      apiKey,
      headers: { 'anthropic-beta': 'output-128k-2025-02-19' },
    });

    return anthropic(model);
  };
}
