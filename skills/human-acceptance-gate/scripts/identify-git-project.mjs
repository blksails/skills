#!/usr/bin/env node

import {
  collectChangedFiles,
  identifyProject,
  loadRegistry,
  policyForSource,
  registryLocation,
} from "./human-acceptance-lib.mjs";

const project = identifyProject();
const registry = loadRegistry();
const policy = policyForSource(registry, project.source);
const change = collectChangedFiles(project.root, process.argv.slice(2));

process.stdout.write(
  `${JSON.stringify(
    {
      ...project,
      changeMode: change.mode,
      files: change.files,
      acceptancePolicy: {
        registered: Boolean(policy),
        source: policy?.source ?? null,
        registry: registryLocation(),
      },
    },
    null,
    2,
  )}\n`,
);
