import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

/**
 * LLM abstraction. 'mock' returns deterministic, rule-based text so the WOW
 * Genie works offline and in tests; 'openai' calls a real chat completion API.
 * Both implement the same interface (selected via AI_PROVIDER).
 */
export interface AiProvider {
  complete(prompt: string): Promise<string>;
}

@Injectable()
export class MockAiProvider implements AiProvider {
  async complete(prompt: string): Promise<string> {
    return `WOW Genie (mock): Here's guidance based on "${prompt.slice(0, 80)}". Set AI_PROVIDER=openai with an API key for full AI responses.`;
  }
}

@Injectable()
export class OpenAiProvider implements AiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  async complete(prompt: string): Promise<string> {
    const { apiKey, model, baseUrl } = this.cfg.ai;
    if (!apiKey) return 'WOW Genie is not configured (missing AI_API_KEY).';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are WOW Genie, a concise Indian wedding planning assistant.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      this.logger.error(`OpenAI call failed: ${res.status}`);
      throw new Error('AI provider request failed');
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

export const AI_PROVIDER = 'AI_PROVIDER';

export const aiProviderFactory = {
  provide: AI_PROVIDER,
  inject: [AppConfigService, MockAiProvider, OpenAiProvider],
  useFactory: (cfg: AppConfigService, mock: MockAiProvider, openai: OpenAiProvider): AiProvider =>
    cfg.ai.provider === 'openai' ? openai : mock,
};
