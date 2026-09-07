import { spawn, type ChildProcess } from "node:child_process";
import { AppForgeError } from "./errors.js";
import { resolveDevCommand } from "./dev.js";
import type { PackageManager } from "./types.js";

export interface DevRuntimeState {
  running: boolean;
  command?: string;
  cwd?: string;
  url?: string;
  stdout: string;
  stderr: string;
  startedAt?: string;
  error?: string;
  exitCode?: number;
}

export class DevRuntime {
  private child?: ChildProcess;
  private state: DevRuntimeState = { running: false, stdout: "", stderr: "" };

  async start(webRoot: string, packageManager: PackageManager, configuredCommand?: string, configuredUrl?: string): Promise<DevRuntimeState> {
    if (this.child) throw new AppForgeError("Development server is already running.");
    const dev = await resolveDevCommand(webRoot, packageManager, configuredCommand);
    const child = spawn(dev.command, dev.args, { cwd: webRoot, shell: false, detached: process.platform !== "win32" });
    this.child = child;
    this.state = { running: true, command: dev.label, cwd: webRoot, url: configuredUrl, stdout: "", stderr: "", startedAt: new Date().toISOString() };
    child.stdout?.on("data", (chunk: Buffer) => { this.state.stdout += chunk.toString(); this.state.url ??= findUrl(this.state.stdout); });
    child.stderr?.on("data", (chunk: Buffer) => { this.state.stderr += chunk.toString(); this.state.url ??= findUrl(this.state.stderr); });
    child.once("error", (error) => { this.state.error = error.message; this.state.running = false; this.child = undefined; });
    child.once("close", (code, signal) => { this.state.exitCode = code ?? (signal ? 143 : 1); this.state.running = false; this.child = undefined; });
    return this.snapshot();
  }

  async stop(): Promise<DevRuntimeState> {
    const child = this.child;
    if (!child) return this.snapshot();
    if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
    return this.snapshot();
  }

  snapshot(): DevRuntimeState { return { ...this.state }; }
}

function findUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[).,]+$/, "");
}