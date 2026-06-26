type WorldCupHeroProps = {
  teamCount: number;
};

export function WorldCupHero({ teamCount }: WorldCupHeroProps) {
  return (
    <section className="world-cup-hero" aria-label="2026 世界杯主题插图">
      <svg
        className="world-cup-hero__art"
        viewBox="0 0 340 360"
        role="img"
        aria-label="原创世界杯主题插图：绿茵场中央一座金色奖杯，下方为 2026 世界杯预测字样"
      >
        <circle cx="170" cy="120" r="84" fill="none" stroke="#ffffff" strokeWidth="2.5" opacity="0.8" />
        <line x1="14" y1="120" x2="326" y2="120" stroke="#ffffff" strokeWidth="2.5" opacity="0.55" />
        <circle cx="170" cy="120" r="5" fill="#ffffff" opacity="0.9" />

        <path d="M138 66 L202 66 Q202 122 170 132 Q138 122 138 66 Z" fill="#c2922f" />
        <ellipse cx="170" cy="66" rx="32" ry="7" fill="#d8b35c" />
        <path d="M138 74 C115 78 115 114 140 118" fill="none" stroke="#c2922f" strokeWidth="5" strokeLinecap="round" />
        <path d="M202 74 C225 78 225 114 200 118" fill="none" stroke="#c2922f" strokeWidth="5" strokeLinecap="round" />
        <rect x="162" y="132" width="16" height="22" fill="#c2922f" />
        <rect x="146" y="154" width="48" height="8" rx="2" fill="#d8b35c" />
        <path d="M140 162 L200 162 L210 180 L130 180 Z" fill="#c2922f" />

        <circle cx="268" cy="196" r="16" fill="#ffffff" stroke="#205a42" strokeWidth="2" />
        <path d="M268 187 L273.5 191 L271.5 198 L264.5 198 L262.5 191 Z" fill="#205a42" />
        <circle cx="80" cy="60" r="3" fill="#bb8a2c" />
        <circle cx="276" cy="58" r="3" fill="#2f7d59" />
        <circle cx="56" cy="150" r="2.5" fill="#2f7d59" />

        <text x="170" y="232" textAnchor="middle" fill="#1b3326" fontSize="46" fontWeight="700" letterSpacing="2">
          2026
        </text>
        <text x="170" y="258" textAnchor="middle" fill="#2f7d59" fontSize="15" fontWeight="600" letterSpacing="6">
          世界杯预测
        </text>

        <circle cx="146" cy="286" r="4" fill="#c24136" />
        <circle cx="170" cy="286" r="4" fill="#2f6fb7" />
        <circle cx="194" cy="286" r="4" fill="#2f7d59" />
        <text x="170" y="312" textAnchor="middle" fill="#647067" fontSize="12">
          {teamCount} 队 · 104 场 · 北美三国共办
        </text>
      </svg>
    </section>
  );
}
