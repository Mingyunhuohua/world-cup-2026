import type { ModelConfig } from "../types.ts";

export const defaultModelConfig: ModelConfig = {
  baseGoals: 1.34,
  maxGoals: 7,
  eloWeight: 1,
  rankWeight: 0.65,
  formWeight: 0.55,
  injuryWeight: 0.42,
  suspensionRiskWeight: 0.08,
  hostBoost: 0.08,
  restDaysWeight: 0.03,
  dixonColesRho: -0.08,
  extraTimeGoalRate: 0.28,
  penaltyStrengthWeight: 0.65,
  simulationIterations: 10000
};
