# Data Update Scripts

`data-update.mjs` prepares JSON for the app's manual import panel.

Examples:

```powershell
npm.cmd run data:update -- --file C:\tmp\worldcup-results.json --out C:\tmp\worldcup-import.json
npm.cmd run data:update -- --file C:\tmp\worldcup-results.json --print
npm.cmd run data:update -- --url https://example.com/worldcup-feed.json --out C:\tmp\worldcup-import.json
```

Supported input:

- Full `TournamentSnapshot` with `teams` and `fixtures`.
- Partial package with `results`, `matches`, or `fixtures`.
- Raw array of result rows, treated as `results`.

The generated JSON can be pasted into the dashboard's data update center.

## Compose Import Packages

`data:compose` runs multiple adapters and merges their outputs into one import
package.

```powershell
npm.cmd run data:compose -- --adapter fifa-rankings --adapter odds-market --print
npm.cmd run data:compose -- --source fifa-rankings=C:\tmp\rankings.csv --source recent-form=C:\tmp\recent-form.csv --out C:\tmp\worldcup-combined.json
npm.cmd run data:compose -- --source injuries-news=C:\tmp\injuries.csv --source odds-market=C:\tmp\odds.csv --source news-sentiment=C:\tmp\news.csv --label "Daily model input" --out C:\tmp\daily-import.json
```

Merge rules:

- `fixtures` and `results` are merged by `id` / `matchId`; later sources win.
- `teamPatches` are merged by `id`, `teamId`, or `abbr`.
- Dynamic numeric fields `form`, `injuries`, `attack`, and `defense` are
  averaged when multiple sources provide the same field.
- Static fields such as `fifaRank`, `elo`, `name`, `group`, and `color` use the
  later source value.

## Adapter Skeletons

`data:adapter` runs one source adapter and outputs the same import package shape.

```powershell
npm.cmd run data:adapter -- --list
npm.cmd run data:adapter -- --adapter fifa-fixtures --print
npm.cmd run data:adapter -- --adapter fifa-fixtures --file C:\tmp\fixtures.html --out C:\tmp\fixtures-import.json
npm.cmd run data:adapter -- --adapter fifa-fixtures --file C:\tmp\fixtures.json --out C:\tmp\fixtures-import.json
npm.cmd run data:adapter -- --adapter fifa-rankings --out C:\tmp\rankings-import.json
npm.cmd run data:adapter -- --adapter fifa-rankings --file C:\tmp\rankings.csv --out C:\tmp\rankings-import.json
npm.cmd run data:adapter -- --adapter fifa-rankings --file C:\tmp\rankings.json --out C:\tmp\rankings-import.json
npm.cmd run data:adapter -- --adapter injuries-news --out C:\tmp\injuries-import.json
npm.cmd run data:adapter -- --adapter injuries-news --file C:\tmp\injuries.csv --out C:\tmp\injuries-import.json
npm.cmd run data:adapter -- --adapter injuries-news --file C:\tmp\injuries.json --out C:\tmp\injuries-import.json
npm.cmd run data:adapter -- --adapter news-sentiment --out C:\tmp\news-import.json
npm.cmd run data:adapter -- --adapter news-sentiment --file C:\tmp\news.csv --out C:\tmp\news-import.json
npm.cmd run data:adapter -- --adapter news-sentiment --file C:\tmp\news.json --out C:\tmp\news-import.json
npm.cmd run data:adapter -- --adapter odds-market --out C:\tmp\odds-import.json
npm.cmd run data:adapter -- --adapter odds-market --file C:\tmp\odds.csv --out C:\tmp\odds-import.json
npm.cmd run data:adapter -- --adapter odds-market --file C:\tmp\odds.json --out C:\tmp\odds-import.json
npm.cmd run data:adapter -- --adapter recent-form --out C:\tmp\recent-form-import.json
npm.cmd run data:adapter -- --adapter recent-form --file C:\tmp\recent-form.csv --out C:\tmp\recent-form-import.json
npm.cmd run data:adapter -- --adapter recent-form --file C:\tmp\recent-form.json --out C:\tmp\recent-form-import.json
```

Current adapters return mock/manual JSON only. Replace each adapter's `run...Adapter`
implementation when a real source is available.

`fifa-fixtures` already supports offline parsing from local files:

- JSON: an array, `{ "fixtures": [...] }`, or `{ "matches": [...] }`.
- HTML: elements with `data-match-id`, plus optional `data-group`,
  `data-matchday`, `data-date`, `data-venue`, `data-home-team-id`,
  `data-away-team-id`, `data-home-goals`, `data-away-goals`, `data-status`.

`fifa-rankings` supports offline parsing from:

- JSON: an array, `{ "rankings": [...] }`, `{ "teams": [...] }`, or
  `{ "teamPatches": [...] }`.
- CSV/TSV: header row plus data rows. Supported columns include `id`,
  `teamId`, `abbr`, `rank`, `fifaRank`, `position`, `elo`, `attack`,
  `defense`, `form`, `injuries`, `name`.

`injuries-news` supports offline parsing from:

- JSON: an array, `{ "injuries": [...] }`, `{ "news": [...] }`,
  `{ "teams": [...] }`, or `{ "teamPatches": [...] }`.
- CSV/TSV: header row plus data rows. Supported columns include `id`,
  `teamId`, `abbr`, `injuries`, `injuryLoad`, `injuryIndex`,
`injuryScore`, `absenceLoad`, `form`, `recentForm`, `statusForm`,
  `attack`, `defense`, `name`.

`news-sentiment` supports offline parsing from:

- JSON: an array, `{ "news": [...] }`, `{ "sentiment": [...] }`,
  `{ "articles": [...] }`, `{ "items": [...] }`, `{ "teams": [...] }`,
  or `{ "teamPatches": [...] }`.
- CSV/TSV: header row plus data rows. Supported columns include `id`,
  `teamId`, `abbr`, `teamAbbr`, `sentiment`, `sentimentScore`,
  `sentimentIndex`, `tone`, `sentimentLabel`, `hype`, `heat`,
  `mediaHeat`, `publicHeat`, `buzz`, `attention`, `risk`, `riskScore`,
  `controversy`, `pressure`, `injuryMentions`, `injuryCount`,
  `injuryRisk`, `injurySignal`, `absenceRisk`, `suspensionRisk`,
  `mentions`, `totalMentions`, `articleCount`, `weight`, `importance`,
  `impact`, `form`, `injuries`, `name`.
- If `form` is not present, sentiment, heat, and risk are converted into a
  conservative `form` patch. Injury or suspension signals are converted into
  an `injuries` patch.

`odds-market` supports offline parsing from:

- JSON: an array, `{ "odds": [...] }`, `{ "markets": [...] }`,
  `{ "teams": [...] }`, or `{ "teamPatches": [...] }`.
- CSV/TSV: header row plus data rows. Supported columns include `id`,
  `teamId`, `abbr`, `form`, `marketForm`, `marketSignal`,
  `probability`, `probabilityPct`, `impliedProbability`,
  `championProbability`, `titleProbability`, `odds`, `decimalOdds`,
  `championOdds`, `titleOdds`, `outrightOdds`, `attack`, `defense`,
  `injuries`, `name`.
- If `form` is not present, probability or decimal odds are converted into a
  conservative `form` patch against a 48-team baseline.

`recent-form` supports offline parsing from:

- JSON: an array, `{ "recentForm": [...] }`, `{ "matches": [...] }`,
  `{ "results": [...] }`, `{ "teams": [...] }`, or `{ "teamPatches": [...] }`.
- CSV/TSV team summary rows. Supported columns include `id`, `teamId`,
  `abbr`, `matches`, `played`, `recentMatches`, `wins`, `draws`, `losses`,
  `points`, `goalsFor`, `gf`, `goalsAgainst`, `ga`, `lastResults`,
  `form`, `recentForm`, `attack`, `defense`, `injuries`, `name`.
- CSV/TSV fixture rows. Supported columns include `homeTeamId`, `homeAbbr`,
  `awayTeamId`, `awayAbbr`, `homeGoals`, `homeScore`, `awayGoals`,
  `awayScore`.
- If `form` is not present, results and goals are converted into conservative
  `form`, `attack`, and `defense` patches.
