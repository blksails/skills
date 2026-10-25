#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  detectRules,
  globMatches,
  loadRegistry,
  policyForSource,
} from "./human-acceptance-lib.mjs";

const registry = loadRegistry();
const roles = new Set([
  "caller",
  "implementer",
  "upstream",
  "downstream",
  "data-contract",
]);

assert.equal(registry.version, 1);
assert.ok(Array.isArray(registry.projects));
assert.ok(globMatches("README.md", "**/*.md"));
assert.ok(
  globMatches(
    "migrations/20261001_create_pushes.sql",
    "migrations/*{push,pushed,tracks,workflow}*.sql",
  ),
);

for (const project of registry.projects) {
  assert.match(project.source, /^github\.com\/[^/]+\/[^/]+$/);
  assert.ok(project.rules.length > 0, `${project.source} has no rules`);
  for (const rule of project.rules) {
    assert.ok(
      roles.has(rule.role),
      `${project.source}:${rule.id} has bad role`,
    );
    if (rule.role === "caller") {
      assert.ok(
        rule.target,
        `${project.source}:${rule.id} caller has no direct target`,
      );
    }
    assert.ok(rule.docs, `${project.source}:${rule.id} has no docs`);
    const match = rule.match ?? {};
    const positive = [
      ...(match.files ?? []),
      ...(match.directories ?? []),
      ...(match.globs ?? []),
    ];
    assert.ok(positive.length > 0, `${project.source}:${rule.id} has no paths`);
    assert.ok(
      !positive.includes("**") && !positive.includes(""),
      `${project.source}:${rule.id} contains a repository-wide match`,
    );
  }
}

function detected(source, files) {
  const policy = policyForSource(registry, source);
  return detectRules(registry, policy, files).map((rule) => rule.id);
}

assert.deepEqual(
  detected("github.com/blksails/webapp", [
    "apps/web/lib/wxmini/component-domains.ts",
  ]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/webapp", ["apps/web/components/button.tsx"]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/webapp", [
    "apps/web/app/(console)/[company_namespace]/wxmini/domains/design.md",
  ]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/wxmini", [
    "src/storage/webview-verify-uploader.ts",
  ]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/admin", ["app/ablinks/node/page.tsx"]),
  ["ablink"],
);
assert.deepEqual(
  detected("github.com/blksails/admin", ["app/settings/page.tsx"]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/ablink", ["services/ablink/service.go"]),
  ["ablink"],
);
assert.deepEqual(
  detected("github.com/blksails/ablink", ["model/ablink.go"]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/feedback", ["server/ingest.go"]),
  ["feedback", "workflow-pushback"],
);
assert.deepEqual(
  detected("github.com/blksails/feedback", ["server/ingest_test.go"]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/rtt", ["examples/feedback_online.rtt"]),
  ["feedback"],
);
assert.deepEqual(
  detected("github.com/blksails/rtt", ["internal/runtime/runtime.go"]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/wxwork", ["internal/autoconfig/engine.go"]),
  ["wxwork-autoconfig"],
);
assert.deepEqual(
  detected("github.com/blksails/wxwork", ["server/handlers/member.go"]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/wxworkclient", ["client_generated.go"]),
  ["wxwork-autoconfig"],
);
assert.deepEqual(
  detected("github.com/blksails/workflow", [
    "activity/pushback/platform_gdt_v3.go",
  ]),
  ["workflow-pushback"],
);
assert.deepEqual(
  detected("github.com/blksails/workflow", [
    "activity/material_sync/activity.go",
  ]),
  [],
);
assert.deepEqual(
  detected("github.com/blksails/supabase", [
    "migrations/20261001_create_pushback_dispatch.sql",
  ]),
  ["workflow-pushback"],
);
assert.deepEqual(
  detected("github.com/blksails/supabase", [
    "migrations/20261001_create_materials.sql",
  ]),
  [],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", ["services/review/service.go"]),
  ["crm-review"],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", [
    "internal/review/model/review_target_test.go",
  ]),
  [],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", [
    "services/advertiser/batchpolicylabel/submit.go",
  ]),
  ["crm-policy-label"],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", ["model/policylabel.entity.go"]),
  [],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", ["model/policylabel_review.go"]),
  ["crm-review", "crm-policy-label"],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", [
    "migrations/20260105_create_policy_label_review_template.sql",
  ]),
  ["crm-review", "crm-policy-label"],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", [
    "services/contentreview/service.go",
  ]),
  [],
);
assert.deepEqual(
  detected("github.com/hnhuaxi/crm_core", ["services/customer/service.go"]),
  [],
);
assert.equal(
  policyForSource(registry, "github.com/example/unregistered"),
  null,
);

process.stdout.write(
  `Validated ${registry.projects.length} repositories with path-scoped rules.\n`,
);
