import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { loadConfig, saveConfig, getConfigPath, type DarellConfig } from '../core/config.js';
import { listModels } from '../core/openai.js';

type Field = {
  label: string;
  key: keyof DarellConfig;
  placeholder?: string;
};

const fields: Field[] = [
  { label: 'OpenAI API key', key: 'apiKey' },
  { label: 'Base URL (optional)', key: 'baseUrl', placeholder: 'https://api.openai.com/v1' },
  { label: 'Organization ID (optional)', key: 'organization' },
  { label: 'Default model (optional)', key: 'model', placeholder: 'gpt-4o-mini' },
  { label: 'Auto-approve actions? (true/false)', key: 'autoApprove' }
];

export function InitApp({ onComplete }: { onComplete?: () => void }) {
  const { exit } = useApp();
  const [currentConfig, setCurrentConfig] = useState<DarellConfig>({});
  const [fieldIndex, setFieldIndex] = useState(0);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setModelList(null);
    setModelError(null);
  }, [currentConfig.apiKey, currentConfig.baseUrl, currentConfig.organization]);

  useEffect(() => {
    loadConfig().then((config) => {
      setCurrentConfig(config);
      const first = fields[0];
      const existing = config[first.key];
      if (typeof existing === 'string') setInput(existing);
      if (typeof existing === 'boolean') setInput(existing ? 'true' : 'false');
    });
  }, []);

  const field = fields[fieldIndex];
  const hint = useMemo(() => {
    if (!field) return '';
    const existing = currentConfig[field.key];
    if (field.key === 'apiKey' && typeof existing === 'string' && existing.length > 0) {
      return `Current: ***${existing.slice(-4)}`;
    }
    if (typeof existing === 'string' && existing.length > 0) {
      return `Current: ${existing}`;
    }
    if (typeof existing === 'boolean') {
      return `Current: ${existing ? 'true' : 'false'}`;
    }
    return field.placeholder ? `Example: ${field.placeholder}` : '';
  }, [field, currentConfig]);

  useEffect(() => {
    if (!field || field.key !== 'model') return;
    if (!currentConfig.apiKey) {
      setModelError('Provide an API key first to load models.');
      return;
    }
    if (modelList || loadingModels) return;
    setLoadingModels(true);
    listModels(currentConfig)
      .then((models) => {
        setModelList(models);
        setModelError(null);
      })
      .catch((error) => {
        setModelError(String(error));
      })
      .finally(() => {
        setLoadingModels(false);
      });
  }, [field, currentConfig, modelList, loadingModels]);

  if (done) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>Config saved to {getConfigPath()}</Text>
        <Text>Run `darell interactive` or `darell agent "your task"` to get started.</Text>
        <Text dimColor>Exiting...</Text>
      </Box>
    );
  }

  if (!field) {
    return <Text>Loading...</Text>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Configuration</Text>
      <Text>{field.label}</Text>
      {hint ? <Text dimColor>{hint}</Text> : null}
      {field.key === 'model' ? (
        <Box flexDirection="column">
          {loadingModels ? <Text dimColor>Loading models...</Text> : null}
          {modelError ? <Text color="red">{modelError}</Text> : null}
          {modelList && modelList.length > 0 ? (
            <Box flexDirection="column">
              <Text dimColor>Available models:</Text>
              {modelList.map((model) => (
                <Text key={model} dimColor>{model}</Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={async () => {
          if (saving) return;
          const nextConfig: DarellConfig = { ...currentConfig };
          const trimmed = input.trim();
          if (field.key === 'autoApprove') {
            if (trimmed.length > 0) {
              nextConfig.autoApprove = trimmed.toLowerCase() === 'true';
            }
          } else if (trimmed.length > 0) {
            nextConfig[field.key] = trimmed as never;
          }

          if (fieldIndex + 1 >= fields.length) {
            try {
              setSaving(true);
              await saveConfig(nextConfig);
              setDone(true);
              setTimeout(() => {
                onComplete?.();
                exit();
              }, 800);
            } catch (error) {
              console.error(String(error));
              setSaving(false);
            }
          } else {
            setCurrentConfig(nextConfig);
            const nextIndex = fieldIndex + 1;
            setFieldIndex(nextIndex);
            const nextField = fields[nextIndex];
            const existing = nextConfig[nextField.key];
            if (typeof existing === 'string') setInput(existing);
            else if (typeof existing === 'boolean') setInput(existing ? 'true' : 'false');
            else setInput('');
          }
        }}
      />
      <Text dimColor>Press Enter to continue. Input is visible in the terminal.</Text>
    </Box>
  );
}
