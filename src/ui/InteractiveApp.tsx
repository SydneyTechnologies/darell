import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import type { DarellConfig } from '../core/config.js';
import { createClient, resolveModel } from '../core/openai.js';

export type InteractiveAppProps = {
  config: DarellConfig;
  onExit?: () => void;
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const SYSTEM_PROMPT = [
  'You are Darell, an interactive CLI assistant.',
  'Be concise and helpful. Ask clarifying questions when needed.'
].join(' ');

export function InteractiveApp({ config, onExit }: InteractiveAppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', content: SYSTEM_PROMPT }
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientState = useMemo(() => {
    try {
      return { client: createClient(config), error: null as string | null };
    } catch (err) {
      return { client: null, error: String(err) };
    }
  }, [config]);

  useEffect(() => {
    if (clientState.error) setError(clientState.error);
  }, [clientState.error]);

  const visibleMessages = messages.filter((message) => message.role !== 'system');

  async function handleSubmit() {
    if (!input.trim() || busy) return;
    if (input.trim() === '/exit') {
      onExit?.();
      exit();
      return;
    }
    const nextUser: ChatMessage = { role: 'user', content: input.trim() };
    setInput('');
    setError(null);
    setBusy(true);

    const nextMessages = [...messages, nextUser];
    setMessages(nextMessages);

    if (!clientState.client) {
      setBusy(false);
      return;
    }
    const client = clientState.client;

    try {
      const response = await client.chat.completions.create({
        model: resolveModel(config),
        messages: nextMessages,
        temperature: 0.3
      });
      const content = response.choices[0]?.message?.content ?? '';
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">Darell Interactive</Text>
        <Text color="gray"> - type /exit to quit</Text>
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      <Box flexDirection="column">
        {visibleMessages.map((message, index) => (
          <Box key={`${message.role}-${index}`} flexDirection="column" marginBottom={1}>
            <Text color={message.role === 'user' ? 'green' : 'magenta'}>
              {message.role === 'user' ? 'You' : 'Darell'}:
            </Text>
            <Text color={message.role === 'user' ? 'green' : 'white'}>{message.content}</Text>
          </Box>
        ))}
      </Box>
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        placeholder={busy ? 'Thinking...' : 'Type a message'}
      />
      {busy ? <Text dimColor>Waiting for response...</Text> : null}
    </Box>
  );
}
