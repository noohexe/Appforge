export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export type Framework =
  | "next"
  | "vite"
  | "react"
  | "vue"
  | "svelte"
  | "angular"
  | "nuxt"
  | "astro"
  | "unknown";

export type Target = "electron" | "capacitor";

export interface ProjectDetection {
  root: string;
  packageManager: PackageManager;
  framework: Framework;
  packageName?: string;
  buildCommand?: string;
  devScript?: "dev" | "start";
  outputDirectory?: string;
  packageJson: boolean;
  lockfile?: string;
  evidence: string[];
}

export interface AppForgeConfig {
  $schema?: string;
  name: string;
  web: {
    root: string;
    buildCommand: string;
    outputDirectory: string;
    devCommand?: string;
    devUrl?: string;
  };
  targets: Target[];
}