import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type DarellConfig = {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  model?: string;
  autoApprove?: boolean;
};

export function getConfigDir(): string {
  return path.join(os.homedir(), '.darell');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config');
}

export async function loadConfig(): Promise<DarellConfig> {
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf8');
    return JSON.parse(raw) as DarellConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function saveConfig(config: DarellConfig): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2));
}

export async function resolveConfig(overrides: DarellConfig = {}): Promise<DarellConfig> {
  const fileConfig = await loadConfig();
  return { ...fileConfig, ...overrides };
}

export function redactConfig(config: DarellConfig): DarellConfig {
  if (!config.apiKey) return { ...config };
  return { ...config, apiKey: `***${config.apiKey.slice(-4)}` };
}
