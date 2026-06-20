import type { ScoreProbability } from "../types.ts";

export function factorial(value: number): number {
  if (value <= 1) {
    return 1;
  }

  let result = 1;
  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }
  return result;
}

export function poissonProbability(lambda: number, goals: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, goals)) / factorial(goals);
}

function dixonColesFactor(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - lambdaHome * lambdaAway * rho;
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + lambdaHome * rho;
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + lambdaAway * rho;
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }
  return 1;
}

export function buildScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals: number,
  rho: number
): ScoreProbability[] {
  const matrix: ScoreProbability[] = [];

  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      const raw =
        poissonProbability(lambdaHome, homeGoals) *
        poissonProbability(lambdaAway, awayGoals) *
        dixonColesFactor(homeGoals, awayGoals, lambdaHome, lambdaAway, rho);

      matrix.push({
        homeGoals,
        awayGoals,
        probability: Math.max(0, raw)
      });
    }
  }

  const total = matrix.reduce((sum, score) => sum + score.probability, 0);
  return matrix.map((score) => ({
    ...score,
    probability: total > 0 ? score.probability / total : 0
  }));
}
