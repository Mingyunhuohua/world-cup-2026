import type { DataImportSummary, TournamentSnapshot } from "../types.ts";
import { previewTournamentImport } from "./importPreview.ts";

const LAST_APPLIED_KEY = "wc2026-live-odds-last-applied-at";
const ODDS_FEED_URL = "./data/odds-live.json";

export type LiveOddsSyncResult = {
  snapshot: TournamentSnapshot;
  summary: DataImportSummary;
  generatedAt: string;
};

export async function checkLiveOddsUpdate(
  currentSnapshot: TournamentSnapshot
): Promise<LiveOddsSyncResult | undefined> {
  let response: Response;
  try {
    response = await fetch(ODDS_FEED_URL, { cache: "no-store" });
  } catch {
    return undefined;
  }

  if (!response.ok) {
    return undefined;
  }

  const text = await response.text();
  let payload: { generatedAt?: string };
  try {
    payload = JSON.parse(text);
  } catch {
    return undefined;
  }

  const generatedAt = payload.generatedAt;
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) {
    return undefined;
  }

  const lastApplied = readLastAppliedAt();
  if (lastApplied && Date.parse(generatedAt) <= Date.parse(lastApplied)) {
    return undefined;
  }

  let preview: ReturnType<typeof previewTournamentImport>;
  try {
    preview = previewTournamentImport(text, currentSnapshot);
  } catch {
    return undefined;
  }

  if (preview.summary.importedTeams === 0) {
    return undefined;
  }

  return { snapshot: preview.snapshot, summary: preview.summary, generatedAt };
}

export function markLiveOddsApplied(generatedAt: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LAST_APPLIED_KEY, generatedAt);
  } catch {
    // 隐私模式等场景下 localStorage 不可用时静默忽略。
  }
}

function readLastAppliedAt(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage.getItem(LAST_APPLIED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
