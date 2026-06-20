import { useMemo } from "react";
import type { Match, Team } from "../types.ts";
import type {
  MatchEvaluation,
  MatchOutcome,
  ModelCalibrationCandidate,
  ModelCalibrationSummary,
  ModelEvaluationSummary
} from "../model/evaluation.ts";
import type { ModelPresetId } from "../model/presets.ts";
import { percent } from "../utils/format.ts";
import { Icon } from "./Icon.tsx";

type ModelEvaluationPanelProps = {
  calibration: ModelCalibrationSummary;
  evaluation: ModelEvaluationSummary;
  fixtures: Match[];
  onPresetApply: (presetId: ModelPresetId) => void;
  teamsById: Map<string, Team>;
};

const outcomeLabels: Record<MatchOutcome, string> = {
  away: "客胜",
  draw: "平局",
  home: "主胜"
};

const qualityLabels: Record<ModelEvaluationSummary["sampleQuality"], string> = {
  empty: "等待赛果",
  limited: "小样本",
  usable: "可校准"
};

export function ModelEvaluationPanel({
  calibration,
  evaluation,
  fixtures,
  onPresetApply,
  teamsById
}: ModelEvaluationPanelProps) {
  const fixturesById = useMemo(
    () => new Map(fixtures.map((fixture) => [fixture.id, fixture])),
    [fixtures]
  );
  const evaluationInsights = useMemo(
    () => buildEvaluationInsights(evaluation, fixturesById, teamsById),
    [evaluation, fixturesById, teamsById]
  );
  const outcomeDistribution = useMemo(
    () => buildOutcomeDistribution(evaluation.matches),
    [evaluation.matches]
  );
  const reviewMatches = useMemo(
    () => buildReviewMatches(evaluation.matches, fixturesById),
    [evaluation.matches, fixturesById]
  );
  const visibleMatches = evaluation.matches.slice(0, 4);
  const visibleCandidates = calibration.candidates.slice(0, 4);
  const bestCandidate = calibration.bestCandidate;
  const applyLabel = getApplyLabel(bestCandidate, calibration.sampleQuality);
  const recommendation = calibration.recommendation;

  return (
    <section className="panel evaluation-panel">
      <div className="panel__header compact">
        <div>
          <span className="eyebrow">模型回测</span>
          <h2>赛果校准</h2>
        </div>
        <span className={`evaluation-badge evaluation-badge--${evaluation.sampleQuality}`}>
          {qualityLabels[evaluation.sampleQuality]}
        </span>
      </div>

      <div className="evaluation-metrics">
        <EvaluationMetric label="Brier" value={evaluation.averageBrier.toFixed(3)} />
        <EvaluationMetric label="Log Loss" value={evaluation.averageLogLoss.toFixed(3)} />
        <EvaluationMetric label="进球误差" value={evaluation.averageGoalError.toFixed(2)} />
        <EvaluationMetric label="方向命中" value={percent(evaluation.winnerAccuracy, 0)} />
      </div>

      <p className="evaluation-note">
        {evaluation.completedMatches.toLocaleString("zh-CN")} 场已完赛 · {evaluation.note}
      </p>

      <div className="evaluation-diagnostics" aria-label="模型回测诊断">
        {evaluationInsights.map((item) => (
          <article className={`evaluation-diagnostic evaluation-diagnostic--${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>

      <div className="evaluation-outcomes" aria-label="赛果分布对比">
        <div className="evaluation-outcomes__header">
          <strong>赛果分布</strong>
          <span>实际结果 vs 模型首选</span>
        </div>
        <div className="evaluation-outcomes__rows">
          {outcomeDistribution.map((row) => (
            <article className="evaluation-outcome-row" key={row.outcome}>
              <span>{outcomeLabels[row.outcome]}</span>
              <div aria-label={`${outcomeLabels[row.outcome]} 实际 ${row.actual} 场，模型首选 ${row.pick} 场`}>
                <b className="actual" style={{ width: percent(row.actualShare, 2) }} />
                <b className="pick" style={{ width: percent(row.pickShare, 2) }} />
              </div>
              <em>
                实际 {row.actual} · 首选 {row.pick}
              </em>
            </article>
          ))}
        </div>
      </div>

      <div className="calibration-box">
        <div className="calibration-box__header">
          <div>
            <strong>推荐预设：{calibration.bestCandidate.label}</strong>
            <p>{calibration.note}</p>
          </div>
          <div className="calibration-actions">
            <span>当前第 {calibration.current.rank} 名</span>
            <button
              className="secondary-action calibration-apply"
              disabled={!bestCandidate.canApply}
              onClick={() => {
                if (bestCandidate.presetId) {
                  onPresetApply(bestCandidate.presetId);
                }
              }}
              type="button"
            >
              <Icon name={bestCandidate.canApply ? "play" : "shield"} size={14} />
              {applyLabel}
            </button>
          </div>
        </div>
        <div className={`calibration-verdict calibration-verdict--${recommendation.status}`}>
          <span>
            <Icon
              name={recommendation.status === "apply" ? "play" : recommendation.status === "keep" ? "shield" : "alert"}
              size={15}
            />
          </span>
          <div>
            <strong>{recommendation.title}</strong>
            <p>{recommendation.detail}</p>
          </div>
        </div>
        <div className="calibration-list">
          {visibleCandidates.map((candidate) => (
            <CalibrationCandidate candidate={candidate} key={candidate.id} />
          ))}
        </div>
      </div>

      {visibleMatches.length > 0 ? (
        <div className="evaluation-match-list" aria-label="最偏离模型预期的已完赛比赛">
          {reviewMatches.length > 0 ? (
            <div className="evaluation-review-strip">
              {reviewMatches.map((item) => (
                <article className="evaluation-review-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.matchLabel}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          ) : null}
          {visibleMatches.map((match) => (
            <EvaluationMatch
              evaluation={match}
              fixture={fixturesById.get(match.matchId)}
              key={match.matchId}
              teamsById={teamsById}
            />
          ))}
        </div>
      ) : (
        <div className="evaluation-empty">暂无已完赛比赛，回测会在导入赛果后自动更新。</div>
      )}
    </section>
  );
}

type EvaluationDiagnostic = {
  label: string;
  value: string;
  detail: string;
  tone: "green" | "blue" | "orange" | "red";
};

type OutcomeDistributionRow = {
  outcome: MatchOutcome;
  actual: number;
  pick: number;
  actualShare: number;
  pickShare: number;
};

type ReviewMatch = {
  label: string;
  matchLabel: string;
  detail: string;
};

function buildEvaluationInsights(
  evaluation: ModelEvaluationSummary,
  fixturesById: Map<string, Match>,
  teamsById: Map<string, Team>
): EvaluationDiagnostic[] {
  const matches = evaluation.matches;
  const missCount = matches.filter((match) => !match.winnerHit).length;
  const hitCount = matches.length - missCount;
  const toughestMatch = matches[0];
  const largestGoalMiss = matches.reduce<MatchEvaluation | undefined>(
    (best, match) => (!best || match.goalError > best.goalError ? match : best),
    undefined
  );
  const drawMatches = matches.filter((match) => match.actualOutcome === "draw");
  const drawHits = drawMatches.filter((match) => match.winnerHit).length;
  const averageActualProbability =
    matches.length > 0
      ? matches.reduce((sum, match) => sum + match.actualProbability, 0) / matches.length
      : 0;

  return [
    {
      label: "方向命中",
      value: `${hitCount}/${matches.length || 0}`,
      detail: `胜平负命中率 ${percent(evaluation.winnerAccuracy, 0)}`,
      tone: evaluation.winnerAccuracy >= 0.55 ? "green" : evaluation.winnerAccuracy >= 0.42 ? "orange" : "red"
    },
    {
      label: "真实结果概率",
      value: percent(averageActualProbability, 0),
      detail: "真实赛果在赛前概率分布中的平均位置",
      tone: averageActualProbability >= 0.42 ? "green" : averageActualProbability >= 0.32 ? "orange" : "red"
    },
    {
      label: "最大偏差",
      value: toughestMatch ? percent(toughestMatch.actualProbability, 0) : "-",
      detail: toughestMatch
        ? `${formatMatchLabel(fixturesById.get(toughestMatch.matchId), teamsById)} 的实际结果概率最低`
        : "等待已完赛样本",
      tone: toughestMatch && toughestMatch.actualProbability < 0.2 ? "red" : "orange"
    },
    {
      label: "平局识别",
      value: `${drawHits}/${drawMatches.length}`,
      detail: largestGoalMiss
        ? `最大进球误差：${formatMatchLabel(fixturesById.get(largestGoalMiss.matchId), teamsById)}`
        : "同时观察比分误差",
      tone: drawMatches.length === 0 || drawHits / drawMatches.length >= 0.45 ? "blue" : "orange"
    }
  ];
}

function buildOutcomeDistribution(matches: MatchEvaluation[]): OutcomeDistributionRow[] {
  const total = Math.max(1, matches.length);

  return (["home", "draw", "away"] as MatchOutcome[]).map((outcome) => {
    const actual = matches.filter((match) => match.actualOutcome === outcome).length;
    const pick = matches.filter((match) => match.topPick === outcome).length;

    return {
      outcome,
      actual,
      pick,
      actualShare: actual / total,
      pickShare: pick / total
    };
  });
}

function buildReviewMatches(
  matches: MatchEvaluation[],
  fixturesById: Map<string, Match>
): ReviewMatch[] {
  const worstProbability = matches[0];
  const biggestGoalError = matches.reduce<MatchEvaluation | undefined>(
    (best, match) => (!best || match.goalError > best.goalError ? match : best),
    undefined
  );
  const confidentMiss = matches.find((match) => !match.winnerHit);
  const items: ReviewMatch[] = [];

  if (worstProbability) {
    items.push({
      label: "最低实际概率",
      matchLabel: formatFixtureScore(fixturesById.get(worstProbability.matchId)),
      detail: `实际结果概率 ${percent(worstProbability.actualProbability)} · Log Loss ${worstProbability.logLoss.toFixed(3)}`
    });
  }

  if (biggestGoalError && biggestGoalError.matchId !== worstProbability?.matchId) {
    items.push({
      label: "最大比分误差",
      matchLabel: formatFixtureScore(fixturesById.get(biggestGoalError.matchId)),
      detail: `预期进球 ${biggestGoalError.lambdaHome.toFixed(1)}-${biggestGoalError.lambdaAway.toFixed(1)} · 误差 ${biggestGoalError.goalError.toFixed(2)}`
    });
  }

  if (confidentMiss && confidentMiss.matchId !== worstProbability?.matchId) {
    items.push({
      label: "重点误判",
      matchLabel: formatFixtureScore(fixturesById.get(confidentMiss.matchId)),
      detail: `模型首选 ${outcomeLabels[confidentMiss.topPick]}，实际 ${outcomeLabels[confidentMiss.actualOutcome]}`
    });
  }

  return items.slice(0, 3);
}

function formatMatchLabel(fixture: Match | undefined, teamsById: Map<string, Team>): string {
  if (!fixture) {
    return "未知比赛";
  }

  const home = teamsById.get(fixture.homeTeamId);
  const away = teamsById.get(fixture.awayTeamId);

  return `${home?.abbr ?? fixture.homeTeamId} vs ${away?.abbr ?? fixture.awayTeamId}`;
}

function formatFixtureScore(fixture: Match | undefined): string {
  if (!fixture) {
    return "未知比赛";
  }

  if (!fixture.result) {
    return `${fixture.homeTeamId} vs ${fixture.awayTeamId}`;
  }

  return `${fixture.homeTeamId.toUpperCase()} ${fixture.result.homeGoals}-${fixture.result.awayGoals} ${fixture.awayTeamId.toUpperCase()}`;
}

function getApplyLabel(
  candidate: ModelCalibrationCandidate,
  sampleQuality: ModelCalibrationSummary["sampleQuality"]
) {
  if (sampleQuality === "empty") {
    return "等待赛果";
  }

  if (candidate.isCurrent) {
    return "已使用";
  }

  if (!candidate.canApply) {
    return sampleQuality === "usable" ? "继续观察" : "样本不足";
  }

  if (!candidate.presetId) {
    return "不可应用";
  }

  return "应用预设";
}

function CalibrationCandidate({ candidate }: { candidate: ModelCalibrationCandidate }) {
  const isBetter = candidate.logLossDelta < 0;
  const isSame = candidate.logLossDelta === 0;
  const deltaLabel = isSame
    ? "持平"
    : `${isBetter ? "" : "+"}${candidate.logLossDelta.toFixed(3)}`;

  return (
    <article className={candidate.isCurrent ? "calibration-row is-current" : "calibration-row"}>
      <div>
        <strong>
          #{candidate.rank} {candidate.label}
        </strong>
        <span>
          Log Loss {candidate.evaluation.averageLogLoss.toFixed(3)} · Brier{" "}
          {candidate.evaluation.averageBrier.toFixed(3)}
        </span>
      </div>
      <em className={isBetter ? "is-better" : ""}>{deltaLabel}</em>
    </article>
  );
}

function EvaluationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EvaluationMatch({
  evaluation,
  fixture,
  teamsById
}: {
  evaluation: MatchEvaluation;
  fixture?: Match;
  teamsById: Map<string, Team>;
}) {
  if (!fixture?.result) {
    return null;
  }

  const home = teamsById.get(fixture.homeTeamId);
  const away = teamsById.get(fixture.awayTeamId);

  return (
    <article className="evaluation-match">
      <div className="evaluation-match__teams">
        <strong>
          {home?.abbr ?? fixture.homeTeamId} {fixture.result.homeGoals}-
          {fixture.result.awayGoals} {away?.abbr ?? fixture.awayTeamId}
        </strong>
        <span>
          实际 {outcomeLabels[evaluation.actualOutcome]} · 模型首选{" "}
          {outcomeLabels[evaluation.topPick]}
        </span>
      </div>
      <div className="evaluation-match__score">
        <Icon name={evaluation.winnerHit ? "shield" : "alert"} size={14} />
        <span>{percent(evaluation.actualProbability)}</span>
      </div>
      <div className="evaluation-match__detail">
        <span>Brier {evaluation.brierScore.toFixed(3)}</span>
        <span>进球误差 {evaluation.goalError.toFixed(2)}</span>
      </div>
    </article>
  );
}
