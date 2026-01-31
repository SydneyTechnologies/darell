import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export type ToolContext = {
  root: string;
  allowOutsideRoot?: boolean;
};

function expandHome(target: string): string {
  if (target === '~') return os.homedir();
  if (target.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), target.slice(2));
  }
  return target;
}

function resolveWithinRoot(root: string, target: string, allowOutsideRoot = true): string {
  const resolved = path.resolve(root, expandHome(target));
  const normalizedRoot = path.resolve(root);
  if (!allowOutsideRoot && !resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(`Path escapes root: ${target}`);
  }
  return resolved;
}

export async function moveFile(ctx: ToolContext, from: string, to: string): Promise<string> {
  const source = resolveWithinRoot(ctx.root, from, ctx.allowOutsideRoot);
  const dest = resolveWithinRoot(ctx.root, to, ctx.allowOutsideRoot);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(source, dest);
  return `Moved ${from} -> ${to}`;
}

export async function renameFile(ctx: ToolContext, from: string, to: string): Promise<string> {
  const source = resolveWithinRoot(ctx.root, from, ctx.allowOutsideRoot);
  const dest = resolveWithinRoot(ctx.root, to, ctx.allowOutsideRoot);
  await fs.rename(source, dest);
  return `Renamed ${from} -> ${to}`;
}

export async function readFile(ctx: ToolContext, target: string, start?: number, end?: number): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  const raw = await fs.readFile(resolved, 'utf8');
  if (start === undefined && end === undefined) return raw;
  const lines = raw.split(/\r?\n/);
  const from = Math.max(1, start ?? 1);
  const to = Math.min(lines.length, end ?? lines.length);
  return lines.slice(from - 1, to).join('\n');
}

export async function writeFile(ctx: ToolContext, target: string, content: string): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf8');
  return `Wrote ${target}`;
}

export async function appendFile(ctx: ToolContext, target: string, content: string): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, content, 'utf8');
  return `Appended ${target}`;
}

export async function createFile(ctx: ToolContext, target: string, content: string, overwrite = false): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const exists = await fs
    .access(resolved)
    .then(() => true)
    .catch(() => false);
  if (exists && !overwrite) {
    throw new Error(`File already exists: ${target}`);
  }
  await fs.writeFile(resolved, content, 'utf8');
  return `Created ${target}`;
}

export async function deleteFile(ctx: ToolContext, target: string): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  await fs.rm(resolved, { recursive: true, force: true });
  return `Deleted ${target}`;
}

export async function replaceInFile(
  ctx: ToolContext,
  target: string,
  find: string,
  replace: string,
  replaceAll = true
): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  const raw = await fs.readFile(resolved, 'utf8');
  const updated = replaceAll ? raw.split(find).join(replace) : raw.replace(find, replace);
  await fs.writeFile(resolved, updated, 'utf8');
  return `Replaced text in ${target}`;
}

export async function listDir(
  ctx: ToolContext,
  target: string,
  recursive = false,
  includeHidden = false
): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  const entries: string[] = [];

  async function walk(current: string, prefix = ''): Promise<void> {
    const items = await fs.readdir(current, { withFileTypes: true });
    for (const item of items) {
      if (!includeHidden && item.name.startsWith('.')) continue;
      const rel = path.join(prefix, item.name);
      entries.push(rel);
      if (recursive && item.isDirectory()) {
        await walk(path.join(current, item.name), rel);
      }
    }
  }

  await walk(resolved);
  return entries.join('\n');
}

export async function fileInfo(ctx: ToolContext, target: string): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, target, ctx.allowOutsideRoot);
  const stats = await fs.stat(resolved);
  return JSON.stringify(
    {
      path: target,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    },
    null,
    2
  );
}

async function hasCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export async function searchFiles(
  ctx: ToolContext,
  query: string,
  glob?: string
): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, '.', ctx.allowOutsideRoot);
  const useRg = await hasCommand('rg');
  if (useRg) {
    const args = ['-n', query, resolved];
    if (glob) {
      args.unshift('-g', glob);
    }
    return runShell(ctx, 'rg', args);
  }

  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    const items = await fs.readdir(current, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        const content = await fs.readFile(full, 'utf8');
        if (content.includes(query)) {
          results.push(path.relative(resolved, full));
        }
      }
    }
  }
  await walk(resolved);
  return results.join('\n');
}

export async function applyPatch(ctx: ToolContext, patch: string): Promise<string> {
  const resolved = resolveWithinRoot(ctx.root, '.', ctx.allowOutsideRoot);
  const tempPath = path.join(os.tmpdir(), `darell-${Date.now()}.patch`);
  await fs.writeFile(tempPath, patch, 'utf8');
  try {
    const gitPath = path.join(resolved, '.git');
    const useGit = await fs
      .access(gitPath)
      .then(() => true)
      .catch(() => false);
    if (useGit) {
      await runShell(ctx, 'git', ['apply', '--whitespace=nowarn', tempPath]);
    } else {
      await runShell(ctx, 'patch', ['-p0', '-i', tempPath]);
    }
    return 'Patch applied';
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

export async function runShell(ctx: ToolContext, command: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const useShell = args.length === 0 && command.includes(' ');
    const child = useShell
      ? spawn(command, { cwd: ctx.root, shell: true })
      : spawn(command, args, { cwd: ctx.root, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim() || 'Command completed');
      } else {
        reject(new Error(stderr.trim() || `Command failed with code ${code}`));
      }
    });
  });
}

export async function runGit(ctx: ToolContext, args: string[]): Promise<string> {
  return runShell(ctx, 'git', args);
}
