import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppForgeError } from "./errors.js";
import { pathExists } from "./fs-utils.js";
import type { PackageManager } from "./types.js";

export interface DevCommand {
  command: string;
  args: string[];
  label: string;
}

export async function resolveDevCommand(webRoot: string, packageManager: PackageManager, configuredCommand?: string): Promise<DevCommand> {
  const packageJsonPath = path.join(webRoot, "package.json");
  let scripts: Record<string, string> = {};
  if (await pathExists(packageJsonPath)) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
    scripts = packageJson.scripts ?? {};
  }
  const script = scripts.dev ? "dev" : scripts.start ? "start" : undefined;
  if (script) {
    if (packageManager === "unknown") throw new AppForgeError(`Found a ${script} script but could not detect its package manager. Add a lockfile or configure web.devCommand.`);
    return { command: packageManager, args: ["run", script], label: `${packageManager} run ${script}` };
  }
  if (configuredCommand?.trim()) {
    const tokens = splitDevCommand(configuredCommand);
    if (!tokens.length) throw new AppForgeError("web.devCommand must not be empty.");
    return { command: tokens[0], args: tokens.slice(1), label: configuredCommand.trim() };
  }
  throw new AppForgeError("No dev or start script was found. Add one to package.json or configure web.devCommand.");
}

function splitDevCommand(command: string): string[] {
  if (/[;&|<>`$]/.test(command)) throw new AppForgeError("web.devCommand contains unsupported shell syntax; use a command and arguments without shell operators.");
  const tokens = command.match(/[^\s"']+|"[^"]*"|'[^']*'/g) ?? [];
  return tokens.map((token) => token.length >= 2 && ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) ? token.slice(1, -1) : token);
}