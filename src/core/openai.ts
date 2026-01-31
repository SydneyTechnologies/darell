import OpenAI from 'openai';
import type { DarellConfig } from './config.js';

export function createClient(config: DarellConfig): OpenAI {
  if (!config.apiKey) {
    throw new Error('Missing OpenAI API key. Run `darell configure` or set OPENAI_API_KEY.');
  }
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    organization: config.organization
  });
}

export function resolveModel(config: DarellConfig): string {
  return config.model || 'gpt-4o-mini';
}

export async function listModels(config: DarellConfig): Promise<string[]> {
  if (!config.apiKey) {
    throw new Error('Missing OpenAI API key. Run `darell configure` or set OPENAI_API_KEY.');
  }
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(config.organization ? { 'OpenAI-Organization': config.organization } : {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to load models (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { data?: Array<{ id?: string }> };
  return (json.data || []).map((item) => item.id).filter((id): id is string => Boolean(id)).sort();
}
