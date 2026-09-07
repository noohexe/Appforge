import { defineConfig, type Plugin } from "vite";
import {
  addProjectTarget,
  buildProject,
  cleanProject,
  connectProject,
  doctorProject,
  initProject,
  removeProjectTarget,
  type ProjectState,
} from "./src/core-operations.js";
import { loadConfig, saveConfig } from "./src/config.js";
import { loadBuildHistory } from "./src/history.js";
import { DevRuntime } from "./src/dev-runtime.js";
import { resolveProjectPath } from "./src/fs-utils.js";
import { AppForgeError } from "./src/errors.js";
import type { Target } from "./src/types.js";

let connected: ProjectState | undefined;
const devRuntime = new DevRuntime();

function appForgeApi(): Plugin {
  return {
    name: "appforge-api",
    configureServer(server) {
      server.middlewares.use("/api", async (request, response, next) => {
        try {
          const url = new URL(request.url ?? "/", "http://appforge.local");
          const method = request.method ?? "GET";
          if (url.pathname === "/connect" && method === "POST") {
            await devRuntime.stop();
            const body = await readJson(request);
            connected = await connectProject(requiredString(body.projectPath, "projectPath"));
            return sendJson(response, connected);
          }
          if (url.pathname === "/project" && method === "GET") return sendJson(response, requireConnection());
          if (url.pathname === "/init" && method === "POST") {
            const body = await readJson(request);
            connected = await initProject(requireConnection().projectPath, body.force === true);
            return sendJson(response, connected);
          }
          if (url.pathname === "/targets" && method === "POST") {
            const body = await readJson(request);
            const target = parseTarget(body.target);
            const result = await addProjectTarget(requireConnection().projectPath, target);
            connected = { ...requireConnection(), config: result.config, configError: undefined };
            return sendJson(response, { ...result, target: body.target });
          }
          if (url.pathname === "/targets" && method === "DELETE") {
            const body = await readJson(request);
            const target = parseTarget(body.target);
            const config = await removeProjectTarget(requireConnection().projectPath, target);
            connected = { ...requireConnection(), config, configError: undefined };
            return sendJson(response, { target: body.target, config });
          }
          if (url.pathname === "/build" && method === "POST") {
            const body = await readJson(request);
            const target = body.target === undefined ? undefined : parseTarget(body.target);
            return sendJson(response, await buildProject(requireConnection().projectPath, target));
          }
          if (url.pathname === "/doctor" && method === "GET") return sendJson(response, await doctorProject(requireConnection().projectPath));
          if (url.pathname === "/history" && method === "GET") return sendJson(response, await loadBuildHistory(requireConnection().projectPath));
          if (url.pathname === "/dev" && method === "GET") return sendJson(response, devRuntime.snapshot());
          if (url.pathname === "/dev/start" && method === "POST") {
            const project = requireConnection();
            if (!project.config) throw new AppForgeError(project.configError ?? "Configuration is missing. Run init first.");
            const webRoot = resolveProjectPath(project.projectPath, project.config.web.root);
            return sendJson(response, await devRuntime.start(webRoot, project.detection.packageManager, project.config.web.devCommand, project.config.web.devUrl));
          }
          if (url.pathname === "/dev/stop" && method === "POST") return sendJson(response, await devRuntime.stop());
          if (url.pathname === "/clean" && method === "POST") {
            await cleanProject(requireConnection().projectPath);
            return sendJson(response, { message: "Removed .appforge output" });
          }
          if (url.pathname === "/config" && method === "GET") {
            const project = requireConnection();
            if (!project.config) throw new AppForgeError(project.configError ?? "Configuration is missing. Run init first.");
            return sendJson(response, project.config);
          }
          if (url.pathname === "/config" && method === "PUT") {
            const project = requireConnection();
            const body = await readJson(request);
            const config = normalizeConfig(body.config ?? body);
            await saveConfig(project.projectPath, config);
            connected = { ...project, config, configError: undefined };
            return sendJson(response, config);
          }
          return next();
        } catch (error) {
          const status = error instanceof AppForgeError && /not connected|no project connected|missing/i.test(error.message) ? 404 : 400;
          return sendJson(response, { error: error instanceof Error ? error.message : String(error) }, status);
        }
      });
      server.httpServer?.once("close", () => { void devRuntime.stop(); });
    },
  };
}

function requireConnection(): ProjectState {
  if (!connected) throw new AppForgeError("No project connected. Connect a project first.");
  return connected;
}

function parseTarget(value: unknown): Target {
  if (value === "desktop") return "electron";
  if (value === "mobile") return "capacitor";
  if (value === "electron" || value === "capacitor") return value;
  throw new AppForgeError('target must be "desktop", "mobile", "electron", or "capacitor".');
}

function normalizeConfig(value: unknown): Parameters<typeof saveConfig>[1] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppForgeError("Configuration must be an object.");
  const config = value as Record<string, unknown>;
  if (!Array.isArray(config.targets)) return value as Parameters<typeof saveConfig>[1];
  return { ...config, targets: config.targets.map((target) => parseTarget(target)) } as Parameters<typeof saveConfig>[1];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppForgeError(`${field} must be a non-empty string.`);
  return value;
}

async function readJson(request: { [key: string]: unknown; on: (event: string, listener: (...args: any[]) => void) => void }): Promise<Record<string, any>> {
  let raw = "";
  for await (const chunk of request as AsyncIterable<Buffer | string>) raw += chunk.toString();
  if (!raw.trim()) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppForgeError("Request body must be a JSON object.");
  return value as Record<string, any>;
}

function sendJson(response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, value: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? (process.env.GITHUB_ACTIONS ? "/Appforge/" : "/"),
  plugins: [appForgeApi()],
});
