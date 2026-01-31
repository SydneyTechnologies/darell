import { z } from "zod";
import os from "node:os";
import type { DarellConfig } from "./config.js";
import { summarizeUsage, type UsageSummary } from "./pricing.js";
import { confirmAction } from "./confirm.js";
import { createClient, resolveModel } from "./openai.js";
import {
  appendFile,
  applyPatch,
  createFile,
  deleteFile,
  fileInfo,
  listDir,
  moveFile,
  readFile,
  renameFile,
  replaceInFile,
  runGit,
  runShell,
  searchFiles,
  writeFile,
} from "./tools.js";

const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("read_file"),
    path: z.string(),
    start: z.number().optional(),
    end: z.number().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("write_file"),
    path: z.string(),
    content: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("append_file"),
    path: z.string(),
    content: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("create_file"),
    path: z.string(),
    content: z.string(),
    overwrite: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("delete_file"),
    path: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("replace_in_file"),
    path: z.string(),
    find: z.string(),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("list_dir"),
    path: z.string(),
    recursive: z.boolean().optional(),
    includeHidden: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("file_info"),
    path: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("search_files"),
    query: z.string(),
    glob: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("apply_patch"),
    patch: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("move_file"),
    from: z.string(),
    to: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("rename_file"),
    from: z.string(),
    to: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("shell_command"),
    command: z.string(),
    args: z.array(z.string()).default([]),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("git"),
    args: z.array(z.string()),
    reason: z.string().optional(),
  }),
]);

const PlanSchema = z.object({
  summary: z.string().optional(),
  response: z.string().optional(),
  actions: z.array(ActionSchema),
});

export type AgentAction = z.infer<typeof ActionSchema>;
export type AgentPlan = z.infer<typeof PlanSchema>;

export type AgentEvent =
  | {
      type: "plan" | "action" | "result" | "error" | "info";
      message: string;
    }
  | {
      type: "usage";
      message: string;
      usage: UsageSummary & { phase: "plan" | "followup" | "run" };
    };

export type RunAgentOptions = {
  task: string;
  root: string;
  config: DarellConfig;
  autoApprove?: boolean;
  confirm?: (action: AgentAction) => Promise<boolean>;
  onEvent?: (event: AgentEvent) => void;
  history?: Array<{
    role: "user" | "assistant" | "system" | "developer" | "function";
    content: string;
  }>;
};

function emit(options: RunAgentOptions, event: AgentEvent) {
  options.onEvent?.(event);
}

function buildPrompt(root: string, allowOutsideRoot?: boolean): string {
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();
  return [
    "You are a careful local CLI agent.",
    `Operating system: ${platform} ${release} (${arch}).`,
    "Return a JSON object with a response and an ordered list of actions.",
    "Available action types:",
    "read_file, write_file, append_file, create_file, delete_file, replace_in_file,",
    "list_dir, file_info, search_files, apply_patch, move_file, rename_file, shell_command, git.",
    "Use relative paths when possible and do not include unsafe or destructive commands.",
    "Do not include explanatory text outside JSON.",
  ].join("\n");
}

function formatUsageMessage(usage: UsageSummary & { phase: "plan" | "followup" | "run" }): string {
  const cost = usage.cost !== undefined ? `$${usage.cost.toFixed(6)}` : "n/a";
  return `Usage (${usage.phase}): in ${usage.promptTokens}, out ${usage.completionTokens}, total ${usage.totalTokens}, cost ${cost}`;
}

export async function runAgent(options: RunAgentOptions): Promise<void> {
  const client = createClient(options.config);
  const model = resolveModel(options.config);
  const executionLog: string[] = [];
  const runUsage: UsageSummary = {
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
  };

  emit(options, { type: "info", message: `Using model ${model}` });

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: buildPrompt(options.root, options.config.allowOutsideRoot),
      },
      ...(options.history?.length
        ? (options.history as any)
        : [{ role: "user", content: options.task }]),
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const initialUsage = summarizeUsage(model, response.usage, options.config.pricing);
  if (initialUsage) {
    const usageWithPhase = { ...initialUsage, phase: "plan" as const };
    emit(options, {
      type: "usage",
      message: formatUsageMessage(usageWithPhase),
      usage: usageWithPhase,
    });
    runUsage.promptTokens += initialUsage.promptTokens;
    runUsage.completionTokens += initialUsage.completionTokens;
    runUsage.totalTokens += initialUsage.totalTokens;
    runUsage.cachedTokens += initialUsage.cachedTokens;
    if (typeof initialUsage.cost === "number") {
      runUsage.cost = (runUsage.cost ?? 0) + initialUsage.cost;
    }
  }

  const raw = response.choices[0]?.message?.content ?? "";
  let plan: AgentPlan;
  try {
    plan = PlanSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Failed to parse plan: ${String(error)}\nRaw: ${raw}`);
  }

  emit(options, { type: "plan", message: plan.summary || "Plan ready" });
  if (plan.response) {
    emit(options, { type: "result", message: plan.response });
  }

  const ctx = { root: options.root, allowOutsideRoot: true };
  for (const action of plan.actions) {
    const description =
      `${action.type}: ${"path" in action ? action.path : ""} ${"from" in action ? action.from : ""} ${"to" in action ? action.to : ""} ${"command" in action ? action.command : ""} ${"args" in action ? action.args.join(" ") : ""}`.trim();
    emit(options, { type: "action", message: description });

    if (!options.autoApprove) {
      const confirm =
        options.confirm ??
        ((next: AgentAction) =>
          confirmAction(
            `Run ${next.type}? ${next.reason ? next.reason : ""}`.trim(),
          ));
      const ok = await confirm(action);
      if (!ok) {
        emit(options, { type: "info", message: `Skipped: ${description}` });
        executionLog.push(`SKIPPED ${description}`);
        continue;
      }
    }

    try {
      let result = "";
      switch (action.type) {
        case "read_file":
          result = await readFile(ctx, action.path, action.start, action.end);
          break;
        case "write_file":
          result = await writeFile(ctx, action.path, action.content);
          break;
        case "append_file":
          result = await appendFile(ctx, action.path, action.content);
          break;
        case "create_file":
          result = await createFile(
            ctx,
            action.path,
            action.content,
            action.overwrite ?? false,
          );
          break;
        case "delete_file":
          result = await deleteFile(ctx, action.path);
          break;
        case "replace_in_file":
          result = await replaceInFile(
            ctx,
            action.path,
            action.find,
            action.replace,
            action.replaceAll ?? true,
          );
          break;
        case "list_dir":
          result = await listDir(
            ctx,
            action.path,
            action.recursive ?? false,
            action.includeHidden ?? false,
          );
          break;
        case "file_info":
          result = await fileInfo(ctx, action.path);
          break;
        case "search_files":
          result = await searchFiles(ctx, action.query, action.glob);
          break;
        case "apply_patch":
          result = await applyPatch(ctx, action.patch);
          break;
        case "move_file":
          result = await moveFile(ctx, action.from, action.to);
          break;
        case "rename_file":
          result = await renameFile(ctx, action.from, action.to);
          break;
        case "shell_command":
          result = await runShell(ctx, action.command, action.args);
          break;
        case "git":
          result = await runGit(ctx, action.args);
          break;
        default:
          throw new Error(`Unknown action ${(action as AgentAction).type}`);
      }
      emit(options, { type: "result", message: result });
      executionLog.push(`OK ${description}\n${result}`);
    } catch (error) {
      const message = String(error);
      emit(options, { type: "error", message });
      executionLog.push(`ERROR ${description}\n${message}`);
    }
  }

  if (executionLog.length > 0) {
    const followUp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: [
            "You are a concise CLI assistant.",
            "Summarize the outcome of the actions and answer the user request.",
            "If there were errors or skipped actions, mention them briefly.",
          ].join(" "),
        },
        {
          role: "user",
          content: `User request: ${options.task}\n\nAction log:\n${executionLog.join("\n\n")}`,
        },
      ],
      temperature: 0.2,
    });
    const followUsage = summarizeUsage(model, followUp.usage, options.config.pricing);
    if (followUsage) {
      const usageWithPhase = { ...followUsage, phase: "followup" as const };
      emit(options, {
        type: "usage",
        message: formatUsageMessage(usageWithPhase),
        usage: usageWithPhase,
      });
      runUsage.promptTokens += followUsage.promptTokens;
      runUsage.completionTokens += followUsage.completionTokens;
      runUsage.totalTokens += followUsage.totalTokens;
      runUsage.cachedTokens += followUsage.cachedTokens;
      if (typeof followUsage.cost === "number") {
        runUsage.cost = (runUsage.cost ?? 0) + followUsage.cost;
      }
    }
    const summary = followUp.choices[0]?.message?.content?.trim();
    if (summary) {
      emit(options, { type: "result", message: summary });
    }
  }

  if (runUsage.totalTokens > 0) {
    const usageWithPhase = { ...runUsage, phase: "run" as const };
    emit(options, {
      type: "usage",
      message: formatUsageMessage(usageWithPhase),
      usage: usageWithPhase,
    });
  }
}
