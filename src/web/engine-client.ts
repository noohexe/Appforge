import type { AppForgeConfig, ProjectDetection, Target } from "../types.js";

export interface ProjectState {
  projectPath: string;
  detection: ProjectDetection;
  config?: AppForgeConfig;
  configError?: string;
}

export interface EngineHealth {
  status: "ok" | "unavailable";
  name: string;
  version: string;
  engine: boolean;
  mode: "local" | "remote" | "static";
}

export interface EngineClient {
  readonly mode: EngineHealth["mode"];
  request<T>(endpoint: string, options?: { method?: string; body?: unknown }): Promise<T>;
  health(): Promise<EngineHealth>;
  connect(projectPath: string): Promise<ProjectState>;
  project(): Promise<ProjectState>;
  init(force?: boolean): Promise<ProjectState>;
  addTarget(target: "desktop" | "mobile"): Promise<unknown>;
  removeTarget(target: "desktop" | "mobile"): Promise<unknown>;
  build(target?: "desktop" | "mobile"): Promise<unknown>;
  doctor(): Promise<{ statuses: string[] }>;
  history(): Promise<unknown[]>;
  devStatus(): Promise<unknown>;
  startDev(): Promise<unknown>;
  stopDev(): Promise<unknown>;
  saveConfig(config: AppForgeConfig): Promise<AppForgeConfig>;
  clean(): Promise<unknown>;
}

export function createEngineClient(): EngineClient {
  const apiUrl = (import.meta.env.VITE_APPFORGE_API_URL as string | undefined)?.replace(/\/$/, "");
  if (apiUrl) return new HttpEngineClient(apiUrl, "remote");
  if (import.meta.env.DEV) return new HttpEngineClient("", "local");
  return new StaticEngineClient();
}

class HttpEngineClient implements EngineClient {
  constructor(private readonly baseUrl: string, public readonly mode: "local" | "remote") {}

  health(): Promise<EngineHealth> { return this.request<EngineHealth>("/health"); }
  connect(projectPath: string): Promise<ProjectState> { return this.request("/connect", { method: "POST", body: { projectPath } }); }
  project(): Promise<ProjectState> { return this.request("/project"); }
  init(force = false): Promise<ProjectState> { return this.request("/init", { method: "POST", body: { force } }); }
  addTarget(target: "desktop" | "mobile"): Promise<unknown> { return this.request("/targets", { method: "POST", body: { target } }); }
  removeTarget(target: "desktop" | "mobile"): Promise<unknown> { return this.request("/targets", { method: "DELETE", body: { target } }); }
  build(target?: "desktop" | "mobile"): Promise<unknown> { return this.request("/build", { method: "POST", body: target ? { target } : {} }); }
  doctor(): Promise<{ statuses: string[] }> { return this.request("/doctor"); }
  history(): Promise<unknown[]> { return this.request("/history"); }
  devStatus(): Promise<unknown> { return this.request("/dev"); }
  startDev(): Promise<unknown> { return this.request("/dev/start", { method: "POST", body: {} }); }
  stopDev(): Promise<unknown> { return this.request("/dev/stop", { method: "POST", body: {} }); }
  saveConfig(config: AppForgeConfig): Promise<AppForgeConfig> { return this.request("/config", { method: "PUT", body: config }); }
  clean(): Promise<unknown> { return this.request("/clean", { method: "POST", body: {} }); }

  async request<T>(endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api${endpoint}`, {
      method: options.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Engine request failed (${response.status})`);
    return body;
  }
}

class StaticEngineClient implements EngineClient {
  readonly mode = "static" as const;
  health(): Promise<EngineHealth> { return Promise.resolve({ status: "unavailable", name: "AppForge", version: "0.1.0", engine: false, mode: this.mode }); }
  request<T>(): Promise<T> { return this.unavailable(); }
  private unavailable<T>(): Promise<T> { return Promise.reject(new Error("The hosted dashboard is static. Run npm run dev locally to connect the AppForge engine.")); }
  connect(projectPath: string): Promise<ProjectState> { void projectPath; return this.unavailable(); }
  project(): Promise<ProjectState> { return this.unavailable(); }
  init(force?: boolean): Promise<ProjectState> { void force; return this.unavailable(); }
  addTarget(target: "desktop" | "mobile"): Promise<unknown> { void target; return this.unavailable(); }
  removeTarget(target: "desktop" | "mobile"): Promise<unknown> { void target; return this.unavailable(); }
  build(target?: "desktop" | "mobile"): Promise<unknown> { void target; return this.unavailable(); }
  doctor(): Promise<{ statuses: string[] }> { return this.unavailable(); }
  history(): Promise<unknown[]> { return this.unavailable(); }
  devStatus(): Promise<unknown> { return this.unavailable(); }
  startDev(): Promise<unknown> { return this.unavailable(); }
  stopDev(): Promise<unknown> { return this.unavailable(); }
  saveConfig(config: AppForgeConfig): Promise<AppForgeConfig> { void config; return this.unavailable(); }
  clean(): Promise<unknown> { return this.unavailable(); }
}
