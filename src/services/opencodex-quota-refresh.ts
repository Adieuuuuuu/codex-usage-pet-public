import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OPENCODEX_QUOTA_REFRESH_INTERVAL_MS = 4 * 60 * 60_000;
export const OPENCODEX_QUOTA_REFRESH_TIMEOUT_MS = 10_000;

export interface OpenCodexQuotaRefreshCommand {
  file: string;
  args: readonly string[];
}

export type OpenCodexQuotaRefreshRunner = (
  command: OpenCodexQuotaRefreshCommand,
) => Promise<void>;

export const resolveOpenCodexQuotaRefreshCommand = (
  platform = process.platform,
  comSpec = process.env.ComSpec,
): OpenCodexQuotaRefreshCommand =>
  platform === "win32"
    ? {
        file:
          comSpec?.trim() ||
          "C:\\Windows\\System32\\cmd.exe",
        args: [
          "/d",
          "/s",
          "/c",
          "ocx.cmd account refresh openai --json",
        ],
      }
    : {
        file: "ocx",
        args: ["account", "refresh", "openai", "--json"],
      };

const runRefreshCommand: OpenCodexQuotaRefreshRunner = async ({
  file,
  args,
}) => {
  await execFileAsync(file, [...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1_024,
    timeout: OPENCODEX_QUOTA_REFRESH_TIMEOUT_MS,
    windowsHide: true,
  });
};

export class OpenCodexQuotaRefresher {
  readonly #runner: OpenCodexQuotaRefreshRunner;
  readonly #command: OpenCodexQuotaRefreshCommand;
  #inFlight: Promise<boolean> | null = null;

  constructor(
    runner: OpenCodexQuotaRefreshRunner = runRefreshCommand,
    command = resolveOpenCodexQuotaRefreshCommand(),
  ) {
    this.#runner = runner;
    this.#command = command;
  }

  refresh(): Promise<boolean> {
    if (this.#inFlight !== null) {
      return this.#inFlight;
    }
    const request = this.#runner(this.#command)
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        if (this.#inFlight === request) {
          this.#inFlight = null;
        }
      });
    this.#inFlight = request;
    return request;
  }
}
