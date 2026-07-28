import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const manifestPath = join(scriptDirectory, "public-export-files.json");

const generatedDirectoryNames = new Set([
  ".git",
  ".gradle",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "release",
]);

const forbiddenFileNames = [
  /^\.env(?:\.|$)/i,
  /^\.dev\.vars(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:jks|key|keystore|p12|pfx|pem)$/i,
];

const binaryExtensions = new Set([
  ".gif",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".png",
  ".webp",
  ".zip",
]);

const contentRules = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i,
  },
  {
    id: "known-token-prefix",
    pattern:
      /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,})\b/,
  },
  {
    id: "secret-literal",
    pattern:
      /\b(?:account[_-]?id|api[_-]?key|api[_-]?token|auth[_-]?token|master[_-]?secret|password|private[_-]?key)\b\s*[:=]\s*["'][^"'<>]{8,}["']/i,
  },
  {
    id: "bearer-literal",
    pattern: /\bAuthorization\b\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._~+/-]{12,}["']/i,
  },
  {
    id: "pairing-uri",
    pattern:
      /\bcodexphone:\/\/pair\?[^\s"'<>]*(?:room|secret)=[^\s"'<>]+/i,
  },
  {
    id: "personal-windows-path",
    pattern: /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'<>]+/i,
  },
  {
    id: "local-absolute-path",
    pattern: /\b[A-Za-z]:[\\/](?![\\/])[^"'<>]*[\\/][^"'<>]*/i,
  },
  {
    id: "personal-posix-path",
    pattern: /(?:^|[\s"'(])\/(?:Users|home)\/[^/\s"'<>]+/i,
  },
  {
    id: "workers-dev-endpoint",
    pattern: /https?:\/\/[a-z0-9.-]+\.workers\.dev\b/i,
  },
  {
    id: "email-address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
];

const normalizePath = (value) => value.replaceAll("\\", "/").replace(/^\.\/+/, "");

const matchesPattern = (filePath, pattern) => {
  const normalized = normalizePath(filePath);
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  return normalized === pattern;
};

const isSyntheticFixture = (filePath, manifest) =>
  manifest.syntheticFixturePaths.some((pattern) =>
    matchesPattern(filePath, pattern),
  );

const isSafeExampleWorkersEndpoint = (line) =>
  /https?:\/\/(?:relay\.)?example\.workers\.dev\b/i.test(line);

const isBinary = (buffer, filePath) =>
  binaryExtensions.has(extname(filePath).toLowerCase()) ||
  buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);

const getManifest = async () =>
  JSON.parse(await readFile(manifestPath, "utf8"));

const getGitFiles = (includeUntracked) => {
  const args = includeUntracked
    ? ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]
    : ["ls-files", "-z"];
  const output = execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .filter(Boolean)
    .map(normalizePath)
    .sort();
};

const readGitBlob = (filePath) =>
  execFileSync("git", ["show", `:${filePath}`], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });

const existingWorkingTreeFiles = async (files) => {
  const existing = [];
  for (const filePath of files) {
    try {
      await access(resolve(repositoryRoot, filePath));
      existing.push(filePath);
    } catch {
      // A tracked deletion is not part of a working-tree export candidate.
    }
  }
  return existing;
};

const walkDirectory = async (directory, root = directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === ".git") {
      continue;
    }
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (generatedDirectoryNames.has(entry.name)) {
        files.push(normalizePath(relative(root, absolutePath)));
        continue;
      }
      files.push(...(await walkDirectory(absolutePath, root)));
    } else if (entry.isFile()) {
      files.push(normalizePath(relative(root, absolutePath)));
    }
  }
  return files.sort();
};

const classifyGitFiles = (files, manifest) => {
  const included = [];
  const excluded = [];
  const unclassified = [];

  for (const filePath of files) {
    if (manifest.include.some((pattern) => matchesPattern(filePath, pattern))) {
      included.push(filePath);
    } else if (
      manifest.exclude.some((pattern) => matchesPattern(filePath, pattern))
    ) {
      excluded.push(filePath);
    } else {
      unclassified.push(filePath);
    }
  }

  return { included, excluded, unclassified };
};

const auditPaths = async (root, files, manifest, readBuffer) => {
  const findings = [];
  let binaryFiles = 0;

  for (const filePath of files) {
    const segments = normalizePath(filePath).split("/");
    const generatedSegment = segments.find((segment) =>
      generatedDirectoryNames.has(segment),
    );
    if (generatedSegment) {
      findings.push({ id: "generated-directory", filePath });
      continue;
    }

    if (forbiddenFileNames.some((pattern) => pattern.test(basename(filePath)))) {
      findings.push({ id: "secret-or-environment-file", filePath });
      continue;
    }

    const buffer = await readBuffer(root, filePath);
    if (isBinary(buffer, filePath)) {
      binaryFiles += 1;
      continue;
    }

    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const rule of contentRules) {
        if (!rule.pattern.test(line)) {
          continue;
        }
        if (
          rule.id === "email-address" &&
          basename(filePath).toLowerCase() === "package-lock.json"
        ) {
          continue;
        }
        if (
          rule.id === "workers-dev-endpoint" &&
          isSafeExampleWorkersEndpoint(line)
        ) {
          continue;
        }
        if (
          isSyntheticFixture(filePath, manifest) &&
          [
            "local-absolute-path",
            "pairing-uri",
            "personal-windows-path",
          ].includes(rule.id)
        ) {
          continue;
        }
        findings.push({
          id: rule.id,
          filePath,
          line: index + 1,
        });
      }
    }
  }

  return { findings, binaryFiles };
};

const parseArguments = () => {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args[0] === "--tracked" && args.length === 1)) {
    return { mode: "tracked", includeUntracked: false };
  }
  if (args[0] === "--working-tree" && args.length === 1) {
    return { mode: "tracked", includeUntracked: true };
  }
  if (args[0] === "--all-tracked" && args.length === 1) {
    return { mode: "all-tracked", includeUntracked: false };
  }
  if (args[0] === "--directory" && args[1] && args.length === 2) {
    return { mode: "directory", directory: resolve(args[1]) };
  }
  throw new Error(
    "Usage: node scripts/audit-public-release.mjs "
      + "[--tracked|--working-tree|--all-tracked|--directory <path>]",
  );
};

const main = async () => {
  const options = parseArguments();
  const manifest = await getManifest();
  let root;
  let files;
  let excludedCount = 0;
  let readBuffer = (base, filePath) => readFile(resolve(base, filePath));
  const classificationFindings = [];

  if (options.mode === "directory") {
    root = options.directory;
    files = await walkDirectory(root);
    for (const filePath of files) {
      if (
        !manifest.include.some((pattern) => matchesPattern(filePath, pattern)) &&
        !manifest.publicOutputOnly.some((pattern) =>
          matchesPattern(filePath, pattern)
        )
      ) {
        classificationFindings.push({
          id: "file-not-in-public-manifest",
          filePath,
        });
      }
    }
  } else {
    root = repositoryRoot;
    const listedGitFiles = getGitFiles(options.includeUntracked);
    const gitFiles = options.includeUntracked
      ? await existingWorkingTreeFiles(listedGitFiles)
      : listedGitFiles;
    if (!options.includeUntracked) {
      readBuffer = (_base, filePath) => readGitBlob(filePath);
    }
    if (options.mode === "all-tracked") {
      files = gitFiles;
    } else {
      const classification = classifyGitFiles(gitFiles, manifest);
      files = classification.included;
      excludedCount = classification.excluded.length;
      for (const filePath of classification.unclassified) {
        classificationFindings.push({
          id: "unclassified-tracked-file",
          filePath,
        });
      }
    }
  }

  const { findings, binaryFiles } = await auditPaths(
    root,
    files,
    manifest,
    readBuffer,
  );
  const allFindings = [...classificationFindings, ...findings];

  console.log(
    `Public release audit scanned ${files.length} files; `
      + `${binaryFiles} binary files require separate provenance review; `
      + `${excludedCount} private files were excluded by the manifest.`,
  );

  for (const finding of allFindings) {
    const location = finding.line
      ? `${finding.filePath}:${finding.line}`
      : finding.filePath;
    console.error(`FAIL [${finding.id}] ${location}`);
  }

  if (allFindings.length > 0) {
    console.error(
      `Public release audit failed with ${allFindings.length} finding(s).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("Public release audit passed without printing matched content.");
};

await main();
