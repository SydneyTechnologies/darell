import React, { useMemo, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import type { DarellConfig } from '../core/config.js';
import { runAgent, type AgentAction, type AgentEvent } from '../core/agent.js';
import os from 'node:os';
import { resolveModel } from '../core/openai.js';

export type InteractiveAppProps = {
  config: DarellConfig;
  onExit?: () => void;
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  kind?: 'action' | 'result' | 'error' | 'text';
};

const SYSTEM_PROMPT = [
  'You are Darell, an interactive CLI assistant.',
  `Operating system: ${os.platform()} ${os.release()} (${os.arch()}).`,
  'Be concise and helpful. Ask clarifying questions when needed.'
].join(' ');

const TOOL_LIST = [
  'read_file',
  'write_file',
  'append_file',
  'create_file',
  'delete_file',
  'replace_in_file',
  'list_dir',
  'file_info',
  'search_files',
  'apply_patch',
  'move_file',
  'rename_file',
  'shell_command',
  'git'
];

export function InteractiveApp({ config, onExit }: InteractiveAppProps) {
  const { exit } = useApp();
  const modelName = useMemo(() => resolveModel(config), [config]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'system', content: SYSTEM_PROMPT }
  ]);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [sessionCost, setSessionCost] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AgentAction | null>(null);
  const [confirmValue, setConfirmValue] = useState('');
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const visibleMessages = messages.filter((message) => message.role !== 'system');

  const formatUsd = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return 'n/a';
    if (value === 0) return '$0.00';
    if (value < 0.01) return `$${value.toFixed(6)}`;
    if (value < 1) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
  };

  const handleEvent = (event: AgentEvent) => {
    if (event.type === 'info' || event.type === 'plan') return;
    if (event.type === 'usage') {
      if (event.usage.phase === 'run') {
        const runCost =
          'cost' in event.usage ? (event.usage as { cost?: number }).cost : undefined;
        setLastCost(typeof runCost === 'number' ? runCost : null);
        if (typeof runCost === 'number') {
          setSessionCost((prev) => (prev === null ? runCost : prev + runCost));
        }
      }
      return;
    }
    if (event.type === 'action') {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `→ ${event.message}`, kind: 'action' }
      ]);
      return;
    }
    if (event.type === 'error') {
      setMessages((prev) => [...prev, { role: 'assistant', content: event.message, kind: 'error' }]);
      return;
    }
    setMessages((prev) => [...prev, { role: 'assistant', content: event.message, kind: 'result' }]);
  };

  async function handleSubmit() {
    if (!input.trim() || busy) return;
    const trimmed = input.trim();
    if (trimmed === '/exit') {
      onExit?.();
      exit();

      return;
    }
    if (trimmed === '/tools') {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Available tools: ${TOOL_LIST.join(', ')}` }
      ]);
      setInput('');
      return;
    }
    if (trimmed === '/help') {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Commands: /tools, /exit, /help'
        }
      ]);
      setInput('');
      return;
    }
    const nextUser: ChatMessage = { role: 'user', content: trimmed };
    setInput('');
    setError(null);
    setBusy(true);

    setMessages((prev) => [...prev, nextUser]);

    try {
      const history = [...messages, nextUser]
        .filter(
          (message) =>
            message.role === 'user' ||
            (message.role === 'assistant' &&
              (message.kind === 'result' || message.kind === 'text'))
        )
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content
        }));

      await runAgent({
        task: trimmed,
        root: process.cwd(),
        config,
        autoApprove: config.autoApprove,
        history,
        confirm: (action) =>
          new Promise((resolve) => {
            resolverRef.current = resolve;
            setPending(action);
            setConfirmValue('');
            setBusy(false);
          }),
        onEvent: handleEvent
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box
        width="100%"
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        paddingY={1}
        marginBottom={1}
      >
        <Text color="white"># Darell Interactive</Text>
      </Box>
      <Box width="100%" flexDirection="column" gap={1} marginBottom={1}>
        {visibleMessages.map((message, index) => (
          <Box key={`${message.role}-${index}`} flexDirection="column" gap={1}>
            <Text color="gray">{message.role === 'user' ? 'You' : 'Darell'}</Text>
            <Text>{message.content}</Text>
          </Box>
        ))}
      </Box>

      {error ? <Text color="red">{error}</Text> : null}
      {pending ? <Text color="yellow">Approve {pending.type}? Type y or n and press Enter.</Text> : null}

      <Box borderStyle="round" borderColor="gray" paddingX={2} paddingY={1} width="100%">
        {pending ? (
          <Box>
            <Text color="gray">{'>'} </Text>
            <TextInput
              value={confirmValue}
              onChange={setConfirmValue}
              onSubmit={(value) => {
                const answer = value.trim().toLowerCase();
                if (answer.startsWith('y')) {
                  setBusy(true);
                  resolverRef.current?.(true);
                } else if (answer.startsWith('n')) {
                  setBusy(true);
                  resolverRef.current?.(false);
                } else {
                  setError('Please enter y or n.');
                  return;
                }
                resolverRef.current = null;
                setPending(null);
                setConfirmValue('');
              }}
              placeholder="y or n"
            />
          </Box>
        ) : (
          <Box>
            <Text color="gray">{'>'} </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder={busy ? 'Thinking...' : 'Type a message'}
            />
          </Box>
        )}
      </Box>

      <Box flexDirection="row" justifyContent="space-between" paddingTop={1}>
        <Text color="gray">
          OpenAI {modelName} · last {formatUsd(lastCost)} · session {formatUsd(sessionCost)}
        </Text>
        <Text color="gray">esc interrupt</Text>
      </Box>
      {busy ? <Text color="blue">Thinking…</Text> : null}
    </Box>
  );
}
