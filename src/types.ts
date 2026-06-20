export type Round =
  | "GROUP"
  | "R32"
  | "R16"
  | "QF"
  | "SF"
  | "FINAL";

export type DataSource = {
  name: string;
  kind?: "official" | "media" | "manual" | "seed";
  url?: string;
  updatedAt: string;
  retrievedAt?: string;
  confidence: "seed" | "estimated" | "verified";
  notes?: string;
};

export type Team = {
  id: string;
  name: string;
  abbr: string;
  group: string;
  fifaRank: number;
  elo: number;
  attack: number;
  defense: number;
  form: number;
  injuries: number;
  host?: boolean;
  color: string;
  source: DataSource;
};

export type MatchResult = {
  homeGoals: number;
  awayGoals: number;
};

export type DisciplineRecord = {
  yellowCards?: number;
  secondYellowReds?: number;
  directRedCards?: number;
  yellowThenDirectReds?: number;
};

export type MatchDiscipline = {
  home: DisciplineRecord;
  away: DisciplineRecord;
};

export type Match = {
  id: string;
  round: Round;
  group?: string;
  matchday?: number;
  date: string;
  venue: string;
  homeTeamId: string;
  awayTeamId: string;
  neutral: boolean;
  status?: "scheduled" | "completed";
  result?: MatchResult;
  discipline?: MatchDiscipline;
  source: DataSource;
};

export type ScoreProbability = {
  homeGoals: number;
  awayGoals: number;
  probability: number;
};

export type PredictionFactor = {
  label: string;
  impact: number;
  description: string;
};

export type PredictionResult = {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  lambdaHome: number;
  lambdaAway: number;
  homeWin: number;
  draw: number;
  awayWin: number;
  scoreMatrix: ScoreProbability[];
  topScores: ScoreProbability[];
  factors: PredictionFactor[];
  confidence: number;
};

export type GroupStanding = {
  teamId: string;
  group: string;
  played: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  fairPlayPoints?: number;
  fifaRankTieBreak?: number;
  ratingTieBreak: number;
};

export type TeamSimulationSummary = {
  teamId: string;
  group: string;
  groupQualification: number;
  round32: number;
  round16: number;
  quarterFinal: number;
  semiFinal: number;
  final: number;
  champion: number;
  championCiLow: number;
  championCiHigh: number;
  expectedPoints: number;
};

export type BracketSlot = {
  label: string;
  teamId: string;
  probability: number;
  probabilityCiLow?: number;
  probabilityCiHigh?: number;
};

export type SimulationSummary = {
  iterations: number;
  seed: number;
  teams: TeamSimulationSummary[];
  bracketPreview: BracketSlot[];
  generatedAt: string;
};

export type SimulationAuditDataSource = {
  id: string;
  label: string;
  kind: DataProvider["kind"];
  status: DataProvider["status"];
  coverage: string;
  updatedAt: string;
  retrievedAt: string;
};

export type SimulationAuditSummary = {
  exportedAt: string;
  simulationGeneratedAt: string;
  iterations: number;
  seed: number;
  snapshotId: string;
  snapshotLabel: string;
  snapshotCollectedAt: string;
  teamCount: number;
  fixtureCount: number;
  completedMatches: number;
  scheduledMatches: number;
  modelConfig?: ModelConfig;
  knockoutRuleSet: {
    id: string;
    label: string;
    source: "official" | "placeholder";
    notes: string;
  };
  dataSources: SimulationAuditDataSource[];
  notes: string[];
};

export type DataProvider = {
  id: string;
  label: string;
  kind: "official" | "media" | "manual";
  url: string;
  updatedAt: string;
  retrievedAt: string;
  coverage: string;
  status: "active" | "fallback" | "planned";
  notes?: string;
};

export type DataFeedKind =
  | "fixtures"
  | "rankings"
  | "injuries"
  | "odds"
  | "recentForm"
  | "news";

export type DataFeedStatus = "ready" | "placeholder" | "planned" | "blocked";

export type DataFeedResult = {
  id: string;
  label: string;
  kind: DataFeedKind;
  status: DataFeedStatus;
  records: number;
  updatedAt: string;
  confidence: "verified" | "estimated" | "seed";
  sourceId?: string;
  message: string;
};

export type DataQualityLevel = "pass" | "warn" | "fail";

export type DataQualityCheck = {
  id: string;
  label: string;
  level: DataQualityLevel;
  actual: string | number;
  expected: string | number;
  detail: string;
};

export type DataUpdateReport = {
  adapterId: string;
  adapterLabel: string;
  generatedAt: string;
  feeds: DataFeedResult[];
  qualityChecks: DataQualityCheck[];
};

export type DataImportSummary = {
  importedFixtures: number;
  importedResults: number;
  importedTeams: number;
  importedDiscipline?: number;
  warnings: string[];
  appliedAt: string;
  label: string;
};

export type RuntimeSnapshotLoad = {
  snapshot: TournamentSnapshot;
  restored: boolean;
  savedAt?: string;
  error?: string;
};

export type TournamentSnapshot = {
  id: string;
  label: string;
  collectedAt: string;
  teams: Team[];
  fixtures: Match[];
  sources: DataProvider[];
  completedMatches: number;
  scheduledMatches: number;
  notes: string[];
};

export type ModelConfig = {
  baseGoals: number;
  maxGoals: number;
  eloWeight: number;
  rankWeight: number;
  formWeight: number;
  injuryWeight: number;
  suspensionRiskWeight: number;
  hostBoost: number;
  restDaysWeight: number;
  dixonColesRho: number;
  extraTimeGoalRate: number;
  penaltyStrengthWeight: number;
  simulationIterations: number;
};
