#!/usr/bin/env node

import path from "node:path";
import { Command } from "commander";
import { addTarget, loadConfig, removeTarget, saveConfig } from "./config.js";
import { buildProject, initProject } from "./core-operations.js";
import { detectProject } from "./detect.js";
import { resolveDevCommand } from "./dev.js";
import { AppForgeError } from "./errors.js";
import { ensureDirectory, pathExists, removeOwnedDirectory, resolveProjectPath } from "./fs-utils.js";
import { runStreamingProcess } from "./process.js";
import { adapterFor } from "./targets.js";
import type { Target } from "./types.js";

const program = new Command();
program.name("appforge").description("Turn web apps into installable desktop and mobile apps").version("0.1.0");

program.command("init").description("Create appforge.config.json from the detected web project")
  .option("-d, --dir <path>", "project directory", ".").option("-f, --force", "replace an existing configuration")
  .action(async ({ dir, force }: { dir: string; force?: boolean }) => {
    const root = path.resolve(dir);
    const result = await initProject(root, force);
    console.log(`Created ${path.join(root, "appforge.config.json")}`);
    if (!result.detection.buildCommand) console.log("No build script was detected; set web.buildCommand before running build.");
  });

program.command("detect").description("Detect the web project framework and package manager")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async ({ dir }: { dir: string }) => console.log(JSON.stringify(await detectProject(path.resolve(dir)), null, 2)));

program.command("config").description("Validate and print appforge.config.json")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async ({ dir }: { dir: string }) => console.log(JSON.stringify(await loadConfig(path.resolve(dir)), null, 2)));

program.command("add <target>").description("Register a desktop or mobile target")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async (target: string, { dir }: { dir: string }) => {
    const root = path.resolve(dir);
    const validTarget = parseTarget(target);
    const config = addTarget(await loadConfig(root), validTarget);
    await saveConfig(root, config);
    try {
      const result = await adapterFor(validTarget).generate(root, config);
      console.log(`Added ${validTarget}: ${result.message}`);
      console.log(`Generated ${result.generatedPath}`);
    } catch (error) {
      if (error instanceof AppForgeError && error.message.startsWith("Web output is missing:")) {
        await ensureDirectory(resolveProjectPath(root, `.appforge/targets/${validTarget}`));
        console.log(`Added ${validTarget}; build web assets first to generate its copied web output.`);
      } else throw error;
    }
  });

program.command("remove <target>").description("Unregister a target and remove only its AppForge output")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async (target: string, { dir }: { dir: string }) => {
    const root = path.resolve(dir);
    const validTarget = parseTarget(target);
    await saveConfig(root, removeTarget(await loadConfig(root), validTarget));
    await removeOwnedDirectory(root, `.appforge/targets/${validTarget}`);
    console.log(`Removed ${validTarget}`);
  });

program.command("info").description("Show detected project and AppForge configuration")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async ({ dir }: { dir: string }) => { const root = path.resolve(dir); console.log(JSON.stringify({ detection: await detectProject(root), config: await loadConfig(root) }, null, 2)); });

program.command("clean").description("Remove AppForge-generated output only")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async ({ dir }: { dir: string }) => { await removeOwnedDirectory(path.resolve(dir), ".appforge"); console.log("Removed .appforge output"); });

program.command("build").description("Build the web assets and verify the configured output")
  .option("-d, --dir <path>", "project directory", ".")
  .option("-t, --target <target>", "build one target (desktop or mobile)")
  .action(async ({ dir, target }: { dir: string; target?: string }) => {
    const root = path.resolve(dir);
    const config = await loadConfig(root);
    if (!config.web.buildCommand) throw new AppForgeError("web.buildCommand is empty; configure a web build script first.");
    const selected = target ? parseTarget(target) : undefined;
    const result = await buildProject(root, selected);
    console.log(`Web assets ready at ${result.web.outputPath}`);
    for (const targetResult of result.targets) console.log(`${targetResult.target}: ${targetResult.message}`);
  });

program.command("dev").description("Launch the web project's development server for browser preview")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async ({ dir }: { dir: string }) => {
    const root = path.resolve(dir);
    const hasConfig = await pathExists(path.join(root, "appforge.config.json"));
    const detection = await detectProject(root);
    const config = hasConfig ? await loadConfig(root) : undefined;
    const webRoot = resolveProjectPath(root, config?.web.root ?? ".");
    const dev = await resolveDevCommand(webRoot, detection.packageManager, config?.web.devCommand);
    console.log(`Starting web preview with ${dev.label} in ${webRoot}`);
    console.log(config?.web.devUrl ? `Preview URL: ${config.web.devUrl}` : "Preview URL: inspect the development server output below.");
    const result = await runStreamingProcess(dev.command, dev.args, webRoot, (_stream, chunk) => process.stdout.write(chunk));
    if (result.interrupted) return;
    if (result.code !== 0) throw new AppForgeError(`Web preview stopped with exit code ${result.code}.${result.stderr.trim() ? `\n${result.stderr.trim()}` : ""}`);
  });

program.command("doctor").description("Check project configuration and native adapter limitations")
  .option("-d, --dir <path>", "project directory", ".")
  .action(async ({ dir }: { dir: string }) => {
    const root = path.resolve(dir); const detection = await detectProject(root);
    console.log(`node: ${process.version}`); console.log(`package manager: ${detection.packageManager}`); console.log(`framework: ${detection.framework}`);
    try { await loadConfig(root); console.log("config: valid"); } catch (error) { console.log(`config: ${(error as Error).message}`); }
    for (const target of ["electron", "capacitor"] as Target[]) for (const status of await adapterFor(target).doctor(root)) console.log(`${target}: ${status}`);
    console.log(`Android SDK: ${process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ? "configured" : "missing (set ANDROID_HOME or ANDROID_SDK_ROOT)"}`);
    console.log(`iOS toolchain: ${process.platform === "darwin" ? "host may support Xcode" : "unavailable on this host (requires macOS/Xcode)"}`);
  });

function parseTarget(value: string): Target {
  if (value === "desktop") return "electron";
  if (value === "mobile") return "capacitor";
  if (value === "electron" || value === "capacitor") return value;
  throw new AppForgeError(`Unknown target "${value}". Choose desktop or mobile.`);
}

try { await program.parseAsync(); } catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof AppForgeError ? error.exitCode : 1;
}