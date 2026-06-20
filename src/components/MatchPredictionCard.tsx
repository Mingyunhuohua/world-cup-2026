import type { Match, PredictionResult, Team } from "../types.ts";
import { percent } from "../utils/format.ts";
import { Icon } from "./Icon.tsx";
import { ProbabilityBar } from "./ProbabilityBar.tsx";
import { ScoreHeatmap } from "./ScoreHeatmap.tsx";

type MatchPredictionCardProps = {
  match: Match;
  prediction: PredictionResult;
  teamsById: Map<string, Team>;
};

const factorIcons = ["gauge", "trending", "alert", "shield", "activity"] as const;

function getOutcomeSummary(prediction: PredictionResult, home: Team, away: Team) {
  const outcomes = [
    { label: `${home.abbr} 胜`, value: prediction.homeWin, tone: "home" as const },
    { label: "平局", value: prediction.draw, tone: "draw" as const },
    { label: `${away.abbr} 胜`, value: prediction.awayWin, tone: "away" as const }
  ];

  return outcomes.reduce((best, outcome) => (outcome.value > best.value ? outcome : best), outcomes[0]);
}

function getXgEdgeLabel(xgDelta: number, home: Team, away: Team) {
  if (Math.abs(xgDelta) < 0.08) {
    return "预期进球接近";
  }

  return `${xgDelta > 0 ? home.abbr : away.abbr} xG 领先`;
}

function getFactorBalance(prediction: PredictionResult) {
  const totalImpact = prediction.factors.reduce((sum, factor) => sum + factor.impact, 0);
  const strongestFactor = [...prediction.factors].sort(
    (left, right) => Math.abs(right.impact) - Math.abs(left.impact)
  )[0];

  if (!strongestFactor) {
    return {
      label: "暂无显著因素",
      value: "0.00",
      tone: "neutral"
    };
  }

  return {
    label: strongestFactor.label,
    value: `${totalImpact >= 0 ? "+" : ""}${totalImpact.toFixed(2)}`,
    tone: totalImpact >= 0 ? "positive" : "negative"
  };
}

type MatchInsight = {
  headline: string;
  detail: string;
  tone: "home" | "draw" | "away" | "neutral";
  tiles: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
};

function buildMatchInsight(
  match: Match,
  prediction: PredictionResult,
  home: Team,
  away: Team
): MatchInsight {
  const outcomeSummary = getOutcomeSummary(prediction, home, away);
  const orderedOutcomes = [
    { label: `${home.abbr} 胜`, value: prediction.homeWin, tone: "home" as const },
    { label: "平局", value: prediction.draw, tone: "draw" as const },
    { label: `${away.abbr} 胜`, value: prediction.awayWin, tone: "away" as const }
  ].sort((left, right) => right.value - left.value);
  const probabilityGap = orderedOutcomes[0].value - orderedOutcomes[1].value;
  const strongestFactor = [...prediction.factors].sort(
    (left, right) => Math.abs(right.impact) - Math.abs(left.impact)
  )[0];
  const riskFactor = [...prediction.factors]
    .filter((factor) => factor.impact < 0)
    .sort((left, right) => left.impact - right.impact)[0];
  const topScore = prediction.topScores[0];
  const confidenceLabel =
    prediction.confidence >= 0.72 ? "信心较高" : prediction.confidence >= 0.58 ? "中等信心" : "谨慎判断";
  const statusPrefix = match.status === "completed" ? "复盘视角" : "赛前判断";
  const edgeLabel =
    probabilityGap >= 0.18 ? "优势清晰" : probabilityGap >= 0.08 ? "小幅领先" : "分歧较大";

  return {
    headline: `${statusPrefix}：${outcomeSummary.label}是模型首选，${edgeLabel}`,
    detail:
      `${confidenceLabel}。${strongestFactor ? `主要由${strongestFactor.label}驱动；` : ""}` +
      `${riskFactor ? `需要留意${riskFactor.label}。` : "当前没有明显反向风险项。"}`,
    tone: outcomeSummary.tone,
    tiles: [
      {
        label: "领先幅度",
        value: percent(probabilityGap),
        detail: `${orderedOutcomes[0].label} 对 ${orderedOutcomes[1].label}`
      },
      {
        label: "主导因素",
        value: strongestFactor ? strongestFactor.label : "暂无",
        detail: strongestFactor
          ? `${strongestFactor.impact >= 0 ? "+" : ""}${strongestFactor.impact.toFixed(2)} · ${strongestFactor.description}`
          : "缺少可解释因素"
      },
      {
        label: "风险点",
        value: riskFactor ? riskFactor.label : "低风险",
        detail: riskFactor
          ? `${riskFactor.impact.toFixed(2)} · ${riskFactor.description}`
          : "没有明显拖累项"
      },
      {
        label: "比分倾向",
        value: topScore ? `${topScore.homeGoals}-${topScore.awayGoals}` : "待定",
        detail: topScore ? `${percent(topScore.probability)} 单一比分概率` : "缺少比分矩阵"
      }
    ]
  };
}

export function MatchPredictionCard({
  match,
  prediction,
  teamsById
}: MatchPredictionCardProps) {
  const home = teamsById.get(match.homeTeamId);
  const away = teamsById.get(match.awayTeamId);
  const finalScore = match.result
    ? `${match.result.homeGoals}-${match.result.awayGoals}`
    : null;
  const topScore = prediction.topScores[0];

  if (!home || !away) {
    return (
      <section className="panel match-panel">
        <div className="panel__header">
          <div>
            <span className="eyebrow">选中比赛</span>
            <h2>球队数据缺失</h2>
          </div>
        </div>
        <p className="panel-empty">
          这场比赛无法匹配完整球队信息。请检查导入快照中的 `homeTeamId` 和 `awayTeamId`。
        </p>
      </section>
    );
  }

  const outcomeSummary = getOutcomeSummary(prediction, home, away);
  const xgDelta = prediction.lambdaHome - prediction.lambdaAway;
  const xgEdgeLabel = getXgEdgeLabel(xgDelta, home, away);
  const factorBalance = getFactorBalance(prediction);
  const matchInsight = buildMatchInsight(match, prediction, home, away);

  return (
    <section className="panel match-panel">
      <div className="panel__header">
        <div>
          <span className="eyebrow">选中比赛</span>
          <h2>
            {home.name} <span>vs</span> {away.name}
          </h2>
        </div>
        <div className="confidence">
          <span>{finalScore ? "已完赛" : "模型信心"}</span>
          <strong>{finalScore ?? percent(prediction.confidence)}</strong>
        </div>
      </div>

      {finalScore ? (
        <div className="result-notice">
          赛果已计入小组积分和蒙特卡洛模拟；下方仍展示模型先验概率用于复盘。
        </div>
      ) : null}

      <div className={`match-insight match-insight--${matchInsight.tone}`} aria-label="赛前重点解读">
        <div className="match-insight__lead">
          <span>
            <Icon name="activity" size={17} />
          </span>
          <div>
            <strong>{matchInsight.headline}</strong>
            <p>{matchInsight.detail}</p>
          </div>
        </div>
        <div className="match-insight__tiles">
          {matchInsight.tiles.map((tile) => (
            <article className="match-insight__tile" key={tile.label}>
              <span>{tile.label}</span>
              <strong>{tile.value}</strong>
              <p>{tile.detail}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="match-summary-grid" aria-label="比赛预测摘要">
        <div className={`match-summary-card match-summary-card--${outcomeSummary.tone}`}>
          <span>模型首选</span>
          <strong>{outcomeSummary.label}</strong>
          <em>{percent(outcomeSummary.value)} 概率</em>
        </div>
        <div className="match-summary-card">
          <span>预期进球差</span>
          <strong>{xgDelta >= 0 ? "+" : ""}{xgDelta.toFixed(2)}</strong>
          <em>{xgEdgeLabel}</em>
        </div>
        <div className="match-summary-card">
          <span>最高比分</span>
          <strong>{topScore ? `${topScore.homeGoals}-${topScore.awayGoals}` : "待定"}</strong>
          <em>{topScore ? `${percent(topScore.probability)} 概率` : "缺少比分矩阵"}</em>
        </div>
        <div className={`match-summary-card match-summary-card--${factorBalance.tone}`}>
          <span>因素合力</span>
          <strong>{factorBalance.value}</strong>
          <em>{factorBalance.label}</em>
        </div>
      </div>

      <div className="match-overview">
        <div className="match-scoreline">
          <div>
            <strong>{home.abbr}</strong>
            <span>{prediction.lambdaHome.toFixed(2)} xG</span>
          </div>
          <div className="match-scoreline__divider">胜/平/负</div>
          <div>
            <strong>{away.abbr}</strong>
            <span>{prediction.lambdaAway.toFixed(2)} xG</span>
          </div>
        </div>

        <div className="probability-stack">
          <ProbabilityBar label={`${home.abbr} 胜`} value={prediction.homeWin} tone="home" />
          <ProbabilityBar label="平局" value={prediction.draw} tone="draw" />
          <ProbabilityBar label={`${away.abbr} 胜`} value={prediction.awayWin} tone="away" />
        </div>
      </div>

      <div className="team-comparison">
        <div className="subheading">双方数据对比</div>
        <div className="team-comparison__grid">
          <ComparisonMetric
            awayValue={away.elo}
            formatter={(value) => value.toFixed(0)}
            higherIsBetter
            homeValue={home.elo}
            label="ELO"
          />
          <ComparisonMetric
            awayValue={away.fifaRank}
            formatter={(value) => `#${value.toFixed(0)}`}
            homeValue={home.fifaRank}
            label="FIFA"
          />
          <ComparisonMetric
            awayValue={away.attack}
            formatter={(value) => value.toFixed(2)}
            higherIsBetter
            homeValue={home.attack}
            label="进攻"
          />
          <ComparisonMetric
            awayValue={away.defense}
            formatter={(value) => value.toFixed(2)}
            higherIsBetter
            homeValue={home.defense}
            label="防守"
          />
          <ComparisonMetric
            awayValue={away.form}
            formatter={(value) => value.toFixed(2)}
            higherIsBetter
            homeValue={home.form}
            label="状态"
          />
          <ComparisonMetric
            awayValue={away.injuries}
            formatter={(value) => value.toFixed(2)}
            homeValue={home.injuries}
            label="伤停"
          />
        </div>
        <div className="team-comparison__flags">
          <span>{home.abbr} {home.host ? "东道主" : "中立/客场"}</span>
          <span>{away.abbr} {away.host ? "东道主" : "中立/客场"}</span>
        </div>
      </div>

      <div className="split-grid">
        <div>
          <div className="subheading">比分概率</div>
          <ScoreHeatmap prediction={prediction} />
        </div>
        <div>
          <div className="subheading">关键因素</div>
          <div className="factor-list">
            {prediction.factors.map((factor, index) => {
              const icon = factorIcons[index % factorIcons.length];
              return (
                <div className="factor-item" key={factor.label}>
                  <span className="factor-item__icon">
                    <Icon name={icon} size={16} />
                  </span>
                  <div>
                    <strong>{factor.label}</strong>
                    <p>{factor.description}</p>
                  </div>
                  <span className={factor.impact >= 0 ? "impact positive" : "impact negative"}>
                    {factor.impact >= 0 ? "+" : ""}
                    {factor.impact.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonMetric({
  awayValue,
  formatter,
  higherIsBetter,
  homeValue,
  label
}: {
  awayValue: number;
  formatter: (value: number) => string;
  higherIsBetter?: boolean;
  homeValue: number;
  label: string;
}) {
  const homeIsBetter = higherIsBetter ? homeValue >= awayValue : homeValue <= awayValue;
  const awayIsBetter = higherIsBetter ? awayValue >= homeValue : awayValue <= homeValue;

  return (
    <div className="comparison-metric">
      <strong className={homeIsBetter ? "is-stronger" : ""}>{formatter(homeValue)}</strong>
      <span>{label}</span>
      <strong className={awayIsBetter ? "is-stronger" : ""}>{formatter(awayValue)}</strong>
    </div>
  );
}
