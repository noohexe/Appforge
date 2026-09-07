# AppForge

AppForge detects an existing web project, creates a validated `appforge.config.json`, builds its web assets, and generates target-owned desktop or mobile projects.

## Commands

Run the web dashboard with `npm run dev`. Run the CLI with `npm run cli -- <command> --dir <project>` or build it and use `dist/cli.js`.

- `init` detects the package manager and framework and creates `appforge.config.json`.
- `detect` prints package-manager, framework, build, and output-directory detection.
- `config` validates and prints the configuration.
- `add desktop|mobile` registers the Electron or Capacitor adapter and generates only `.appforge/targets/<target>` when web output already exists. Run `build` first when it does not.
- `remove desktop|mobile` unregisters a target and removes only its owned output.
- `info` prints detection and configuration together.
- `clean` removes `.appforge` only; source files and web build output are preserved.
- `build` runs `web.buildCommand` from `web.root` with shell execution disabled, verifies `web.outputDirectory`, copies assets into configured targets, and dispatches their native boundary. Use `build --target desktop|mobile` to select one configured target.
- `dev` launches the web preview server from `web.root`, preferring the `dev` then `start` package script through the detected package manager. Output is streamed live and Ctrl-C stops it cleanly. This is a browser/web preview, not a native Electron or mobile preview.
- `doctor` reports configuration and prerequisite status.

Configuration shape:

```json
{
  "name": "my-web-app",
  "web": {
    "root": ".",
    "buildCommand": "vite build",
    "outputDirectory": "dist",
    "devCommand": "",
    "devUrl": "http://localhost:5173"
  },
  "targets": ["electron"]
}
```

Package-manager detection uses `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` or `bun.lock`, and `package-lock.json`. Framework detection uses installed dependencies and common config files for Next, Vite, React, Vue, Svelte, Angular, Nuxt, and Astro.

## Generated targets

Electron output is written to `.appforge/targets/electron/` with a generated `package.json`, secure `main.cjs` and `preload.cjs`, and copied web files under `web/`. The BrowserWindow uses context isolation, sandboxing, and disabled Node integration. Electron packaging runs only when a local `electron-builder` executable exists; otherwise AppForge reports that packaging was skipped.

Capacitor output is written to `.appforge/targets/capacitor/` with `package.json`, `capacitor.config.ts`, and copied web files under `www/`. A local Capacitor CLI is used for `cap sync` when available. AppForge does not invent Android or iOS projects or artifacts: add those platforms with Capacitor after installing the required dependencies and native SDKs.

Generated files are idempotently refreshed and are AppForge-owned. `remove` and `clean` never remove web source or web build output.

## Prerequisites and limitations

Node.js and a supported package manager lockfile are required when `web.buildCommand` refers to the package's `build` script. A direct command such as `vite build` is executed as a structured, shell-free process from `web.root`; shell operators are rejected. Electron packaging requires Electron Builder and its platform toolchain. Capacitor sync requires `@capacitor/core` and `@capacitor/cli`; Android requires the Android SDK, and iOS requires macOS/Xcode. Run `doctor` for the detected local status.

## Development

```sh
npm install
npm run dev
# AppForge dashboard: http://localhost:5173/

# CLI commands remain available separately
npm run cli -- --help
npm test
npm run build
```

The dashboard is the browser-facing shell for AppForge. `npm run dev` starts Vite with an in-process API bridge, so browser code never reads arbitrary local filesystem paths. Enter a project path with Connect, then use Init, Add Desktop/Mobile, Build, Doctor, and Clean. These controls call the same detection, configuration, target adapters, process runner, and safe cleanup used by the CLI.

The bridge keeps one connected project in memory for the Vite process. Its endpoints are `POST /api/connect`, `GET /api/project`, `POST /api/init`, `GET|PUT /api/config`, `POST|DELETE /api/targets`, `POST /api/build`, `GET /api/history`, `GET /api/doctor`, `POST /api/clean`, `POST /api/dev/start`, `POST /api/dev/stop`, and `GET /api/dev`. Configuration updates are schema-validated, UI target names are converted to the internal Electron/Capacitor names, and project-relative paths are constrained by AppForge's existing safety checks.

Successful and failed build attempts are appended to `.appforge/history/builds.json` with target, timestamp, duration, output paths, and error details. The dashboard Builds view reads these records; it does not create records for unexecuted work. The Development view manages one shell-free child process, captures stdout/stderr, detects configured or printed URLs, and stops the process when requested or when the Vite server closes.

The dashboard can start, stop, and open a configured or detected web preview. Native packaging remains honest: Electron Builder and Capacitor CLI are only run when available, and AppForge does not invent Android/iOS projects or artifacts. Target status in Doctor reflects the local adapter prerequisites; a generated skeleton or Capacitor sync is not reported as an installable native package.