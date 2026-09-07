import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AppForgeError } from "./errors.js";
import { ensureDirectory, pathExists, resolveProjectPath } from "./fs-utils.js";
import type { Target } from "./types.js";

export interface BuildHistoryRecord {
  id: string;
  target: Target | "all";
  status: "success" | "failure";
  timestamp: string;
  durationMs: number;
  outputPaths: string[];
  error?: string;
}

const historyRelativePath = ".appforge/history/builds.json";
const historyWrites = new Map<string, Promise<BuildHistoryRecord>>();

export function buildHistoryPath(root: string): string {
  return resolveProjectPath(root, historyRelativePath);
}

export async function loadBuildHistory(root: string): Promise<BuildHistoryRecord[]> {
  const file = buildHistoryPath(root);
  if (!(await pathExists(file))) return [];
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(value)) throw new Error("history must be an array");
    return value.filter(isHistoryRecord);
  } catch (error) {
    throw new AppForgeError(`Could not read ${path.relative(root, file)}: ${(error as Error).message}`);
  }
}

export async function recordBuildHistory(root: string, record: Omit<BuildHistoryRecord, "id">): Promise<BuildHistoryRecord> {
  const projectRoot = path.resolve(root);
  const previous = historyWrites.get(projectRoot) ?? Promise.resolve(undefined as never);
  const current = previous.then(async () => {
    const file = buildHistoryPath(projectRoot);
    const history = await loadBuildHistory(projectRoot);
    const saved: BuildHistoryRecord = { ...record, id: `${Date.now()}-${randomUUID()}` };
    await ensureDirectory(path.dirname(file));
    await writeFile(file, `${JSON.stringify([...history, saved], null, 2)}\n`, "utf8");
    return saved;
  });
  historyWrites.set(projectRoot, current);
  try { return await current; } finally {
    if (historyWrites.get(projectRoot) === current) historyWrites.delete(projectRoot);
  }
}

function isHistoryRecord(value: unknown): value is BuildHistoryRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BuildHistoryRecord>;
  return typeof item.id === "string" && (item.target === "all" || item.target === "electron" || item.target === "capacitor") &&
    (item.status === "success" || item.status === "failure") && typeof item.timestamp === "string" &&
    typeof item.durationMs === "number" && Array.isArray(item.outputPaths) && item.outputPaths.every((item) => typeof item === "string") &&
    (item.error === undefined || typeof item.error === "string");
}