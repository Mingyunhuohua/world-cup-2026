import { useMemo, useState } from "react";
import type { PredictionResult } from "../types.ts";
import { percent } from "../utils/format.ts";

type ScoreHeatmapProps = {
  prediction: PredictionResult;
};

type ScoreSelection = {
  homeGoals: number;
  awayGoals: number;
};

const goalAxis = [0, 1, 2, 3, 4];

function getResultLabel(homeGoals: number, awayGoals: number) {
  if (homeGoals > awayGoals) return "主胜";
  if (homeGoals < awayGoals) return "客胜";
  return "平局";
}

function getResultTone(homeGoals: number, awayGoals: number) {
  if (homeGoals > awayGoals) return "home";
  if (homeGoals < awayGoals) return "away";
  return "draw";
}

export function ScoreHeatmap({ prediction }: ScoreHeatmapProps) {
  const scoreByKey = useMemo(
    () =>
      new Map(
        prediction.scoreMatrix.map((score) => [
          `${score.homeGoals}-${score.awayGoals}`,
          score
        ])
      ),
    [prediction.scoreMatrix]
  );
  const max = Math.max(...prediction.scoreMatrix.map((score) => score.probability));
  const defaultSelection = prediction.topScores[0] ?? {
    homeGoals: 0,
    awayGoals: 0,
    probability: 0
  };
  const featuredScores = prediction.topScores.slice(0, 4);
  const [lockedScore, setLockedScore] = useState<ScoreSelection | null>(null);
  const [hoveredScore, setHoveredScore] = useState<ScoreSelection | null>(null);
  const activeSelection = hoveredScore ?? lockedScore ?? defaultSelection;
  const activeScore =
    scoreByKey.get(`${activeSelection.homeGoals}-${activeSelection.awayGoals}`) ??
    defaultSelection;
  const activeTone = getResultTone(activeScore.homeGoals, activeScore.awayGoals);

  return (
    <div className="heatmap">
      <div className={`heatmap__detail heatmap__detail--${activeTone}`}>
        <div>
          <span>{lockedScore ? "已锁定比分" : hoveredScore ? "正在查看" : "最高概率比分"}</span>
          <strong>
            {activeScore.homeGoals}-{activeScore.awayGoals}
          </strong>
        </div>
        <div>
          <span>{getResultLabel(activeScore.homeGoals, activeScore.awayGoals)}</span>
          <strong>{percent(activeScore.probability, 1)}</strong>
        </div>
      </div>

      {featuredScores.length > 0 ? (
        <div className="heatmap__featured" aria-label="高概率比分">
          {featuredScores.map((score) => {
            const isSelected =
              activeScore.homeGoals === score.homeGoals &&
              activeScore.awayGoals === score.awayGoals;

            return (
              <button
                aria-pressed={isSelected}
                className={isSelected ? "is-active" : ""}
                key={`${score.homeGoals}-${score.awayGoals}`}
                onClick={() =>
                  setLockedScore((current) =>
                    current?.homeGoals === score.homeGoals && current.awayGoals === score.awayGoals
                      ? null
                      : { homeGoals: score.homeGoals, awayGoals: score.awayGoals }
                  )
                }
                type="button"
              >
                <strong>
                  {score.homeGoals}-{score.awayGoals}
                </strong>
                <span>{percent(score.probability, 1)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="heatmap__grid">
        <span className="heatmap__corner">比分</span>
        {goalAxis.map((goal) => (
          <span className="heatmap__axis" key={`away-${goal}`}>
            客{goal}
          </span>
        ))}
        {goalAxis.map((homeGoal) => [
          <span className="heatmap__axis" key={`home-${homeGoal}`}>
            主{homeGoal}
          </span>,
          ...goalAxis.map((awayGoal) => {
            const score = scoreByKey.get(`${homeGoal}-${awayGoal}`);
            const intensity = score ? score.probability / max : 0;
            const isLocked =
              lockedScore?.homeGoals === homeGoal && lockedScore.awayGoals === awayGoal;
            const isActive =
              activeScore.homeGoals === homeGoal && activeScore.awayGoals === awayGoal;
            const tone = getResultTone(homeGoal, awayGoal);

            return (
              <button
                aria-label={`${homeGoal}-${awayGoal} ${getResultLabel(homeGoal, awayGoal)}，概率 ${percent(score?.probability ?? 0, 1)}`}
                className={[
                  "heatmap__cell",
                  `heatmap__cell--${tone}`,
                  isActive ? "is-active" : "",
                  isLocked ? "is-locked" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={`${homeGoal}-${awayGoal}`}
                onBlur={() => setHoveredScore(null)}
                onClick={() =>
                  setLockedScore((current) =>
                    current?.homeGoals === homeGoal && current.awayGoals === awayGoal
                      ? null
                      : { homeGoals: homeGoal, awayGoals: awayGoal }
                  )
                }
                onFocus={() => setHoveredScore({ homeGoals: homeGoal, awayGoals: awayGoal })}
                onMouseEnter={() => setHoveredScore({ homeGoals: homeGoal, awayGoals: awayGoal })}
                onMouseLeave={() => setHoveredScore(null)}
                style={{
                  backgroundColor: `rgba(47, 125, 89, ${0.12 + intensity * 0.76})`
                }}
                title={`${homeGoal}-${awayGoal}: ${percent(score?.probability ?? 0)}`}
                type="button"
              >
                {score && score.probability > 0.045
                  ? percent(score.probability, 0)
                  : ""}
              </button>
            );
          })
        ])}
      </div>
      <div className="heatmap__legend" aria-label="比分热力图图例">
        <span><i className="heatmap__legend-dot heatmap__legend-dot--home" />主胜比分</span>
        <span><i className="heatmap__legend-dot heatmap__legend-dot--draw" />平局比分</span>
        <span><i className="heatmap__legend-dot heatmap__legend-dot--away" />客胜比分</span>
      </div>
    </div>
  );
}
