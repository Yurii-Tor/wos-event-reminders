import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("staging Worker uses a separate D1 database", () => {
  const production = config.d1_databases.find(({ binding }) => binding === "DB");
  const staging = config.env.staging.d1_databases.find(
    ({ binding }) => binding === "DB",
  );

  assert.ok(production);
  assert.ok(staging);
  assert.notEqual(staging.database_id, production.database_id);
  assert.notEqual(staging.database_name, production.database_name);
  assert.equal(staging.database_name, "wos-event-reminders-staging-db");
  assert.equal(config.env.staging.workers_dev, true);
  assert.equal(config.env.staging.vars.APP_ENVIRONMENT, "staging");
});

test("remote staging commands select the staging environment explicitly", () => {
  const previewCommand = packageJson.scripts["preview:staging"];
  const migrationCommand = packageJson.scripts["db:staging:migrate"];

  assert.match(previewCommand, /^wrangler versions upload /);
  assert.match(previewCommand, /--env staging$/);
  assert.match(migrationCommand, /wos-event-reminders-staging-db/);
  assert.match(migrationCommand, /--remote/);
  assert.match(migrationCommand, /--env staging$/);
  assert.doesNotMatch(migrationCommand, /wos-event-reminders-db(?:\s|$)/);
});
