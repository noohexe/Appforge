import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppForgeError } from "./errors.js";
import { ensureDirectory, pathExists } from "./fs-utils.js";
import type { AppForgeConfig, Target } from "./types.js";

export const CONFIG_FILE = "appforge.config.json";

export function configPath(root: string): string {
  return path.join(path.resolve(root), CONFIG_FILE);
}

export function validateConfig(value: unknown): AppForgeConfig {
  if (!value || typeof value !== "object") throw new AppForgeError("Configuration must be an object");
  const config = value as Partial<AppForgeConfig>;
  const errors: string[] = [];
  if (typeof config.name !== "string" || !config.name.trim()) errors.push("name must be a non-empty string");
  if (!config.web || typeof config.web !== "object") {
    errors.push("web must be an object");
  } else {
    if (typeof config.web.root !== "string") errors.push("web.root must be a string");
    if (typeof config.web.buildCommand !== "string") errors.push("web.buildCommand must be a string");
    if (typeof config.web.outputDirectory !== "string") errors.push("web.outputDirectory must be a string");
    if (config.web.devCommand !== undefined && typeof config.web.devCommand !== "string") errors.push("web.devCommand must be a string");
    if (config.web.devUrl !== undefined && typeof config.web.devUrl !== "string") errors.push("web.devUrl must be a string");
    if (typeof config.web.root === "string") validateRelativePath(config.web.root, "web.root", errors);
    if (typeof config.web.outputDirectory === "string") validateRelativePath(config.web.outputDirectory, "web.outputDirectory", errors);
  }
  if (!Array.isArray(config.targets) || config.targets.some((target) => target !== "electron" && target !== "capacitor")) {
    errors.push("targets must contain only electron or capacitor");
  }
  if (errors.length) throw new AppForgeError(`Invalid ${CONFIG_FILE}:\n- ${errors.join("\n- ")}`);
  return config as AppForgeConfig;
}

function validateRelativePath(value: string, field: string, errors: string[]): void {
  if (!value.trim() || path.isAbsolute(value)) { errors.push(`${field} must be a non-empty relative path`); return; }
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) errors.push(`${field} must stay within the project directory`);
}

export async function loadConfig(root: string): Promise<AppForgeConfig> {
  const file = configPath(root);
  if (!(await pathExists(file))) throw new AppForgeError(`Missing ${CONFIG_FILE}. Run "appforge init" first.`);
  try {
    return validateConfig(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof AppForgeError) throw error;
    throw new AppForgeError(`Could not parse ${CONFIG_FILE}: ${(error as Error).message}`);
  }
}

export async function saveConfig(root: string, config: AppForgeConfig): Promise<void> {
  validateConfig(config);
  await ensureDirectory(path.resolve(root));
  await writeFile(configPath(root), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function addTarget(config: AppForgeConfig, target: Target): AppForgeConfig {
  return config.targets.includes(target) ? config : { ...config, targets: [...config.targets, target] };
}

export function removeTarget(config: AppForgeConfig, target: Target): AppForgeConfig {
  return { ...config, targets: config.targets.filter((item) => item !== target) };
}