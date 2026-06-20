import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function buildAdapterPackage(adapter, data = {}) {
  const generatedAt = data.generatedAt ?? new Date().toISOString();

  return {
    label: `${adapter.label} (${adapter.mode})`,
    generatedAt,
    adapter: {
      id: adapter.id,
      label: adapter.label,
      kind: adapter.kind,
      mode: adapter.mode,
      sourceUrl: adapter.sourceUrl,
      notes: adapter.notes
    },
    results: data.results ?? [],
    fixtures: data.fixtures ?? [],
    teamPatches: data.teamPatches ?? [],
    warnings: data.warnings ?? []
  };
}

export async function writeAdapterOutput(payload, options) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (options.print) {
    process.stdout.write(json);
  }

  if (options.out) {
    const outputPath = resolve(options.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");
  }

  return json;
}

export function readValue(argv, index, name) {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}
