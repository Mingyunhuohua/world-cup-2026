import { percent } from "../utils/format.ts";

type ProbabilityBarProps = {
  label: string;
  value: number;
  tone?: "home" | "draw" | "away" | "neutral";
};

export function ProbabilityBar({
  label,
  value,
  tone = "neutral"
}: ProbabilityBarProps) {
  return (
    <div className="probability-bar">
      <div className="probability-bar__meta">
        <span>{label}</span>
        <strong>{percent(value)}</strong>
      </div>
      <div className="probability-bar__track">
        <span
          className={`probability-bar__fill probability-bar__fill--${tone}`}
          style={{ width: `${Math.max(3, value * 100)}%` }}
        />
      </div>
    </div>
  );
}
