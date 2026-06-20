type IconName =
  | "activity"
  | "alert"
  | "calendar"
  | "database"
  | "gauge"
  | "git"
  | "play"
  | "refresh"
  | "search"
  | "shield"
  | "trending"
  | "trophy"
  | "x";

type IconProps = {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 18 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

const paths: Record<IconName, any> = {
  activity: <path d="M4 13h4l2-6 4 12 2-6h4" />,
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  calendar: (
    <>
      <rect height="16" rx="2" width="18" x="3" y="5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  gauge: (
    <>
      <path d="M5 19a8 8 0 1 1 14 0" />
      <path d="m13 13 4-4" />
      <path d="M12 13h.01" />
    </>
  ),
  git: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M8 6h3a4 4 0 0 1 4 4v6" />
      <path d="M6 8v8" />
    </>
  ),
  play: <path d="M8 5v14l11-7-11-7Z" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 0 1-13.7 5.7" />
      <path d="M4 12A8 8 0 0 1 17.7 6.3" />
      <path d="M7 18H4v3" />
      <path d="M17 6h3V3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  shield: <path d="M12 3 5 6v6c0 4.4 3 7.5 7 9 4-1.5 7-4.6 7-9V6l-7-3Z" />,
  trending: <path d="m3 17 6-6 4 4 7-8M14 7h6v6" />,
  trophy: (
    <>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M5 6H3a3 3 0 0 0 3 3h1" />
      <path d="M19 6h2a3 3 0 0 1-3 3h-1" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />
};
