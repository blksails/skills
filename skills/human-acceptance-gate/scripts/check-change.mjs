#!/usr/bin/env node

import {
  collectChangedFiles,
  commitTrailer,
  detectRules,
  identifyProject,
  loadRegistry,
  policyForSource,
  registryLocation,
} from "./human-acceptance-lib.mjs";

const project = identifyProject();
const registry = loadRegistry();
const policy = policyForSource(registry, project.source);
const change = collectChangedFiles(project.root, process.argv.slice(2));
const rules = detectRules(registry, policy, change.files);

process.stdout.write(
  `${JSON.stringify(
    {
      project,
      registry: registryLocation(),
      registered: Boolean(policy),
      changeMode: change.mode,
      files: change.files,
      required: rules.map(({ id, role, target, label, docs }) => ({
        id,
        role,
        target: target ?? null,
        label,
        docs,
      })),
      reportOfferRequired: rules.length > 0,
      reportDirectory: rules.length
        ? (registry.defaults?.reportDirectory ?? ".human-acceptance/reports")
        : null,
      trailer: commitTrailer(rules),
    },
    null,
    2,
  )}\n`,
);
