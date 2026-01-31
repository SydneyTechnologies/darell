import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { AgentApp } from './AgentApp.js';
import { InitApp } from './InitApp.js';
import { InteractiveApp } from './InteractiveApp.js';
import { resolveConfig } from '../core/config.js';

export type CliAppProps = {
  argv: string[];
};

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const args: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (value.startsWith('--')) {
      const [key, inlineValue] = value.slice(2).split('=');
      if (inlineValue !== undefined) {
        args[key] = inlineValue;
      } else {
        const next = rest[i + 1];
        if (next && !next.startsWith('-')) {
          args[key] = next;
          i += 1;
        } else {
          args[key] = true;
        }
      }
    } else if (value.startsWith('-')) {
      const flags = value.slice(1).split('');
      for (const flag of flags) args[flag] = true;
    } else {
      positionals.push(value);
    }
  }

  return { command, args, positionals };
}

export function CliApp({ argv }: CliAppProps) {
  const { exit } = useApp();
  const parsed = useMemo(() => parseArgs(argv), [argv]);
  const command = parsed.command === '-i' ? 'interactive' : parsed.command;
  const { args, positionals } = parsed;
  const [config, setConfig] = useState<Awaited<ReturnType<typeof resolveConfig>> | null>(null);

  useEffect(() => {
    resolveConfig().then(setConfig).catch((error) => {
      console.error(String(error));
      exit(new Error(String(error)));
    });
  }, [exit]);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>Usage:</Text>
        <Text>  darell configure</Text>
        <Text>  darell interactive</Text>
        <Text>  darell -i</Text>
        <Text>  darell agent "task"</Text>
        <Text>Options:</Text>
        <Text>  --root &lt;path&gt;  Workspace root for agent</Text>
        <Text>  --model &lt;name&gt; Model override</Text>
        <Text>  -y, --yes       Auto-approve agent actions</Text>
      </Box>
    );
  }

  if (command === 'configure') {
    return <InitApp onComplete={() => exit()} />;
  }

  if (command === 'interactive') {
    if (!config) return <Text>Loading config...</Text>;
    return <InteractiveApp config={config} onExit={() => exit()} />;
  }

  if (command === 'agent') {
    console.log('config', config);
    if (!config) return <Text>Loading config...</Text>;
    const task = positionals.join(' ');
    if (!task) {
      return <Text>Provide a task. Example: darell agent "rename README to README.md"</Text>;
    }
    const root = typeof args.root === 'string' ? args.root : process.cwd();
    const model = typeof args.model === 'string' ? args.model : undefined;
    const autoApprove = Boolean(args.yes || args.y);

    return (
      <AgentApp
        task={task}
        root={root}
        config={{ ...config, model }}
        autoApprove={autoApprove || config.autoApprove}
        onComplete={() => exit()}
      />
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Unknown command: {command}</Text>
      <Text>Run `darell help` to see available commands.</Text>
    </Box>
  );
}
