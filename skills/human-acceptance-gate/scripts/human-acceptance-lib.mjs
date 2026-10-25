import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registryPath = path.join(
  skillRoot,
  "references",
  "project-registry.json",
);

export function git(root, args, allowFailure = false) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

export function lines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeRemote(remoteUrl) {
  const value = remoteUrl.trim().replace(/\\/g, "/");
  const scpLike = value.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (scpLike && !value.includes("://")) {
    return `${scpLike[1].toLowerCase()}/${scpLike[2]}`
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
  }

  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname}`
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
  } catch {
    return value.replace(/\.git$/i, "").replace(/\/+$/, "");
  }
}

export function identifyProject(cwd = process.cwd()) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  const remotes = lines(
    git(root, ["config", "--get-regexp", "^remote\\..*\\.url$"], true),
  ).map((line) => {
    const separator = line.indexOf(" ");
    const key = line.slice(0, separator);
    const url = line.slice(separator + 1);
    return {
      name: key.match(/^remote\.(.+)\.url$/)?.[1] ?? key,
      url,
      source: normalizeRemote(url),
    };
  });
  const remote =
    remotes.find((candidate) => candidate.name === "origin") ??
    remotes[0] ??
    null;

  return {
    root,
    source: remote?.source ?? `local:${root}`,
    selectedRemote: remote,
    remotes,
    branch: git(root, ["branch", "--show-current"], true) || null,
    head: git(root, ["rev-parse", "HEAD"], true) || null,
  };
}

export function loadRegistry() {
  return JSON.parse(readFileSync(registryPath, "utf8"));
}

export function policyForSource(registry, source) {
  return registry.projects.find((project) => project.source === source) ?? null;
}

export function collectChangedFiles(root, args) {
  const rangeIndex = args.indexOf("--range");
  if (rangeIndex >= 0) {
    const range = args[rangeIndex + 1];
    if (!range) throw new Error("--range requires <base>..<head>");
    return {
      mode: `range:${range}`,
      files: lines(
        git(root, ["diff", "--name-only", "--diff-filter=ACMR", range]),
      ),
    };
  }

  if (args.includes("--staged")) {
    return {
      mode: "staged",
      files: lines(
        git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
      ),
    };
  }

  const changed = lines(
    git(root, ["diff", "--name-only", "--diff-filter=ACMR"]),
  );
  const staged = lines(
    git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
  );
  const untracked = lines(
    git(root, ["ls-files", "--others", "--exclude-standard"]),
  );
  return {
    mode: "worktree",
    files: [...new Set([...changed, ...staged, ...untracked])].sort(),
  };
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function expandBraces(glob) {
  const match = glob.match(/\{([^{}]+)\}/);
  if (!match) return [glob];
  return match[1]
    .split(",")
    .flatMap((part) =>
      expandBraces(
        `${glob.slice(0, match.index)}${part}${glob.slice(match.index + match[0].length)}`,
      ),
    );
}

export function globMatches(file, glob) {
  return expandBraces(glob).some((expanded) => {
    let expression = "^";
    for (let index = 0; index < expanded.length; index += 1) {
      const char = expanded[index];
      if (char === "*" && expanded[index + 1] === "*") {
        if (expanded[index + 2] === "/") {
          expression += "(?:.*/)?";
          index += 2;
        } else {
          expression += ".*";
          index += 1;
        }
      } else if (char === "*") {
        expression += "[^/]*";
      } else if (char === "?") {
        expression += "[^/]";
      } else {
        expression += escapeRegex(char);
      }
    }
    return new RegExp(`${expression}$`).test(file);
  });
}

function ruleMatches(rule, file) {
  const match = rule.match ?? {};
  return (
    (match.files ?? []).includes(file) ||
    (match.directories ?? []).some((directory) => file.startsWith(directory)) ||
    (match.globs ?? []).some((glob) => globMatches(file, glob))
  );
}

export function detectRules(registry, policy, files) {
  if (!policy) return [];
  const usableFiles = files.filter(
    (file) =>
      !(registry.defaults?.excludeGlobs ?? []).some((glob) =>
        globMatches(file, glob),
      ),
  );

  return policy.rules.filter((rule) =>
    usableFiles.some((file) => ruleMatches(rule, file)),
  );
}

export function commitTrailer(rules) {
  if (rules.length === 0) return "";
  const unique = [...new Map(rules.map((rule) => [rule.id, rule])).values()];
  return [
    "Manual-Acceptance-Required: yes",
    `Manual-Acceptance: ${unique.map((rule) => rule.id).join(", ")}`,
    `Manual-Acceptance-Docs: ${unique.map((rule) => rule.docs).join(", ")}`,
  ].join("\n");
}

export function registryLocation() {
  return registryPath;
}
