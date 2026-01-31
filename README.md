# Darell CLI

Local agent CLI for file ops, shell commands, and Git automation using OpenAI.

> Note: ChatGPT subscriptions (Plus/Pro/etc.) are separate from API billing; API usage requires an API key from the developer platform.

## Install

```bash
npm install
```

To run `darell` globally during development:

```bash
npm run build
```

Then link the global binary:

```bash
npm link
```

## Configure

### Option A: Configure (Ink)

```bash
npm run dev -- configure
```

Model selection is populated from the OpenAI models API during configuration.

### Option B: Environment variables

```bash
export OPENAI_API_KEY="..."
export DARELL_MODEL="gpt-4o-mini"
```

`darell configure` writes to `~/.darell/config`. This is in no way a secure way to do this but since it is mostly a local configuration idk use at your own risk.

You can find/create API keys in the OpenAI developer platform.

## Usage

```bash
npm run dev -- configure
npm run dev -- interactive
npm run dev -- -i
npm run dev -- agent "rename all *.txt files to *.md"
```

Options:

- `--root <path>`: workspace root (default: cwd)
- `--yes`: auto-approve actions
- `--model <name>`: override model

## What it can do

- Move files
- Rename files
- Run shell commands (with approval)
- Run git commands (with approval)
- Read files
- Write/append/create/delete files
- Search files
- List directories
- Apply patches

## Security notes

- The agent requests approval for each action unless `--yes` is provided.
- Prefer project-based keys and avoid sharing personal API keys.
- Running shell commands or file mutations can be destructive; review each approval carefully.
- `delete_file`, `write_file`, `append_file`, `replace_in_file`, and `apply_patch` modify data and should be used cautiously.
- `--yes` disables per-action confirmation and is not recommended for sensitive workspaces.
- By default, actions are limited to the workspace root. You can allow outside-root access in `darell configure`.

# darell
