import { spawn } from "node:child_process";
import { AppForgeError } from "./errors.js";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
  interrupted?: boolean;
}

export type ProcessRunner = (command: string, args: string[], cwd: string) => Promise<ProcessResult>;

export type ProcessOutputHandler = (stream: "stdout" | "stderr", chunk: string) => void;

export function runProcess(command: string, args: string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => reject(new AppForgeError(`Could not run ${command}: ${error.message}`)));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function runStreamingProcess(command: string, args: string[], cwd: string, onOutput: ProcessOutputHandler): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, detached: process.platform !== "win32" });
    let stdout = "";
    let stderr = "";
    let interrupted = false;
    const forwardInterrupt = () => {
      interrupted = true;
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGINT");
      else child.kill("SIGINT");
    };
    const cleanup = () => process.removeListener("SIGINT", forwardInterrupt);
    process.once("SIGINT", forwardInterrupt);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onOutput("stdout", text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onOutput("stderr", text);
    });
    child.on("error", (error) => {
      cleanup();
      reject(new AppForgeError(`Could not run ${command}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      cleanup();
      resolve({ code: code ?? (interrupted || signal ? 130 : 1), stdout, stderr, interrupted: interrupted || signal === "SIGINT" });
    });
  });
}