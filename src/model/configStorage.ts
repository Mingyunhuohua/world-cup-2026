import type { ModelConfig } from "../types.ts";
import { defaultModelConfig } from "./config.ts";
import { modelConfigKeys } from "./presets.ts";

const storageKey = "worldcup-2026-model-config";
const storageVersion = 1;

type StoredModelConfig = {
  version: number;
  savedAt: string;
  config: ModelConfig;
};

type ModelConfigStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type ModelConfigLoad = {
  config: ModelConfig;
  restored: boolean;
  savedAt?: string;
  error?: string;
};

export function normalizeModelConfig(value: unknown): ModelConfig {
  if (!isRecord(value)) {
    throw new Error("模型参数必须是对象。");
  }

  const config = { ...defaultModelConfig };

  for (const key of modelConfigKeys) {
    const nextValue = value[key];
    if (nextValue === undefined) {
      continue;
    }

    if (typeof nextValue !== "number" || !Number.isFinite(nextValue)) {
      throw new Error(`模型参数 ${key} 必须是有效数字。`);
    }

    config[key] = nextValue;
  }

  return config;
}

export function loadModelConfig(
  fallback: ModelConfig = defaultModelConfig,
  storage = getBrowserStorage()
): ModelConfigLoad {
  if (!storage) {
    return { config: fallback, restored: false };
  }

  try {
    const rawValue = storage.getItem(storageKey);
    if (!rawValue) {
      return { config: fallback, restored: false };
    }

    const parsed: unknown = JSON.parse(rawValue);
    if (!isStoredModelConfig(parsed)) {
      return {
        config: fallback,
        restored: false,
        error: "本地模型参数格式不兼容，已回退默认配置。"
      };
    }

    return {
      config: parsed.config,
      restored: true,
      savedAt: parsed.savedAt
    };
  } catch {
    return {
      config: fallback,
      restored: false,
      error: "本地模型参数读取失败，已回退默认配置。"
    };
  }
}

export function saveModelConfig(
  config: ModelConfig,
  storage = getBrowserStorage()
): string | undefined {
  if (!storage) {
    return undefined;
  }

  const savedAt = new Date().toISOString();
  const payload: StoredModelConfig = {
    version: storageVersion,
    savedAt,
    config: normalizeModelConfig(config)
  };

  storage.setItem(storageKey, JSON.stringify(payload));

  return savedAt;
}

export function clearModelConfig(storage = getBrowserStorage()): void {
  storage?.removeItem(storageKey);
}

export function serializeModelConfig(config: ModelConfig): string {
  return JSON.stringify(
    {
      version: storageVersion,
      exportedAt: new Date().toISOString(),
      config: normalizeModelConfig(config)
    },
    null,
    2
  );
}

export function parseModelConfigImport(jsonText: string): ModelConfig {
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (isRecord(parsed) && "config" in parsed) {
      return normalizeModelConfig(parsed.config);
    }

    return normalizeModelConfig(parsed);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("模型参数")) {
      throw error;
    }

    throw new Error("模型参数 JSON 格式无效。");
  }
}

function isStoredModelConfig(value: unknown): value is StoredModelConfig {
  if (!isRecord(value)) {
    return false;
  }

  try {
    normalizeModelConfig(value.config);
  } catch {
    return false;
  }

  return value.version === storageVersion && typeof value.savedAt === "string";
}

function getBrowserStorage(): ModelConfigStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
