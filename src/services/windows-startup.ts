import { win32 } from "node:path";

export const resolveWindowsStartupExecutable = (
  processExecutable: string,
  portableExecutableFile: string | undefined,
): string => {
  const portable = portableExecutableFile?.trim();
  if (
    portable &&
    win32.isAbsolute(portable) &&
    win32.extname(portable).toLowerCase() === ".exe"
  ) {
    return win32.normalize(portable);
  }
  return win32.normalize(processExecutable);
};
