import readline from 'node:readline';

export async function confirmAction(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} (y/N): `, (value) => resolve(value));
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
