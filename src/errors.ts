export class AppForgeError extends Error {
  constructor(message: string, public readonly exitCode = 1) {
    super(message);
    this.name = "AppForgeError";
  }
}