import type { ModelConfig } from "../types.ts";
import { defaultModelConfig } from "./config.ts";

export type ModelPresetId =
  | "balanced"
  | "market-conservative"
  | "form-first"
  | "rating-first"
  | "upset-sensitive";

export type ModelPreset = {
  id: ModelPresetId;
  label: string;
  description: string;
  config: ModelConfig;
};

export const modelPresets: ModelPreset[] = [
  {
    id: "balanced",
    label: "均衡模型",
    description: "实力评分、排名、状态和伤停按默认权重综合。",
    config: defaultModelConfig
  },
  {
    id: "market-conservative",
    label: "市场保守",
    description: "降低状态和伤停波动，比分分布更贴近低风险基线。",
    config: {
      ...defaultModelConfig,
      baseGoals: 1.26,
      eloWeight: 0.92,
      rankWeight: 0.58,
      formWeight: 0.34,
      injuryWeight: 0.28,
      suspensionRiskWeight: 0.06,
      dixonColesRho: -0.1,
      extraTimeGoalRate: 0.25,
      penaltyStrengthWeight: 0.72
    }
  },
  {
    id: "form-first",
    label: "近期状态优先",
    description: "更相信近期表现和伤停变化，适合临赛前更新。",
    config: {
      ...defaultModelConfig,
      eloWeight: 0.82,
      rankWeight: 0.48,
      formWeight: 0.9,
      injuryWeight: 0.62,
      suspensionRiskWeight: 0.11,
      hostBoost: 0.07
    }
  },
  {
    id: "rating-first",
    label: "实力评级优先",
    description: "更强调 ELO/FIFA 基础强弱，降低短期噪声。",
    config: {
      ...defaultModelConfig,
      eloWeight: 1.22,
      rankWeight: 0.86,
      formWeight: 0.32,
      injuryWeight: 0.3,
      suspensionRiskWeight: 0.05,
      penaltyStrengthWeight: 0.78
    }
  },
  {
    id: "upset-sensitive",
    label: "冷门敏感",
    description: "提高状态和伤停权重，同时略微压低强队结构优势。",
    config: {
      ...defaultModelConfig,
      baseGoals: 1.4,
      eloWeight: 0.72,
      rankWeight: 0.42,
      formWeight: 0.88,
      injuryWeight: 0.72,
      suspensionRiskWeight: 0.12,
      hostBoost: 0.05,
      dixonColesRho: -0.04,
      extraTimeGoalRate: 0.32,
      penaltyStrengthWeight: 0.5
    }
  }
];

export const modelPresetById = new Map(
  modelPresets.map((preset) => [preset.id, preset])
);

export const modelConfigKeys = [
  "baseGoals",
  "maxGoals",
  "eloWeight",
  "rankWeight",
  "formWeight",
  "injuryWeight",
  "suspensionRiskWeight",
  "hostBoost",
  "restDaysWeight",
  "dixonColesRho",
  "extraTimeGoalRate",
  "penaltyStrengthWeight",
  "simulationIterations"
] as const;

export function getPresetIdForConfig(config: ModelConfig): ModelPresetId | "custom" {
  const match = modelPresets.find((preset) =>
    modelConfigKeys.every((key) => preset.config[key] === config[key])
  );

  return match?.id ?? "custom";
}

export function countChangedConfigKeys(config: ModelConfig): number {
  return modelConfigKeys.filter((key) => config[key] !== defaultModelConfig[key]).length;
}
