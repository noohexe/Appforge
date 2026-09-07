import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { addTarget, loadConfig, saveConfig } from "./config.js";
import { detectProject } from "./detect.js";
import { AppForgeError } from "./errors.js";
import { ensureDirectory, pathExists, removeOwnedDirectory, resolveProjectPath } from "./fs-utils.js";
import { runProcess, type ProcessResult } from "./process.js";
import { adapterFor, buildTargets, type TargetResult } from "./targets.js";
import { recordBuildHistory } from "./history.js";
import type { AppForgeConfig, ProjectDetection, Target } from "./types.js";

export interface ProjectState {
  projectPath: string;
  detection: ProjectDetection;
  config?: AppForgeConfig;
  configError?: string;
}

export interface WebBuildResult {
  outputPath: string;
  process: ProcessResult;
}

export interface BuildResult {
  web: WebBuildResult;
  targets: TargetResult[];
}

export async function validateProjectRoot(projectPath: string): Promise<string> {
  const root = path.resolve(projectPath);
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new AppForgeError(`Project directory does not exist: ${root}`);
  }
  return root;
}

export async function connectProject(projectPath: string): Promise<ProjectState> {
  const root = await validateProjectRoot(projectPath);
  const detection = await detectProject(root);
  const configFile = path.join(root, "appforge.config.json");
  if (!(await pathExists(configFile))) return { projectPath: root, detection, configError: "Configuration missing. Initialize the project to create appforge.config.json." };
  return { projectPath: root, detection, config: await loadConfig(root) };
}

export async function initProject(root: string, force = false): Promise<ProjectState> {
  const projectPath = await validateProjectRoot(root);
  const detection = await detectProject(projectPath);
  if (await pathExists(path.join(projectPath, "appforge.config.json")) && !force) throw new AppForgeError("appforge.config.json already exists. Use force to replace it.");
  const config: AppForgeConfig = { $schema: "https://appforge.dev/schema/config.json", name: detection.packageName ?? path.basename(projectPath), web: { root: ".", buildCommand: detection.buildCommand ?? "", outputDirectory: detection.outputDirectory ?? "dist", devCommand: "" }, targets: [] };
  await saveConfig(projectPath, config);
  return { projectPath, detection, config };
}

export async function addProjectTarget(root: string, target: Target): Promise<{ config: AppForgeConfig; result?: TargetResult; deferred: boolean }> {
  const projectPath = await validateProjectRoot(root);
  const config = addTarget(await loadConfig(projectPath), target);
  await saveConfig(projectPath, config);
  try {
    return { config, result: await adapterFor(target).generate(projectPath, config), deferred: false };
  } catch (error) {
    if (error instanceof AppForgeError && error.message.startsWith("Web output is missing:")) {
      await ensureDirectory(resolveProjectPath(projectPath, `.appforge/targets/${target}`));
      return { config, deferred: true };
    }
    throw error;
  }
}

export async function buildProject(root: string, selected?: Target): Promise<BuildResult> {
  const projectPath = await validateProjectRoot(root);
  const started = Date.now();
  const historyTarget = selected ?? "all";
  try {
    const config = await loadConfig(projectPath);
    if (!config.web.buildCommand) throw new AppForgeError("web.buildCommand is empty; configure a web build script first.");
    const detection = await detectProject(projectPath);
    const webRoot = resolveProjectPath(projectPath, config.web.root);
    const process = await runWebBuild(webRoot, config.web.buildCommand, detection.packageManager);
    if (process.code !== 0) throw new AppForgeError(`Web build failed (exit ${process.code}).\n${process.stderr.trim()}`);
    const outputPath = resolveProjectPath(webRoot, config.web.outputDirectory);
    if (!(await pathExists(outputPath))) throw new AppForgeError(`Web build completed but output is missing: ${config.web.outputDirectory}`);
    if (selected && !config.targets.includes(selected)) throw new AppForgeError(`Target ${selected} is not configured. Run "appforge add ${selected === "electron" ? "desktop" : "mobile"}" first.`);
    const targets = await buildTargets(projectPath, config, selected);
    await recordBuildHistory(projectPath, { target: historyTarget, status: "success", timestamp: new Date().toISOString(), durationMs: Date.now() - started, outputPaths: [outputPath, ...targets.map((item) => item.generatedPath)] });
    return { web: { outputPath, process }, targets };
  } catch (error) {
    await recordBuildHistory(projectPath, { target: historyTarget, status: "failure", timestamp: new Date().toISOString(), durationMs: Date.now() - started, outputPaths: [], error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export async function removeProjectTarget(root: string, target: Target): Promise<AppForgeConfig> {
  const projectPath = await validateProjectRoot(root);
  const config = await loadConfig(projectPath);
  const next = { ...config, targets: config.targets.filter((item) => item !== target) };
  await saveConfig(projectPath, next);
  await removeOwnedDirectory(projectPath, `.appforge/targets/${target}`);
  return next;
}

export async function runWebBuild(webRoot: string, command: string, packageManager: string): Promise<ProcessResult> {
  const packageJsonPath = path.join(webRoot, "package.json");
  let scripts: Record<string, string> = {};
  if (await pathExists(packageJsonPath)) scripts = (JSON.parse(await readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  if (scripts.build === command) {
    if (packageManager === "unknown") throw new AppForgeError("No supported package-manager lockfile found for the configured package build script.");
    return runProcess(packageManager, ["run", "build"], webRoot);
  }
  const tokens = splitCommand(command);
  if (!tokens.length) throw new AppForgeError("web.buildCommand must not be empty.");
  return runProcess(tokens[0], tokens.slice(1), webRoot);
}

export async function doctorProject(root: string): Promise<{ detection: ProjectDetection; config: string; statuses: string[] }> {
  const projectPath = await validateProjectRoot(root);
  const detection = await detectProject(projectPath);
  let config = "valid";
  try { await loadConfig(projectPath); } catch (error) { config = (error as Error).message; }
  const statuses = [
    `node: ${process.version}`,
    `package manager: ${detection.packageManager}`,
    `framework: ${detection.framework}`,
    ...((await Promise.all(((["electron", "capacitor"] as Target[]).map((target) => adapterFor(target).doctor(projectPath))))).flatMap((items, index) => items.map((item) => `${["electron", "capacitor"][index]}: ${item}`))),
    `Android SDK: ${process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ? "configured" : "missing (set ANDROID_HOME or ANDROID_SDK_ROOT)"}`,
    `iOS toolchain: ${process.platform === "darwin" ? "host may support Xcode" : "unavailable on this host (requires macOS/Xcode)"}`,
  ];
  return { detection, config, statuses };
}

export async function cleanProject(root: string): Promise<void> {
  await validateProjectRoot(root);
  await removeOwnedDirectory(root, ".appforge");
}

function splitCommand(command: string): string[] {
  if (/[;&|<>`$]/.test(command)) throw new AppForgeError("web.buildCommand contains unsupported shell syntax; use a command and arguments without shell operators.");
  const tokens = command.match(/[^\s"']+|"[^"]*"|'[^']*'/g) ?? [];
  return tokens.map((token) => token.length >= 2 && ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) ? token.slice(1, -1) : token);
}