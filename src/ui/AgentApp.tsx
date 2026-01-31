import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DarellConfig } from '../core/config.js';
import { runAgent, type AgentAction, type AgentEvent } from '../core/agent.js';

export type AgentAppProps = {
  task: string;
  root: string;
  config: DarellConfig;
  autoApprove?: boolean;
  onComplete?: () => void;
};

export function AgentApp(props: AgentAppProps) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [status, setStatus] = useState('Starting');
  const [pending, setPending] = useState<AgentAction | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  useInput((input, key) => {
    if (!pending) return;
    if (input.toLowerCase() === 'y') {
      resolverRef.current?.(true);
      resolverRef.current = null;
      setPending(null);
    } else if (input.toLowerCase() === 'n' || key.escape) {
      resolverRef.current?.(false);
      resolverRef.current = null;
      setPending(null);
    }
  });

  useEffect(() => {
    let mounted = true;
    runAgent({
      task: props.task,
      root: props.root,
      config: props.config,
      autoApprove: props.autoApprove,
      confirm: (action) =>
        new Promise((resolve) => {
          if (!mounted) return resolve(false);
          resolverRef.current = resolve;
          setPending(action);
        }),
      onEvent: (event) => {
        if (!mounted) return;
        setEvents((prev) => [...prev, event].slice(-12));
        setStatus(event.type);
      }
    })
      .then(() => {
        if (mounted) setStatus('done');
        props.onComplete?.();
      })
      .catch((error) => {
        if (mounted) setEvents((prev) => [...prev, { type: 'error', message: String(error) }]);
        if (mounted) setStatus('error');
        props.onComplete?.();
      });

    return () => {
      mounted = false;
    };
  }, [props.task, props.root, props.config, props.autoApprove, props.onComplete]);

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Agent status: {status}</Text>
      {pending ? (
        <Text>
          Approve {pending.type}? Press y/n.
        </Text>
      ) : null}
      <Box flexDirection="column">
        {events.map((event, index) => (
          <Text key={`${event.type}-${index}`}>[{event.type}] {event.message}</Text>
        ))}
      </Box>
    </Box>
  );
}
