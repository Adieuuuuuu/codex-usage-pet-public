import assert from "node:assert/strict";
import test from "node:test";

import { resolveWindowsStartupExecutable } from "../src/services/windows-startup.ts";

test("uses the stable portable launcher for Windows login startup", () => {
  assert.equal(
    resolveWindowsStartupExecutable(
      "C:\\Users\\Adie\\AppData\\Local\\Temp\\portable\\Usage Pet.exe",
      "D:\\Apps\\Usage-Pet-Portable.exe",
    ),
    "D:\\Apps\\Usage-Pet-Portable.exe",
  );
});

test("uses the installed process path when no valid portable launcher exists", () => {
  const installed =
    "C:\\Users\\Adie\\AppData\\Local\\Programs\\Usage Pet\\Usage Pet.exe";
  assert.equal(
    resolveWindowsStartupExecutable(installed, undefined),
    installed,
  );
  assert.equal(
    resolveWindowsStartupExecutable(installed, "relative\\Usage Pet.exe"),
    installed,
  );
});
