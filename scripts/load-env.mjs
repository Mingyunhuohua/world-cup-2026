import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let loaded = false;

export async function loadEnvFile(path = resolve(".env")) {
  if (loaded) {
    return;
  }
  loaded = true;

  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
