import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { AppForgeError } from "./errors.js";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveProjectPath(root: string, relativePath: string): string {
  if (!relativePath.trim()) throw new AppForgeError("Path must not be empty");
  if (path.isAbsolute(relativePath)) throw new AppForgeError(`Path must be relative to the project: ${relativePath}`);
  const projectRoot = path.resolve(root);
  const resolved = path.resolve(projectRoot, relativePath);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new AppForgeError(`Path escapes the project directory: ${relativePath}`);
  }
  return resolved;
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

export async function removeOwnedDirectory(root: string, relativePath: string): Promise<void> {
  const ownedRoot = resolveProjectPath(root, ".appforge");
  const target = resolveProjectPath(root, relativePath);
  if (target !== ownedRoot && !target.startsWith(`${ownedRoot}${path.sep}`)) {
    throw new AppForgeError("Refusing to remove a directory outside .appforge");
  }
  if (await pathExists(target)) await rm(target, { recursive: true, force: true });
}