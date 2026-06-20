import { pathToFileURL } from "node:url";
import { listAdapters, runAdapter } from "./adapters/index.mjs";
import { readValue, writeAdapterOutput } from "./adapters/core.mjs";

const usage = `Usage:
  npm run data:compose -- --adapter fifa-rankings --adapter odds-market --print
  npm run data:compose -- --source fifa-rankings=C:/tmp/rankings.csv --source recent-form=C:/tmp/recent-form.csv --out C:/tmp/worldcup-combined.json
  npm run data:compose -- --source news-sentiment=C:/tmp/news.csv --source odds-market=C:/tmp/odds.csv --label "Daily model input" --print

Options:
  --adapter <id>            Run an adapter without a local file, using its mock/manual output.
  --source <id=file>        Run an adapter with a local file. Repeat for multiple sources.
  --label <text>            Override the generated package label.
  --generated-at <iso>      Override generatedAt for deterministic tests or backfills.
  --out <path>              Write the combined JSON package.
  --print                   Print the combined JSON package.
  --list                    List available adapters.
`;

const dynamicTeamFields = new Set(["form", "injuries", "attack", "defense"]);

export function parseComposeArgs(argv) {
  const options = {
    sources: [],
    out: undefined,
    print: false,
    label: undefined,
    generatedAt: undefined,
    list: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--adapter") {
      options.sources.push({ adapter: readValue(argv, index, "--adapter"), file: undefined });
      index += 1;
      continue;
    }

    if (arg === "--source") {
      options.sources.push(parseSourceValue(readValue(argv, index, "--source")));
      index += 1;
      continue;
    }

    if (arg === "--label") {
      options.label = readValue(argv, index, "--label");
      index += 1;
      continue;
    }

    if (arg === "--generated-at") {
      options.generatedAt = readValue(argv, index, "--generated-at");
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.out = readValue(argv, index, "--out");
      index += 1;
      continue;
    }

    if (arg === "--print") {
      options.print = true;
      continue;
    }

    if (arg === "--list") {
      options.list = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.help && !options.list && options.sources.length === 0) {
    throw new Error("Pass at least one --adapter or --source.");
  }

  if (!options.help && !options.list && !options.print && !options.out) {
    throw new Error("Pass --out or --print.");
  }

  return options;
}

export async function runCompose(options) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packages = [];

  for (const source of options.sources) {
    packages.push(
      await runAdapter(source.adapter, {
        file: source.file,
        generatedAt
      })
    );
  }

  return composeAdapterPackages(packages, {
    generatedAt,
    label: options.label
  });
}

export function composeAdapterPackages(packages, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const adapters = packages.map((pkg) => pkg.adapter).filter(Boolean);
  const label =
    options.label ??
    `组合数据包 (${adapters.map((adapter) => adapter.id).join(", ") || "manual"})`;

  return {
    label,
    generatedAt,
    adapters,
    results: mergeRowsByKey(flattenPackages(packages, "results"), resultKey),
    fixtures: mergeRowsByKey(flattenPackages(packages, "fixtures"), fixtureKey),
    teamPatches: mergeTeamPatches(flattenPackages(packages, "teamPatches")),
    warnings: packages.flatMap((pkg) => pkg.warnings ?? [])
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseComposeArgs(argv);

  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }

  if (options.list) {
    await writeAdapterOutput({ adapters: listAdapters() }, { print: true });
    return;
  }

  const payload = await runCompose(options);
  await writeAdapterOutput(payload, options);
}

function parseSourceValue(value) {
  const separator = value.indexOf("=");

  if (separator === -1) {
    return { adapter: value, file: undefined };
  }

  const adapter = value.slice(0, separator).trim();
  const file = value.slice(separator + 1).trim();

  if (!adapter || !file) {
    throw new Error("--source must be formatted as adapter=file.");
  }

  return { adapter, file };
}

function flattenPackages(packages, key) {
  return packages.flatMap((pkg) => (Array.isArray(pkg[key]) ? pkg[key] : []));
}

function mergeRowsByKey(rows, keyReader) {
  const byKey = new Map();

  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`Merged row ${index + 1} must be an object.`);
    }

    const key = keyReader(row);
    if (!key) {
      throw new Error(`Merged row ${index + 1} is missing a stable ID.`);
    }

    byKey.set(key, {
      ...(byKey.get(key) ?? {}),
      ...row
    });
  });

  return [...byKey.values()];
}

function mergeTeamPatches(patches) {
  const byKey = new Map();
  const aliases = new Map();

  patches.forEach((patch, index) => {
    if (!isRecord(patch)) {
      throw new Error(`Team patch ${index + 1} must be an object.`);
    }

    const identity = readTeamIdentity(patch);
    if (!identity) {
      throw new Error(`Team patch ${index + 1} is missing id, teamId, or abbr.`);
    }

    const canonicalKey = resolveTeamKey(identity.keys, aliases);
    const current = byKey.get(canonicalKey) ?? {
      fields: {},
      numericSums: {},
      numericCounts: {}
    };

    for (const key of identity.keys) {
      aliases.set(key, canonicalKey);
    }

    mergeTeamPatchInto(current, patch);
    byKey.set(canonicalKey, current);
  });

  return [...byKey.values()].map(finalizeTeamPatch);
}

function mergeTeamPatchInto(accumulator, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") {
      continue;
    }

    if (key === "abbr" && typeof value === "string") {
      accumulator.fields.abbr = value.toUpperCase();
      continue;
    }

    if (dynamicTeamFields.has(key) && typeof value === "number" && Number.isFinite(value)) {
      accumulator.numericSums[key] = (accumulator.numericSums[key] ?? 0) + value;
      accumulator.numericCounts[key] = (accumulator.numericCounts[key] ?? 0) + 1;
      continue;
    }

    accumulator.fields[key] = value;
  }
}

function finalizeTeamPatch(accumulator) {
  const patch = { ...accumulator.fields };

  for (const field of dynamicTeamFields) {
    const count = accumulator.numericCounts[field] ?? 0;

    if (count > 0) {
      patch[field] = roundTo(accumulator.numericSums[field] / count, 4);
    }
  }

  return patch;
}

function resolveTeamKey(keys, aliases) {
  for (const key of keys) {
    const existing = aliases.get(key);

    if (existing) {
      return existing;
    }
  }

  return keys[0];
}

function readTeamIdentity(patch) {
  const id = readString(patch, "id") ?? readString(patch, "teamId");
  const abbr = readString(patch, "abbr");
  const keys = [];

  if (id) {
    keys.push(`id:${id}`);
  }

  if (abbr) {
    keys.push(`abbr:${abbr.toUpperCase()}`);
  }

  return keys.length > 0 ? { keys } : undefined;
}

function resultKey(row) {
  return readString(row, "matchId") ?? readString(row, "id");
}

function fixtureKey(row) {
  return readString(row, "id");
}

function readString(record, key) {
  const value = record[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function roundTo(value, decimals) {
  const scale = 10 ** decimals;

  return Math.round(value * scale) / scale;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`${usage}\n`);
    process.exitCode = 1;
  });
}
