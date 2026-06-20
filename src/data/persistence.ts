import type { DataImportSummary, RuntimeSnapshotLoad, TournamentSnapshot } from "../types.ts";
import type { MatchModelImpact, TeamModelImpact } from "./importImpact.ts";
import type { ImportEntityChange } from "./importPreview.ts";

const storageKey = "worldcup-2026-runtime-snapshot";
const importHistoryKey = "worldcup-2026-import-history";
const importRecapHistoryKey = "worldcup-2026-import-recap-history";
const storageVersion = 1;
const importHistoryVersion = 1;
const importRecapHistoryVersion = 1;
const maxImportHistoryEntries = 5;
const maxImportRecapHistoryEntries = 8;

type StoredRuntimeSnapshot = {
  version: number;
  savedAt: string;
  snapshot: TournamentSnapshot;
};

type SnapshotStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type ImportHistoryEntry = {
  id: string;
  createdAt: string;
  summary: DataImportSummary;
  snapshot: TournamentSnapshot;
};

export type ImportRecapEntry = {
  id: string;
  appliedAt: string;
  savedAt: string;
  summary: DataImportSummary;
  sourceSnapshot: Pick<TournamentSnapshot, "collectedAt" | "id" | "label">;
  sources: TournamentSnapshot["sources"];
  teamImpacts: TeamModelImpact[];
  matchImpacts: MatchModelImpact[];
  fixtureChanges: ImportEntityChange[];
  teamChanges: ImportEntityChange[];
  warnings: string[];
};

type StoredImportHistory = {
  version: number;
  entries: ImportHistoryEntry[];
};

type StoredImportRecapHistory = {
  version: number;
  entries: ImportRecapEntry[];
};

export function loadRuntimeSnapshot(
  fallback: TournamentSnapshot,
  storage = getBrowserStorage()
): RuntimeSnapshotLoad {
  if (!storage) {
    return { snapshot: fallback, restored: false };
  }

  try {
    const rawValue = storage.getItem(storageKey);
    if (!rawValue) {
      return { snapshot: fallback, restored: false };
    }

    const parsed: unknown = JSON.parse(rawValue);
    if (!isStoredSnapshot(parsed)) {
      return {
        snapshot: fallback,
        restored: false,
        error: "本地快照格式不兼容，已回退到内置快照。"
      };
    }

    if (isFallbackNewerThanStored(fallback, parsed.snapshot)) {
      return {
        snapshot: fallback,
        restored: false,
        error: "内置快照已更新，已优先使用最新内置数据。"
      };
    }

    return {
      snapshot: parsed.snapshot,
      restored: true,
      savedAt: parsed.savedAt
    };
  } catch {
    return {
      snapshot: fallback,
      restored: false,
      error: "本地快照读取失败，已回退到内置快照。"
    };
  }
}

function isFallbackNewerThanStored(
  fallback: TournamentSnapshot,
  stored: TournamentSnapshot
): boolean {
  const fallbackTime = Date.parse(fallback.collectedAt);
  const storedTime = Date.parse(stored.collectedAt);
  const storedIsBuiltInSnapshot = stored.id.startsWith("world-cup-2026-verified-snapshot");
  const storedLooksLikeFallback = stored.label === fallback.label;

  return (
    storedIsBuiltInSnapshot &&
    storedLooksLikeFallback &&
    stored.id !== fallback.id &&
    Number.isFinite(fallbackTime) &&
    Number.isFinite(storedTime) &&
    fallbackTime > storedTime
  );
}

export function saveRuntimeSnapshot(
  snapshot: TournamentSnapshot,
  storage = getBrowserStorage()
): string | undefined {
  if (!storage) {
    return undefined;
  }

  const savedAt = new Date().toISOString();
  const payload: StoredRuntimeSnapshot = {
    version: storageVersion,
    savedAt,
    snapshot
  };

  storage.setItem(storageKey, JSON.stringify(payload));

  return savedAt;
}

export function clearRuntimeSnapshot(storage = getBrowserStorage()): void {
  storage?.removeItem(storageKey);
}

export function loadImportHistory(storage = getBrowserStorage()): ImportHistoryEntry[] {
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(importHistoryKey);
    if (!rawValue) {
      return [];
    }

    const parsed: unknown = JSON.parse(rawValue);
    if (!isStoredImportHistory(parsed)) {
      return [];
    }

    return parsed.entries;
  } catch {
    return [];
  }
}

export function saveImportHistoryEntry(
  input: {
    summary: DataImportSummary;
    snapshot: TournamentSnapshot;
    createdAt?: string;
    id?: string;
  },
  storage = getBrowserStorage()
): ImportHistoryEntry[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const entry: ImportHistoryEntry = {
    id: input.id ?? buildImportHistoryId(createdAt, input.summary.label),
    createdAt,
    summary: input.summary,
    snapshot: input.snapshot
  };
  const entries = [entry, ...loadImportHistory(storage).filter((item) => item.id !== entry.id)].slice(
    0,
    maxImportHistoryEntries
  );

  if (storage) {
    const payload: StoredImportHistory = {
      version: importHistoryVersion,
      entries
    };

    storage.setItem(importHistoryKey, JSON.stringify(payload));
  }

  return entries;
}

export function clearImportHistory(storage = getBrowserStorage()): void {
  storage?.removeItem(importHistoryKey);
}

export function loadImportRecapHistory(storage = getBrowserStorage()): ImportRecapEntry[] {
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(importRecapHistoryKey);
    if (!rawValue) {
      return [];
    }

    const parsed: unknown = JSON.parse(rawValue);
    if (!isStoredImportRecapHistory(parsed)) {
      return [];
    }

    return parsed.entries;
  } catch {
    return [];
  }
}

export function saveImportRecapHistoryEntry(
  input: Omit<ImportRecapEntry, "id" | "savedAt"> & {
    id?: string;
    savedAt?: string;
  },
  storage = getBrowserStorage()
): ImportRecapEntry[] {
  const savedAt = input.savedAt ?? new Date().toISOString();
  const entry: ImportRecapEntry = {
    id: input.id ?? buildImportHistoryId(input.appliedAt, input.summary.label),
    appliedAt: input.appliedAt,
    savedAt,
    summary: input.summary,
    sourceSnapshot: input.sourceSnapshot,
    sources: input.sources,
    teamImpacts: input.teamImpacts,
    matchImpacts: input.matchImpacts,
    fixtureChanges: input.fixtureChanges,
    teamChanges: input.teamChanges,
    warnings: input.warnings
  };
  const entries = [
    entry,
    ...loadImportRecapHistory(storage).filter((item) => item.id !== entry.id)
  ].slice(0, maxImportRecapHistoryEntries);

  if (storage) {
    const payload: StoredImportRecapHistory = {
      version: importRecapHistoryVersion,
      entries
    };

    storage.setItem(importRecapHistoryKey, JSON.stringify(payload));
  }

  return entries;
}

export function clearImportRecapHistory(storage = getBrowserStorage()): void {
  storage?.removeItem(importRecapHistoryKey);
}

export function serializeTournamentSnapshot(snapshot: TournamentSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function buildSnapshotFilename(snapshot: TournamentSnapshot): string {
  const datePart = snapshot.collectedAt
    .replace(/[:.]/g, "-")
    .replace(/[^\dA-Za-z-]/g, "")
    .slice(0, 24);

  return `world-cup-2026-snapshot-${datePart || "runtime"}.json`;
}

function getBrowserStorage(): SnapshotStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isStoredSnapshot(value: unknown): value is StoredRuntimeSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === storageVersion &&
    typeof value.savedAt === "string" &&
    isTournamentSnapshot(value.snapshot)
  );
}

function isStoredImportHistory(value: unknown): value is StoredImportHistory {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === importHistoryVersion &&
    Array.isArray(value.entries) &&
    value.entries.every(isImportHistoryEntry)
  );
}

function isStoredImportRecapHistory(value: unknown): value is StoredImportRecapHistory {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === importRecapHistoryVersion &&
    Array.isArray(value.entries) &&
    value.entries.every(isImportRecapEntry)
  );
}

function isImportHistoryEntry(value: unknown): value is ImportHistoryEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    isDataImportSummary(value.summary) &&
    isTournamentSnapshot(value.snapshot)
  );
}

function isImportRecapEntry(value: unknown): value is ImportRecapEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.appliedAt === "string" &&
    typeof value.savedAt === "string" &&
    isDataImportSummary(value.summary) &&
    isSourceSnapshot(value.sourceSnapshot) &&
    Array.isArray(value.sources) &&
    Array.isArray(value.teamImpacts) &&
    Array.isArray(value.matchImpacts) &&
    Array.isArray(value.fixtureChanges) &&
    Array.isArray(value.teamChanges) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string")
  );
}

function isDataImportSummary(value: unknown): value is DataImportSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.importedFixtures === "number" &&
    typeof value.importedResults === "number" &&
    typeof value.importedTeams === "number" &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === "string") &&
    typeof value.appliedAt === "string" &&
    typeof value.label === "string"
  );
}

function isSourceSnapshot(
  value: unknown
): value is Pick<TournamentSnapshot, "collectedAt" | "id" | "label"> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.collectedAt === "string"
  );
}

function isTournamentSnapshot(value: unknown): value is TournamentSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.collectedAt === "string" &&
    Array.isArray(value.teams) &&
    Array.isArray(value.fixtures) &&
    Array.isArray(value.sources) &&
    typeof value.completedMatches === "number" &&
    typeof value.scheduledMatches === "number" &&
    Array.isArray(value.notes)
  );
}

function buildImportHistoryId(createdAt: string, label: string): string {
  const datePart = createdAt.replace(/[^0-9A-Za-z-]/g, "").slice(0, 24);
  const labelPart = label
    .toLowerCase()
    .replace(/[^0-9a-z-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 8);

  return `import-${datePart || "runtime"}-${labelPart || "snapshot"}-${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
