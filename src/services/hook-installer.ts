import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const USAGE_PET_MARKER = "USAGE_PET_HOOK=1";

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "SessionEnd",
] as const;

type JsonRecord = Record<string, unknown>;

export interface HookInstallResult {
  configPath: string;
  backupPath: string | null;
  command: string;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertSafeCommandValue = (value: string, label: string): string => {
  if (
    value.length === 0 ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new Error(`${label} contains characters unsafe for a Hook command`);
  }
  return value;
};

const powerShellLiteral = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;

export const buildUsagePetHookCommand = (
  executablePath: string,
  hookScriptPath: string,
  dataDirectory: string,
): string => {
  const executable = assertSafeCommandValue(
    resolve(executablePath),
    "Executable path",
  );
  const hookScript = assertSafeCommandValue(
    resolve(hookScriptPath),
    "Hook script path",
  );
  const data = assertSafeCommandValue(
    resolve(dataDirectory),
    "Data directory",
  );

  return [
    `$null = ${powerShellLiteral(USAGE_PET_MARKER)}`,
    "$env:ELECTRON_RUN_AS_NODE = '1'",
    "$env:USAGE_PET_HOOK = '1'",
    `$env:USAGE_PET_DATA_DIR = ${powerShellLiteral(data)}`,
    `& ${powerShellLiteral(executable)} ${powerShellLiteral(hookScript)}`,
  ].join("; ");
};

const isUsagePetHookGroup = (value: unknown): boolean => {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return false;
  }
  return value.hooks.some(
    (hook) =>
      isRecord(hook) &&
      typeof hook.command === "string" &&
      hook.command.includes(USAGE_PET_MARKER),
  );
};

export const mergeUsagePetHooks = (
  current: unknown,
  command: string,
): JsonRecord => {
  if (!isRecord(current)) {
    throw new Error("hooks.json must contain a JSON object");
  }
  if (
    current.hooks !== undefined &&
    !isRecord(current.hooks)
  ) {
    throw new Error("hooks.json hooks must contain a JSON object");
  }

  const hooks = isRecord(current.hooks) ? current.hooks : {};
  const nextHooks: JsonRecord = { ...hooks };
  for (const event of HOOK_EVENTS) {
    const existing = hooks[event];
    if (existing !== undefined && !Array.isArray(existing)) {
      throw new Error(`hooks.json ${event} must contain an array`);
    }
    const preserved = (Array.isArray(existing) ? existing : []).filter(
      (group) => !isUsagePetHookGroup(group),
    );
    nextHooks[event] = [
      ...preserved,
      {
        hooks: [
          {
            type: "command",
            command,
            timeout: 30,
          },
        ],
      },
    ];
  }

  return {
    ...current,
    hooks: nextHooks,
  };
};

export const installUsagePetHooks = (
  configPath: string,
  executablePath: string,
  hookScriptPath: string,
  dataDirectory: string,
): HookInstallResult => {
  const resolvedConfig = resolve(configPath);
  const command = buildUsagePetHookCommand(
    executablePath,
    hookScriptPath,
    dataDirectory,
  );
  let current: unknown = {};
  let backupPath: string | null = null;

  if (existsSync(resolvedConfig)) {
    current = JSON.parse(readFileSync(resolvedConfig, "utf8")) as unknown;
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    backupPath = `${resolvedConfig}.usage-pet-backup-${stamp}`;
    copyFileSync(resolvedConfig, backupPath);
  }

  const merged = mergeUsagePetHooks(current, command);
  mkdirSync(dirname(resolvedConfig), { recursive: true });
  const temporaryPath = `${resolvedConfig}.usage-pet-next`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(merged, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  renameSync(temporaryPath, resolvedConfig);

  return {
    configPath: resolvedConfig,
    backupPath,
    command,
  };
};
