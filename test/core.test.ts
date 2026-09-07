import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { validateConfig } from "../src/config.js";
import { initProject } from "../src/core-operations.js";
import { detectProject } from "../src/detect.js";
import { resolveDevCommand } from "../src/dev.js";
import { adapterFor } from "../src/targets.js";
import { loadBuildHistory, recordBuildHistory } from "../src/history.js";

test("detects package manager and framework from project files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-test-"));
  try {
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sample", scripts: { build: "vite build" }, devDependencies: { vite: "^7.0.0", react: "^19.0.0" } }));
    const result = await detectProject(root);
    assert.equal(result.packageManager, "pnpm");
    assert.equal(result.framework, "react");
    assert.equal(result.buildCommand, "vite build");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("validates required config fields", () => {
  assert.throws(() => validateConfig({ name: "broken" }), /web must be an object/);
  assert.equal(validateConfig({ name: "ok", web: { root: ".", buildCommand: "build", outputDirectory: "dist" }, targets: [] }).name, "ok");
  assert.throws(() => validateConfig({ name: "bad", web: { root: "../src", buildCommand: "build", outputDirectory: "dist" }, targets: [] }), /web.root/);
});

test("round-trips build history under the AppForge-owned directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-history-"));
  try {
    await recordBuildHistory(root, { target: "all", status: "success", timestamp: "2026-09-07T00:00:00.000Z", durationMs: 12, outputPaths: [path.join(root, "dist")] });
    await recordBuildHistory(root, { target: "electron", status: "failure", timestamp: "2026-09-07T00:01:00.000Z", durationMs: 4, outputPaths: [], error: "missing builder" });
    const history = await loadBuildHistory(root);
    assert.equal(history.length, 2);
    assert.equal(history[1].status, "failure");
    assert.equal(history[1].error, "missing builder");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("serializes concurrent history writes without losing records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-history-concurrent-"));
  try {
    await Promise.all(Array.from({ length: 4 }, (_, index) => recordBuildHistory(root, { target: index % 2 ? "electron" : "all", status: "success", timestamp: new Date().toISOString(), durationMs: index, outputPaths: [] })));
    const history = await loadBuildHistory(root);
    assert.equal(history.length, 4);
    assert.equal(new Set(history.map((item) => item.id)).size, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects CLI-style initialization of a missing project root", async () => {
  const root = path.join(os.tmpdir(), `appforge-missing-${Date.now()}`);
  await assert.rejects(() => initProject(root), /Project directory does not exist/);
});

test("selects the dev script before start with structured package-manager arguments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-dev-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "server", dev: "vite" } }));
    assert.deepEqual(await resolveDevCommand(root, "pnpm"), { command: "pnpm", args: ["run", "dev"], label: "pnpm run dev" });
    await rm(path.join(root, "package.json"));
    assert.deepEqual(await resolveDevCommand(root, "npm", "vite --host 127.0.0.1"), { command: "vite", args: ["--host", "127.0.0.1"], label: "vite --host 127.0.0.1" });
    await assert.rejects(() => resolveDevCommand(root, "npm", "vite && echo unsafe"), /unsupported shell syntax/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generates secure Electron files and copies web output idempotently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-target-"));
  try {
    await mkdir(path.join(root, "site", "dist"), { recursive: true });
    await writeFile(path.join(root, "site", "dist", "index.html"), "first");
    const config = { name: "Demo App", web: { root: "site", buildCommand: "vite build", outputDirectory: "dist" }, targets: ["electron" as const] };
    const result = await adapterFor("electron").generate(root, config);
    const target = result.generatedPath;
    assert.match(await (await import("node:fs/promises")).readFile(path.join(target, "main.cjs"), "utf8"), /contextIsolation: true/);
    assert.match(await (await import("node:fs/promises")).readFile(path.join(target, "main.cjs"), "utf8"), /nodeIntegration: false/);
    assert.equal(await (await import("node:fs/promises")).readFile(path.join(target, "web", "index.html"), "utf8"), "first");
    await writeFile(path.join(root, "site", "dist", "index.html"), "second");
    await adapterFor("electron").generate(root, config);
    assert.equal(await (await import("node:fs/promises")).readFile(path.join(target, "web", "index.html"), "utf8"), "second");
    await access(path.join(target, "preload.cjs"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generates Capacitor skeleton without pretending native packaging succeeded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-capacitor-"));
  try {
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.html"), "mobile");
    const result = await adapterFor("capacitor").generate(root, { name: "Mobile", web: { root: ".", buildCommand: "build", outputDirectory: "dist" }, targets: ["capacitor"] });
    assert.match(result.message, /skeleton/);
    assert.equal(await (await import("node:fs/promises")).readFile(path.join(result.generatedPath, "www", "index.html"), "utf8"), "mobile");
    assert.match(await (await import("node:fs/promises")).readFile(path.join(result.generatedPath, "capacitor.config.ts"), "utf8"), /webDir: "www"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Capacitor sync uses an injected executable and structured arguments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "appforge-sync-"));
  try {
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.html"), "sync");
    const cap = path.join(root, "node_modules", ".bin", "cap");
    await mkdir(path.dirname(cap), { recursive: true });
    await writeFile(cap, "#!/bin/sh\n");
    await chmod(cap, 0o755);
    let invocation: { command: string; args: string[]; cwd: string } | undefined;
    const result = await adapterFor("capacitor").build(root, { name: "Sync", web: { root: ".", buildCommand: "build", outputDirectory: "dist" }, targets: ["capacitor"] }, async (command, args, cwd) => {
      invocation = { command, args, cwd };
      return { code: 0, stdout: "", stderr: "" };
    });
    assert.equal(result.nativeAttempted, true);
    assert.deepEqual(invocation?.args, ["sync"]);
    assert.equal(invocation?.cwd, result.generatedPath);
  } finally { await rm(root, { recursive: true, force: true }); }
});