#!/usr/bin/env node

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { resolveTypeScriptCompiler } from "./run-typescript.mjs";

// Compute the actual host compiler before Turbo hashes or restores its tasks.
process.env.REA_TYPESCRIPT_COMPILER = resolveTypeScriptCompiler().identity;
// InsideApp builds stay local: no telemetry, update checks, or remote cache.
process.env.TURBO_TELEMETRY_DISABLED = "1";
process.env.DO_NOT_TRACK = "1";
process.env.TURBO_NO_UPDATE_NOTIFIER = "1";
for (const name of ["TURBO_TOKEN", "TURBO_TEAM", "TURBO_TEAMID", "TURBO_API"])
  delete process.env[name];
const require = createRequire(import.meta.url);
await import(pathToFileURL(require.resolve("turbo/bin/turbo")).href);
