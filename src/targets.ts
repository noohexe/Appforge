import { access, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppForgeError } from "./errors.js";
import { copyDirectory, ensureDirectory, pathExists, resolveProjectPath } from "./fs-utils.js";
import { runProcess, type ProcessRunner } from "./process.js";
import type { AppForgeConfig, Target } from "./types.js";

export interface TargetResult {
  target: Target;
  generatedPath: string;
  message: string;
  nativeAttempted: boolean;
  nativeAvailable: boolean;
}

export interface TargetAdapter {
  readonly target: Target;
  generate(root: string, config: AppForgeConfig): Promise<TargetResult>;
  build(root: string, config: AppForgeConfig, runner?: ProcessRunner): Promise<TargetResult>;
  doctor(root: string): Promise<string[]>;
}

function targetRoot(root: string, target: Target): string { return resolveProjectPath(root, `.appforge/targets/${target}`); }
function webOutput(root: string, config: AppForgeConfig): string { return resolveProjectPath(resolveProjectPath(root, config.web.root), config.web.outputDirectory); }
function safeName(name: string): string { return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "appforge-app"; }
async function writeJson(file: string, value: unknown): Promise<void> { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

async function prepareWeb(root: string, config: AppForgeConfig, destination: string): Promise<void> {
  const output = webOutput(root, config);
  if (!(await pathExists(output))) throw new AppForgeError(`Web output is missing: ${output}. Run "appforge build" first.`);
  await rm(destination, { recursive: true, force: true });
  await copyDirectory(output, destination);
}

async function executable(root: string, name: string): Promise<string | undefined> {
  const candidate = path.join(root, "node_modules", ".bin", name);
  try { await access(candidate); return candidate; } catch { return undefined; }
}

const electronAdapter: TargetAdapter = {
  target: "electron",
  async generate(root, config) {
    const generatedPath = targetRoot(root, "electron");
    await ensureDirectory(generatedPath);
    await writeJson(path.join(generatedPath, "package.json"), { name: `${safeName(config.name)}-desktop`, private: true, main: "main.cjs", scripts: { start: "electron .", package: "electron-builder" }, devDependencies: { electron: "^38.0.0", "electron-builder": "^26.0.0" } });
    await writeFile(path.join(generatedPath, "main.cjs"), `const { app, BrowserWindow } = require("electron");
const path = require("node:path");
function createWindow() {
  const window = new BrowserWindow({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") } });
  window.loadFile(path.join(__dirname, "web", "index.html"));
}
app.whenReady().then(() => { createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
`, "utf8");
    await writeFile(path.join(generatedPath, "preload.cjs"), `const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("appforge", Object.freeze({ version: 1 }));
`, "utf8");
    await prepareWeb(root, config, path.join(generatedPath, "web"));
    return { target: "electron", generatedPath, message: "Electron project generated; install its dependencies before native packaging.", nativeAttempted: false, nativeAvailable: false };
  },
  async build(root, config, runner = runProcess) {
    const generated = await this.generate(root, config);
    const electronBuilder = await executable(generated.generatedPath, "electron-builder") ?? await executable(root, "electron-builder");
    if (!electronBuilder) return { ...generated, message: `${generated.message} electron-builder was not found, so packaging was not attempted.` };
    const result = await runner(electronBuilder, ["--projectDir", generated.generatedPath], generated.generatedPath);
    if (result.code !== 0) throw new AppForgeError(`Electron packaging failed (exit ${result.code}).\n${result.stderr.trim()}`);
    if (!(await pathExists(path.join(generated.generatedPath, "dist")))) throw new AppForgeError("Electron packaging completed without creating the expected target dist directory.");
    return { ...generated, message: "Electron package created.", nativeAttempted: true, nativeAvailable: true };
  },
  async doctor(root) { const builder = await executable(root, "electron-builder"); return [builder ? "electron-builder: available" : "electron-builder: missing (install it to package Electron)"]; },
};

const capacitorAdapter: TargetAdapter = {
  target: "capacitor",
  async generate(root, config) {
    const generatedPath = targetRoot(root, "capacitor");
    await ensureDirectory(generatedPath);
    await writeJson(path.join(generatedPath, "package.json"), { name: `${safeName(config.name)}-mobile`, private: true, scripts: { sync: "cap sync", open: "cap open" }, dependencies: { "@capacitor/core": "^7.0.0" }, devDependencies: { "@capacitor/cli": "^7.0.0" } });
    await writeFile(path.join(generatedPath, "capacitor.config.ts"), `import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = { appId: "com.appforge.${safeName(config.name).replace(/-/g, "")}", appName: ${JSON.stringify(config.name)}, webDir: "www" };
export default config;
`, "utf8");
    await prepareWeb(root, config, path.join(generatedPath, "www"));
    return { target: "capacitor", generatedPath, message: "Capacitor project skeleton generated; native platforms are not created by AppForge.", nativeAttempted: false, nativeAvailable: false };
  },
  async build(root, config, runner = runProcess) {
    const generated = await this.generate(root, config);
    const cap = await executable(generated.generatedPath, "cap") ?? await executable(root, "cap");
    if (!cap) return { ...generated, message: `${generated.message} Capacitor CLI was not found, so sync was not attempted.` };
    const result = await runner(cap, ["sync"], generated.generatedPath);
    if (result.code !== 0) throw new AppForgeError(`Capacitor sync failed (exit ${result.code}).\n${result.stderr.trim()}`);
    return { ...generated, message: "Capacitor web assets synced. Run cap add android or cap add ios in the generated project when the native toolchain is installed.", nativeAttempted: true, nativeAvailable: true };
  },
  async doctor(root) { const cap = await executable(root, "cap"); return [cap ? "Capacitor CLI: available" : "Capacitor CLI: missing (install @capacitor/cli to sync)", "Android/iOS: not checked until a native platform is added"]; },
};

export const targetAdapters: Record<Target, TargetAdapter> = { electron: electronAdapter, capacitor: capacitorAdapter };
export function adapterFor(target: Target): TargetAdapter { return targetAdapters[target]; }
export async function generateTargets(root: string, config: AppForgeConfig): Promise<TargetResult[]> { return Promise.all(config.targets.map((target) => adapterFor(target).generate(root, config))); }
export async function buildTargets(root: string, config: AppForgeConfig, selected?: Target, runner?: ProcessRunner): Promise<TargetResult[]> {
  const targets = selected ? [selected] : config.targets;
  return Promise.all(targets.map((target) => adapterFor(target).build(root, config, runner)));
}