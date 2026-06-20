import type { Match, ModelConfig, SimulationSummary, Team } from "../types.ts";

export type SimulationWorkerRequest = {
  type: "simulate";
  requestId: number;
  fixtures: Match[];
  teams: Team[];
  config: ModelConfig;
  iterations: number;
  seed: number;
  progressStep: number;
};

export type SimulationWorkerProgress = {
  type: "progress";
  requestId: number;
  completedIterations: number;
  totalIterations: number;
  progress: number;
  elapsedMs: number;
};

export type SimulationWorkerResult = {
  type: "result";
  requestId: number;
  simulation: SimulationSummary;
  elapsedMs: number;
};

export type SimulationWorkerError = {
  type: "error";
  requestId: number;
  message: string;
  elapsedMs: number;
};

export type SimulationWorkerOutboundMessage =
  | SimulationWorkerError
  | SimulationWorkerProgress
  | SimulationWorkerResult;

export function getSimulationProgressStep(iterations: number): number {
  return Math.max(1, Math.ceil(iterations / 40));
}

export function buildSimulationWorkerRequest(input: {
  requestId: number;
  fixtures: Match[];
  teams: Team[];
  config: ModelConfig;
  iterations: number;
  seed: number;
}): SimulationWorkerRequest {
  return {
    type: "simulate",
    requestId: input.requestId,
    fixtures: input.fixtures,
    teams: input.teams,
    config: input.config,
    iterations: input.iterations,
    seed: input.seed,
    progressStep: getSimulationProgressStep(input.iterations)
  };
}

export function buildSimulationWorkerProgress(input: {
  requestId: number;
  completedIterations: number;
  totalIterations: number;
  elapsedMs: number;
}): SimulationWorkerProgress {
  const progress =
    input.totalIterations > 0
      ? Math.min(1, Math.max(0, input.completedIterations / input.totalIterations))
      : 1;

  return {
    type: "progress",
    requestId: input.requestId,
    completedIterations: input.completedIterations,
    totalIterations: input.totalIterations,
    progress,
    elapsedMs: input.elapsedMs
  };
}

export function isSimulationWorkerRequest(value: unknown): value is SimulationWorkerRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === "simulate" &&
    typeof value.requestId === "number" &&
    Array.isArray(value.fixtures) &&
    Array.isArray(value.teams) &&
    isRecord(value.config) &&
    typeof value.iterations === "number" &&
    typeof value.seed === "number" &&
    typeof value.progressStep === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
