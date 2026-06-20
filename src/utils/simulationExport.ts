import { activeKnockoutRuleSet } from "../model/tournamentRules.ts";
import type {
  ModelConfig,
  SimulationAuditSummary,
  SimulationSummary,
  Team,
  TeamSimulationSummary,
  TournamentSnapshot
} from "../types.ts";

type ExportRow = {
  rank: number;
  teamId: string;
  teamName: string;
  abbr: string;
  group: string;
  expectedPoints: number;
  round32: number;
  round16: number;
  quarterFinal: number;
  semiFinal: number;
  final: number;
  champion: number;
  championCiLow: number;
  championCiHigh: number;
};

export type SimulationExportContext = {
  exportedAt?: string;
  modelConfig?: ModelConfig;
  snapshot?: TournamentSnapshot;
};

const csvHeaders: Array<{ key: keyof ExportRow; label: string }> = [
  { key: "rank", label: "rank" },
  { key: "teamId", label: "team_id" },
  { key: "teamName", label: "team_name" },
  { key: "abbr", label: "abbr" },
  { key: "group", label: "group" },
  { key: "expectedPoints", label: "expected_points" },
  { key: "round32", label: "round32_probability" },
  { key: "round16", label: "round16_probability" },
  { key: "quarterFinal", label: "quarter_final_probability" },
  { key: "semiFinal", label: "semi_final_probability" },
  { key: "final", label: "final_probability" },
  { key: "champion", label: "champion_probability" },
  { key: "championCiLow", label: "champion_ci_low" },
  { key: "championCiHigh", label: "champion_ci_high" }
];

export function buildSimulationExportRows(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>
): ExportRow[] {
  return simulation.teams
    .filter((summary) => teamsById.has(summary.teamId))
    .map((summary, index) => toExportRow(summary, teamsById.get(summary.teamId)!, index + 1));
}

export function serializeSimulationCsv(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>
): string {
  const rows = buildSimulationExportRows(simulation, teamsById);
  const header = csvHeaders.map((item) => item.label).join(",");
  const body = rows.map((row) =>
    csvHeaders.map((item) => escapeCsvCell(row[item.key])).join(",")
  );

  return `${[header, ...body].join("\n")}\n`;
}

export function serializeSimulationJson(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>,
  context: SimulationExportContext = {}
): string {
  const audit = buildSimulationAuditSummary(simulation, context);

  return JSON.stringify(
    {
      exportedAt: audit.exportedAt,
      iterations: simulation.iterations,
      seed: simulation.seed,
      generatedAt: simulation.generatedAt,
      audit,
      teams: buildSimulationExportRows(simulation, teamsById)
    },
    null,
    2
  );
}

export function serializeSimulationShareSvg(
  simulation: SimulationSummary,
  teamsById: Map<string, Team>,
  context: SimulationExportContext = {}
): string {
  const audit = buildSimulationAuditSummary(simulation, context);
  const rows = buildSimulationExportRows(simulation, teamsById).slice(0, 5);
  const maxChampion = Math.max(...rows.map((row) => row.champion), 0.01);
  const width = 1080;
  const height = 1350;
  const barX = 320;
  const barWidth = 520;
  const rowStartY = 420;
  const rowGap = 128;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="2026 World Cup simulation share card">`,
    "<defs>",
    "<linearGradient id=\"bg\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"1\"><stop stop-color=\"#f8fbf7\"/><stop offset=\"1\" stop-color=\"#e7f1ea\"/></linearGradient>",
    "<linearGradient id=\"bar\" x1=\"0\" x2=\"1\"><stop stop-color=\"#2f7d59\"/><stop offset=\"1\" stop-color=\"#2f6fb7\"/></linearGradient>",
    "<filter id=\"shadow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"18\" stdDeviation=\"20\" flood-color=\"#142118\" flood-opacity=\"0.12\"/></filter>",
    "</defs>",
    `<rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    `<rect x="54" y="54" width="972" height="1242" rx="26" fill="#ffffff" filter="url(#shadow)"/>`,
    `<text x="92" y="142" fill="#2f7d59" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800">2026 WORLD CUP PREDICTOR</text>`,
    `<text x="92" y="214" fill="#142118" font-family="Inter, Arial, sans-serif" font-size="58" font-weight="900">冠军概率 Top 5</text>`,
    `<text x="92" y="266" fill="#647067" font-family="Inter, Arial, sans-serif" font-size="26">Monte Carlo ${simulation.iterations.toLocaleString("zh-CN")} 次 · 种子 ${simulation.seed}</text>`,
    `<text x="92" y="308" fill="#647067" font-family="Inter, Arial, sans-serif" font-size="24">${escapeXml(audit.snapshotLabel)} · ${formatIsoDate(audit.snapshotCollectedAt || simulation.generatedAt)}</text>`,
    ...rows.flatMap((row, index) => {
      const team = teamsById.get(row.teamId);
      const y = rowStartY + index * rowGap;
      const percentText = formatSharePercent(row.champion);
      const ciText = `${formatSharePercent(row.championCiLow)}-${formatSharePercent(row.championCiHigh)}`;
      const normalizedWidth = Math.max(14, (row.champion / maxChampion) * barWidth);
      const color = team?.color ?? "#2f7d59";

      return [
        `<text x="92" y="${y}" fill="#647067" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="800">#${row.rank}</text>`,
        `<circle cx="154" cy="${y - 8}" r="16" fill="${escapeXml(color)}"/>`,
        `<text x="184" y="${y}" fill="#142118" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="900">${escapeXml(row.teamName)}</text>`,
        `<text x="184" y="${y + 34}" fill="#647067" font-family="Inter, Arial, sans-serif" font-size="22">${escapeXml(row.abbr)} · ${escapeXml(row.group)} 组 · 95% 区间 ${ciText}</text>`,
        `<rect x="${barX}" y="${y + 54}" width="${barWidth}" height="28" rx="14" fill="#e6ece8"/>`,
        `<rect x="${barX}" y="${y + 54}" width="${normalizedWidth.toFixed(1)}" height="28" rx="14" fill="url(#bar)"/>`,
        `<text x="900" y="${y + 78}" fill="#205a42" font-family="Inter, Arial, sans-serif" font-size="36" font-weight="900" text-anchor="end">${percentText}</text>`
      ];
    }),
    `<rect x="92" y="1114" width="896" height="106" rx="18" fill="#f3faf6" stroke="#dce5dd"/>`,
    `<text x="126" y="1160" fill="#142118" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="800">模型说明</text>`,
    `<text x="126" y="1198" fill="#647067" font-family="Inter, Arial, sans-serif" font-size="22">泊松比分模型 · 小组/淘汰赛蒙特卡洛 · 加时赛/点球/停赛风险修正</text>`,
    `<text x="92" y="1260" fill="#647067" font-family="Inter, Arial, sans-serif" font-size="20">生成时间 ${formatIsoDate(audit.exportedAt)} · 结果随数据快照、模型参数和随机种子变化</text>`,
    "</svg>"
  ].join("");
}

export function buildSimulationAuditSummary(
  simulation: SimulationSummary,
  context: SimulationExportContext = {}
): SimulationAuditSummary {
  const snapshot = context.snapshot;
  const exportedAt = context.exportedAt ?? new Date().toISOString();
  const notes = [
    ...(snapshot?.notes ?? []),
    activeKnockoutRuleSet.source === "placeholder"
      ? "淘汰赛对位使用 MVP 占位规则，需在 FIFA 官方 2026 映射确认后替换。"
      : "",
    context.modelConfig ? "" : "导出时未提供模型参数上下文。"
  ].filter(Boolean);

  return {
    exportedAt,
    simulationGeneratedAt: simulation.generatedAt,
    iterations: simulation.iterations,
    seed: simulation.seed,
    snapshotId: snapshot?.id ?? "unknown",
    snapshotLabel: snapshot?.label ?? "未提供快照",
    snapshotCollectedAt: snapshot?.collectedAt ?? "",
    teamCount: snapshot?.teams.length ?? 0,
    fixtureCount: snapshot?.fixtures.length ?? 0,
    completedMatches: snapshot?.completedMatches ?? 0,
    scheduledMatches: snapshot?.scheduledMatches ?? 0,
    modelConfig: context.modelConfig,
    knockoutRuleSet: {
      id: activeKnockoutRuleSet.id,
      label: activeKnockoutRuleSet.label,
      source: activeKnockoutRuleSet.source,
      notes: activeKnockoutRuleSet.notes
    },
    dataSources:
      snapshot?.sources.map((source) => ({
        id: source.id,
        label: source.label,
        kind: source.kind,
        status: source.status,
        coverage: source.coverage,
        updatedAt: source.updatedAt,
        retrievedAt: source.retrievedAt
      })) ?? [],
    notes
  };
}

export function buildSimulationExportFilename(
  simulation: SimulationSummary,
  extension: "csv" | "json"
): string {
  const datePart = simulation.generatedAt
    .replace(/[:.]/g, "-")
    .replace(/[^\dA-Za-z-]/g, "")
    .slice(0, 24);

  return `world-cup-2026-simulation-${datePart || "runtime"}.${extension}`;
}

export function buildSimulationShareFilename(simulation: SimulationSummary): string {
  const datePart = simulation.generatedAt
    .replace(/[:.]/g, "-")
    .replace(/[^\dA-Za-z-]/g, "")
    .slice(0, 24);

  return `world-cup-2026-share-card-${datePart || "runtime"}.svg`;
}

function toExportRow(
  summary: TeamSimulationSummary,
  team: Team,
  rank: number
): ExportRow {
  return {
    rank,
    teamId: summary.teamId,
    teamName: team.name,
    abbr: team.abbr,
    group: summary.group,
    expectedPoints: round(summary.expectedPoints),
    round32: round(summary.round32),
    round16: round(summary.round16),
    quarterFinal: round(summary.quarterFinal),
    semiFinal: round(summary.semiFinal),
    final: round(summary.final),
    champion: round(summary.champion),
    championCiLow: round(summary.championCiLow),
    championCiHigh: round(summary.championCiHigh)
  };
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function escapeCsvCell(value: number | string): string {
  const text = String(value);

  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function escapeXml(value: number | string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSharePercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatIsoDate(value: string): string {
  if (!value) {
    return "未记录";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN");
}
