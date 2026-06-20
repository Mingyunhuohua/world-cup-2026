import type { Match, ModelConfig, PredictionResult, Team } from "../types.ts";
import { predictMatch } from "./predict.ts";
import { modelPresets, type ModelPresetId } from "./presets.ts";

export type MatchOutcome = "away" | "draw" | "home";

export type MatchEvaluation = {
  matchId: string;
  actualOutcome: MatchOutcome;
  topPick: MatchOutcome;
  actualProbability: number;
  brierScore: number;
  logLoss: number;
  goalError: number;
  winnerHit: boolean;
  lambdaHome: number;
  lambdaAway: number;
};

export type ModelEvaluationSummary = {
  completedMatches: number;
  averageBrier: number;
  averageLogLoss: number;
  averageGoalError: number;
  winnerAccuracy: number;
  sampleQuality: "empty" | "limited" | "usable";
  note: string;
  matches: MatchEvaluation[];
};

export type ModelCalibrationCandidate = {
  id: string;
  presetId?: ModelPresetId;
  label: string;
  description: string;
  isCurrent: boolean;
  canApply: boolean;
  rank: number;
  evaluation: ModelEvaluationSummary;
  logLossDelta: number;
  brierDelta: number;
};

export type ModelCalibrationRecommendation = {
  status: "apply" | "keep" | "observe" | "wait";
  title: string;
  detail: string;
};

export type ModelCalibrationSummary = {
  completedMatches: number;
  sampleQuality: ModelEvaluationSummary["sampleQuality"];
  current: ModelCalibrationCandidate;
  bestCandidate: ModelCalibrationCandidate;
  candidates: ModelCalibrationCandidate[];
  note: string;
  recommendation: ModelCalibrationRecommendation;
};

type CalibrationCandidateInput = {
  id: string;
  presetId?: ModelPresetId;
  label: string;
  description: string;
  config: ModelConfig;
  isCurrent?: boolean;
};

const minProbability = 1e-6;
const minimumCalibrationMatches = 18;
const minimumLogLossImprovement = 0.035;
const minimumBrierImprovement = 0.005;

export function evaluateCompletedMatches(
  fixtures: Match[],
  teams: Team[],
  config: ModelConfig
): ModelEvaluationSummary {
  const completedMatches = fixtures.filter((match) => match.result);
  const matches = completedMatches.map((match) => evaluateMatch(match, fixtures, teams, config));
  const sampleQuality = getSampleQuality(matches.length);

  if (matches.length === 0) {
    return {
      completedMatches: 0,
      averageBrier: 0,
      averageLogLoss: 0,
      averageGoalError: 0,
      winnerAccuracy: 0,
      sampleQuality,
      note: getSampleNote(sampleQuality),
      matches: []
    };
  }

  return {
    completedMatches: matches.length,
    averageBrier: average(matches.map((match) => match.brierScore)),
    averageLogLoss: average(matches.map((match) => match.logLoss)),
    averageGoalError: average(matches.map((match) => match.goalError)),
    winnerAccuracy:
      matches.filter((match) => match.winnerHit).length / matches.length,
    sampleQuality,
    note: getSampleNote(sampleQuality),
    matches: [...matches].sort((a, b) => b.logLoss - a.logLoss)
  };
}

export function compareModelConfigurations(
  fixtures: Match[],
  teams: Team[],
  currentConfig: ModelConfig,
  candidates: CalibrationCandidateInput[] = modelPresets.map((preset) => ({
    ...preset,
    presetId: preset.id
  }))
): ModelCalibrationSummary {
  const currentEvaluation = evaluateCompletedMatches(fixtures, teams, currentConfig);
  const currentCandidate = buildCalibrationCandidate(
    {
      id: "current",
      label: "当前参数",
      description: "正在用于页面预测和模拟的参数组合。",
      config: currentConfig,
      isCurrent: true
    },
    fixtures,
    teams,
    currentEvaluation
  );
  const evaluatedCandidates = [
    currentCandidate,
    ...candidates.map((candidate) => buildCalibrationCandidate(candidate, fixtures, teams))
  ];
  const sortedCandidates = evaluatedCandidates
    .sort(compareCalibrationCandidates)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      logLossDelta: candidate.evaluation.averageLogLoss - currentEvaluation.averageLogLoss,
      brierDelta: candidate.evaluation.averageBrier - currentEvaluation.averageBrier
    }))
    .map((candidate) => ({
      ...candidate,
      canApply: canApplyCandidate(candidate, currentEvaluation.sampleQuality)
    }));
  const rankedCurrent =
    sortedCandidates.find((candidate) => candidate.id === currentCandidate.id) ??
    sortedCandidates[0];
  const bestCandidate = sortedCandidates[0] ?? rankedCurrent;
  const recommendation = getCalibrationRecommendation(
    currentEvaluation.sampleQuality,
    bestCandidate,
    rankedCurrent
  );

  return {
    completedMatches: currentEvaluation.completedMatches,
    sampleQuality: currentEvaluation.sampleQuality,
    current: rankedCurrent,
    bestCandidate,
    candidates: sortedCandidates,
    note: getCalibrationNote(currentEvaluation.sampleQuality, bestCandidate, rankedCurrent),
    recommendation
  };
}

function buildCalibrationCandidate(
  candidate: CalibrationCandidateInput,
  fixtures: Match[],
  teams: Team[],
  evaluation = evaluateCompletedMatches(fixtures, teams, candidate.config)
): ModelCalibrationCandidate {
  return {
    id: candidate.id,
    presetId: candidate.presetId,
    label: candidate.label,
    description: candidate.description,
    isCurrent: Boolean(candidate.isCurrent),
    canApply: false,
    rank: 0,
    evaluation,
    logLossDelta: 0,
    brierDelta: 0
  };
}

function canApplyCandidate(
  candidate: ModelCalibrationCandidate,
  sampleQuality: ModelEvaluationSummary["sampleQuality"]
): boolean {
  if (sampleQuality !== "usable" || candidate.isCurrent || !candidate.presetId) {
    return false;
  }

  const logLossImprovement = -candidate.logLossDelta;
  const brierImprovement = -candidate.brierDelta;

  return (
    candidate.evaluation.completedMatches >= minimumCalibrationMatches &&
    logLossImprovement >= minimumLogLossImprovement &&
    brierImprovement >= minimumBrierImprovement
  );
}

function compareCalibrationCandidates(
  first: ModelCalibrationCandidate,
  second: ModelCalibrationCandidate
): number {
  return (
    first.evaluation.averageLogLoss - second.evaluation.averageLogLoss ||
    first.evaluation.averageBrier - second.evaluation.averageBrier ||
    first.evaluation.averageGoalError - second.evaluation.averageGoalError
  );
}

function evaluateMatch(
  match: Match,
  fixtures: Match[],
  teams: Team[],
  config: ModelConfig
): MatchEvaluation {
  if (!match.result) {
    throw new Error(`Match ${match.id} has no result to evaluate.`);
  }

  const prediction = predictMatch(match, teams, config, fixtures);
  const actualOutcome = getActualOutcome(match);
  const actualProbability = Math.max(
    minProbability,
    getOutcomeProbability(prediction, actualOutcome)
  );
  const brierScore = getBrierScore(prediction, actualOutcome);
  const goalError =
    (Math.abs(prediction.lambdaHome - match.result.homeGoals) +
      Math.abs(prediction.lambdaAway - match.result.awayGoals)) /
    2;
  const topPick = getTopPick(prediction);

  return {
    matchId: match.id,
    actualOutcome,
    topPick,
    actualProbability,
    brierScore,
    logLoss: -Math.log(actualProbability),
    goalError,
    winnerHit: topPick === actualOutcome,
    lambdaHome: prediction.lambdaHome,
    lambdaAway: prediction.lambdaAway
  };
}

function getActualOutcome(match: Match): MatchOutcome {
  const result = match.result;
  if (!result) {
    throw new Error(`Match ${match.id} has no result.`);
  }

  if (result.homeGoals > result.awayGoals) {
    return "home";
  }

  if (result.homeGoals < result.awayGoals) {
    return "away";
  }

  return "draw";
}

function getOutcomeProbability(
  prediction: PredictionResult,
  outcome: MatchOutcome
): number {
  if (outcome === "home") {
    return prediction.homeWin;
  }

  if (outcome === "away") {
    return prediction.awayWin;
  }

  return prediction.draw;
}

function getBrierScore(prediction: PredictionResult, actualOutcome: MatchOutcome): number {
  const outcomes: MatchOutcome[] = ["home", "draw", "away"];

  return outcomes.reduce((score, outcome) => {
    const actual = outcome === actualOutcome ? 1 : 0;
    const predicted = getOutcomeProbability(prediction, outcome);

    return score + (predicted - actual) ** 2;
  }, 0);
}

function getTopPick(prediction: PredictionResult): MatchOutcome {
  const outcomes: Array<{ outcome: MatchOutcome; probability: number }> = [
    { outcome: "home", probability: prediction.homeWin },
    { outcome: "draw", probability: prediction.draw },
    { outcome: "away", probability: prediction.awayWin }
  ];

  return outcomes.sort((a, b) => b.probability - a.probability)[0].outcome;
}

function getSampleQuality(matchCount: number): ModelEvaluationSummary["sampleQuality"] {
  if (matchCount === 0) {
    return "empty";
  }

  if (matchCount < 12) {
    return "limited";
  }

  return "usable";
}

function getSampleNote(sampleQuality: ModelEvaluationSummary["sampleQuality"]): string {
  if (sampleQuality === "empty") {
    return "尚无赛果，等待首批完赛后开始校准。";
  }

  if (sampleQuality === "limited") {
    return "样本较少，只适合发现明显偏差，不宜过度调参。";
  }

  return "样本量可用于比较参数预设和动态数据源的稳定性。";
}

function getCalibrationNote(
  sampleQuality: ModelEvaluationSummary["sampleQuality"],
  bestCandidate: ModelCalibrationCandidate,
  currentCandidate: ModelCalibrationCandidate
): string {
  if (sampleQuality === "empty") {
    return "尚无赛果，预设推荐会在导入赛果后启用。";
  }

  if (sampleQuality === "limited") {
    return `当前样本偏少，${bestCandidate.label} 暂时领先；建议继续观察，不要只凭少量比赛大幅调参。`;
  }

  if (bestCandidate.id === currentCandidate.id) {
    return "当前参数在回测候选中暂时领先，可以继续保留并观察新增赛果。";
  }

  return `${bestCandidate.label} 的回测损失低于当前参数，可作为下一轮参数调校起点。`;
}

function getCalibrationRecommendation(
  sampleQuality: ModelEvaluationSummary["sampleQuality"],
  bestCandidate: ModelCalibrationCandidate,
  currentCandidate: ModelCalibrationCandidate
): ModelCalibrationRecommendation {
  if (sampleQuality === "empty") {
    return {
      status: "wait",
      title: "等待赛果",
      detail: "还没有真实比赛样本，暂不推荐调整参数。"
    };
  }

  if (sampleQuality === "limited") {
    return {
      status: "observe",
      title: "继续观察",
      detail: "样本量仍偏小，当前只用于发现明显偏差，不建议一键切换预设。"
    };
  }

  if (bestCandidate.id === currentCandidate.id) {
    return {
      status: "keep",
      title: "保留当前参数",
      detail: "当前参数在候选预设中暂时领先，继续观察新增赛果即可。"
    };
  }

  if (!bestCandidate.canApply) {
    return {
      status: "observe",
      title: "差距不足",
      detail: `${bestCandidate.label} 暂时领先，但相对当前参数的提升还不够大，建议继续观察。`
    };
  }

  return {
    status: "apply",
    title: "可考虑应用",
    detail: `${bestCandidate.label} 在 Log Loss 和 Brier 上都明显优于当前参数，可作为下一轮调校起点。`
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
