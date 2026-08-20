import { existsSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { withWindowsSystemPath } from "./windows-env.js";

const name = "dsh-git-bash";
const inject = ["tools", "systemPrompt"];
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 256_000;

function resolveGitBashPath() {
  const candidates = [
    process.env.DSH_GIT_BASH_PATH,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Git\\bin\\bash.exe`,
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Git\\bin\\bash.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function resolveWorkdir(modelWorkdir, exec, policyWorkspaceRoot) {
  const sessionCwd = policyWorkspaceRoot || exec.agent?.session?.header?.cwd || process.cwd();
  if (!modelWorkdir) return sessionCwd;
  return isAbsolute(modelWorkdir) ? modelWorkdir : resolvePath(sessionCwd, modelWorkdir);
}

function appendTail(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next;
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    try { child.kill(); } catch {}
  }
}

function executeCommand(ctx, gitBashPath, args, exec) {
  const requestedTimeout = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) {
    throw new Error("timeoutMs must be a positive number");
  }
  if (exec.signal.aborted) {
    const error = new Error("Git Bash tool call aborted", { cause: exec.signal.reason });
    error.name = "AbortError";
    throw error;
  }
  const timeoutMs = Math.min(requestedTimeout, MAX_TIMEOUT_MS);
  const sandboxPolicy = ctx.get("sandboxPolicy")?.resolve(
    exec.agent ? { session: exec.agent.session } : {},
  );
  const workdir = resolveWorkdir(args.workdir, exec, sandboxPolicy?.workspaceRoot);
  const commandArgv = [gitBashPath, "--noprofile", "--norc", "-lc", args.command];
  let argv = commandArgv;
  let sandbox;
  if (sandboxPolicy && sandboxPolicy.mode !== "danger-full-access") {
    const sandboxService = ctx.get("sandbox");
    if (!sandboxService) throw new Error("Git Bash sandbox unavailable");
    const confined = sandboxService.confine(commandArgv, sandboxPolicy);
    argv = [...confined.argv];
    sandbox = { mode: sandboxPolicy.mode, enforcement: confined.enforcement };
  } else if (sandboxPolicy) {
    sandbox = { mode: sandboxPolicy.mode };
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const shellEnv = ctx.get("shellEnv")?.collect(exec) || {};
    const env = withWindowsSystemPath({
      ...process.env,
      NO_COLOR: "1",
      TERM: "dumb",
      PAGER: "cat",
      GIT_PAGER: "cat",
      CHERE_INVOKING: "1",
      MSYS2_ARG_CONV_EXCL: "*",
      ...shellEnv,
    });
    const child = spawn(argv[0], argv.slice(1), {
      cwd: workdir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    child.stdout.on("data", (chunk) => { stdout = appendTail(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendTail(stderr, chunk); });

    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      exec.signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const onAbort = () => {
      killTree(child);
      const error = new Error("Git Bash tool call aborted", { cause: exec.signal.reason });
      error.name = "AbortError";
      finishError(error);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    exec.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", finishError);
    child.once("exit", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      exec.signal.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        signal,
        timedOut,
        timeoutMs,
        stdout,
        stderr,
        ...(sandbox ? { sandbox } : {}),
      });
    });
  });
}

function renderResult(value) {
  let text = value.stdout;
  if (value.stderr) text += `${text && !text.endsWith("\n") ? "\n" : ""}[stderr]\n${value.stderr}`;
  if (value.timedOut) text += `${text && !text.endsWith("\n") ? "\n" : ""}[timed out after ${value.timeoutMs} ms]`;
  if (value.signal) text += `${text && !text.endsWith("\n") ? "\n" : ""}[signal: ${value.signal}]`;
  else if (value.exitCode !== null) text += `${text && !text.endsWith("\n") ? "\n" : ""}[exit code: ${value.exitCode}]`;
  return text;
}

function presentTerminalResult(result) {
  const block = result.content.length === 1 ? result.content[0] : undefined;
  if (!block || block.type !== "text") return undefined;
  if (result.isError) {
    return { card: "generic", content: [{ type: "text", text: `\`\`\`console\n${block.text.replace(/\n+$/, "")}\n\`\`\`` }] };
  }
  const status = block.text.match(/\n?\[(exit code|signal): ([^\]]+)\]\s*$/);
  if (!status) return { card: "terminal", output: block.text };
  const output = block.text.slice(0, status.index);
  return status[1] === "exit code"
    ? { card: "terminal", output, exitCode: Number(status[2]) }
    : { card: "terminal", output, signal: status[2] };
}

function apply(ctx) {
  if (process.platform !== "win32") return;
  const gitBashPath = resolveGitBashPath();
  if (!gitBashPath) {
    throw new Error("Git Bash not found. Install Git for Windows or set DSH_GIT_BASH_PATH.");
  }

  ctx.systemPrompt.section({
    name: "tool:git-bash",
    order: 99,
    text: "On Windows, use git_bash for ordinary development commands, including git, rg, node, npm, pnpm, file inspection, and pipelines. Use pwsh only for Windows-specific operations such as registry, services, PowerShell modules, or .ps1 scripts. Commands passed to git_bash use Bash syntax and POSIX quoting.",
  });

  ctx.tools.register(defineTool({
    name: "git_bash",
    description: "Execute a command with Git for Windows Bash. This is the default Windows terminal for ordinary development work because it uses Bash quoting and common POSIX utilities. Use pwsh only for Windows-specific operations.",
    timeoutMs: MAX_TIMEOUT_MS,
    parameters: {
      command: { type: "string", required: true, description: "The Bash command to execute using POSIX quoting." },
      description: { type: "string", required: true, description: "Clear 5-10 word description of the command in active voice." },
      timeoutMs: { type: "number", description: "Timeout in milliseconds; defaults to 120000 and is capped at 600000." },
      workdir: { type: "string", description: "Working directory; relative paths resolve from the session workspace." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exitCode: { required: true, oneOf: [{ type: "integer" }, { type: "null" }] },
          signal: { required: true, oneOf: [{ type: "string" }, { type: "null" }] },
          timedOut: { type: "boolean", required: true },
          timeoutMs: { type: "number", required: true },
          stdout: { type: "string", required: true },
          stderr: { type: "string", required: true },
          sandbox: {
            type: "object",
            additionalProperties: false,
            properties: {
              mode: { type: "string", required: true },
              enforcement: { type: "string" },
            },
          },
        },
      },
      render: (_args, value) => [{ type: "text", text: renderResult(value) }],
    },
    execute: (args, exec) => executeCommand(ctx, gitBashPath, args, exec),
    presentCall: (args) => ({
      card: "terminal",
      title: args.command,
      description: args.description,
      ...(args.workdir ? { cwd: args.workdir } : {}),
    }),
    presentResult: (_args, result) => presentTerminalResult(result),
  }));
}

export { apply, inject, name, presentTerminalResult, renderResult, resolveGitBashPath };
