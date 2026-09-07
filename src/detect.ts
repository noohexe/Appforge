import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./fs-utils.js";
import type { Framework, PackageManager, ProjectDetection } from "./types.js";

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const lockfiles: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

const frameworkPackages: Array<[string, Framework, string, string]> = [
  ["next", "next", "next build", ".next"],
  ["nuxt", "nuxt", "nuxt build", ".output/public"],
  ["@angular/core", "angular", "ng build", "dist"],
  ["astro", "astro", "astro build", "dist"],
  ["svelte", "svelte", "vite build", "dist"],
  ["vue", "vue", "vite build", "dist"],
  ["react", "react", "vite build", "dist"],
  ["vite", "vite", "vite build", "dist"],
];

const frameworkFiles: Array<[string, Framework, string, string]> = [
  ["next.config.js", "next", "next build", ".next"],
  ["next.config.mjs", "next", "next build", ".next"],
  ["vite.config.ts", "vite", "vite build", "dist"],
  ["vite.config.js", "vite", "vite build", "dist"],
  ["angular.json", "angular", "ng build", "dist"],
  ["astro.config.mjs", "astro", "astro build", "dist"],
  ["nuxt.config.ts", "nuxt", "nuxt build", ".output/public"],
];

export async function detectProject(root: string): Promise<ProjectDetection> {
  const projectRoot = path.resolve(root);
  const packageJsonPath = path.join(projectRoot, "package.json");
  let packageJson: PackageJson = {};
  if (await pathExists(packageJsonPath)) packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJson;
  const lockfile = (await firstExisting(projectRoot, lockfiles.map(([file]) => file))) ?? undefined;
  const packageManager = lockfiles.find(([file]) => file === lockfile)?.[1] ?? "unknown";
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const detected = frameworkPackages.find(([pkg]) => dependencies[pkg]) ?? (await firstFrameworkFile(projectRoot));
  const framework = detected?.[1] ?? "unknown";
  const buildCommand = packageJson.scripts?.build ?? detected?.[2];
  const devScript = packageJson.scripts?.dev ? "dev" : packageJson.scripts?.start ? "start" : undefined;
  const outputDirectory = detected?.[3] ?? (buildCommand ? "dist" : undefined);
  return {
    root: projectRoot,
    packageManager,
    framework,
    packageName: packageJson.name,
    buildCommand,
    devScript,
    outputDirectory,
    packageJson: await pathExists(packageJsonPath),
    lockfile,
    evidence: [
      ...(lockfile ? [`lockfile: ${lockfile}`] : []),
      ...(detected ? [`dependency: ${detected[0]}`] : []),
      ...(packageJson.scripts?.build ? ["script: build"] : []),
    ],
  };
}

async function firstFrameworkFile(root: string): Promise<[string, Framework, string, string] | undefined> {
  for (const entry of frameworkFiles) if (await pathExists(path.join(root, entry[0]))) return entry;
  return undefined;
}

async function firstExisting(root: string, names: string[]): Promise<string | null> {
  for (const name of names) if (await pathExists(path.join(root, name))) return name;
  return null;
}