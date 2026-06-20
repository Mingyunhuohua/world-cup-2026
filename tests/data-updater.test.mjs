import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadJsonSource,
  normalizeImportPayload,
  parseArgs,
  writeJsonOutput
} from "../scripts/data-update.mjs";
import {
  composeAdapterPackages,
  parseComposeArgs,
  runCompose
} from "../scripts/data-compose.mjs";
import {
  listAdapters,
  parseAdapterArgs,
  runAdapter
} from "../scripts/adapters/index.mjs";
import { parseFifaFixturesSource } from "../scripts/adapters/fifa-fixtures.mjs";
import { parseFifaRankingsSource } from "../scripts/adapters/fifa-rankings.mjs";
import { parseInjuriesNewsSource } from "../scripts/adapters/injuries-news.mjs";
import { parseNewsSentimentSource } from "../scripts/adapters/news-sentiment.mjs";
import { parseOddsMarketSource } from "../scripts/adapters/odds-market.mjs";
import { parseRecentFormSource } from "../scripts/adapters/recent-form.mjs";
import { previewTournamentImport } from "../src/data/importPreview.ts";
import { currentTournamentSnapshot } from "../src/data/snapshot.ts";

test("数据更新器参数要求一个输入源和输出方式", () => {
  assert.deepEqual(parseArgs(["--file", "input.json", "--print"]), {
    file: "input.json",
    url: undefined,
    out: undefined,
    print: true,
    label: undefined
  });

  assert.throws(() => parseArgs(["--file", "a.json", "--url", "https://example.com"]), /exactly one/);
  assert.throws(() => parseArgs(["--file", "a.json"]), /--out or --print/);
});

test("数据更新器会把赛果数组标准化为导入包", () => {
  const normalized = normalizeImportPayload(
    [
      {
        id: "A-2-1",
        homeGoals: 2,
        awayGoals: 1
      }
    ],
    { generatedAt: "2026-06-13T00:00:00Z", label: "test feed" }
  );

  assert.equal(normalized.label, "test feed");
  assert.equal(normalized.results[0].matchId, "A-2-1");
  assert.equal(normalized.results[0].status, "completed");
  assert.equal(normalized.fixtures.length, 0);
});

test("数据更新器会保留纪律数据行", () => {
  const normalized = normalizeImportPayload(
    [
      {
        id: "A-2-1",
        homeYellowCards: 2,
        awayYellowCards: 1,
        awayDirectRedCards: 1
      }
    ],
    { generatedAt: "2026-06-13T00:00:00Z", label: "discipline feed" }
  );

  assert.equal(normalized.results[0].matchId, "A-2-1");
  assert.equal(normalized.results[0].status, "scheduled");
  assert.deepEqual(normalized.results[0].discipline, {
    home: { yellowCards: 2 },
    away: { yellowCards: 1, directRedCards: 1 }
  });
});

test("数据更新器会保留球队补丁", () => {
  const normalized = normalizeImportPayload(
    {
      label: "rankings",
      teamPatches: [
        {
          id: "mex",
          fifaRank: 14,
          injuries: 0.07
        }
      ]
    },
    { generatedAt: "2026-06-13T00:00:00Z" }
  );

  assert.equal(normalized.teamPatches[0].id, "mex");
  assert.equal(normalized.teamPatches[0].fifaRank, 14);
  assert.equal(normalized.results.length, 0);
});

test("组合数据包参数支持 adapter 和 adapter=file source", () => {
  assert.deepEqual(parseComposeArgs(["--adapter", "odds-market", "--print"]), {
    sources: [{ adapter: "odds-market", file: undefined }],
    out: undefined,
    print: true,
    label: undefined,
    generatedAt: undefined,
    list: false,
    help: false
  });

  const options = parseComposeArgs([
    "--source",
    "fifa-rankings=C:\\tmp\\rankings.csv",
    "--source",
    "recent-form=C:\\tmp\\recent.csv",
    "--out",
    "C:\\tmp\\combined.json"
  ]);

  assert.equal(options.sources[0].adapter, "fifa-rankings");
  assert.equal(options.sources[0].file, "C:\\tmp\\rankings.csv");
  assert.equal(options.sources[1].adapter, "recent-form");
  assert.equal(options.out, "C:\\tmp\\combined.json");
  assert.throws(() => parseComposeArgs(["--source", "=", "--print"]), /adapter=file/);
});

test("组合数据包会合并赛程赛果并平均动态球队字段", () => {
  const combined = composeAdapterPackages(
    [
      {
        adapter: { id: "fifa-rankings", label: "rankings" },
        fixtures: [
          {
            id: "A-1-1",
            venue: "Old venue",
            status: "scheduled"
          }
        ],
        results: [
          {
            matchId: "A-1-1",
            homeGoals: 1,
            awayGoals: 0
          }
        ],
        teamPatches: [
          {
            id: "bra",
            abbr: "BRA",
            fifaRank: 5,
            form: 0.1,
            attack: 1.08
          }
        ],
        warnings: ["rankings warning"]
      },
      {
        adapter: { id: "news-sentiment", label: "news" },
        fixtures: [
          {
            id: "A-1-1",
            venue: "New venue"
          }
        ],
        results: [
          {
            matchId: "A-1-1",
            homeGoals: 2,
            awayGoals: 1
          }
        ],
        teamPatches: [
          {
            abbr: "BRA",
            form: -0.02,
            injuries: 0.04
          }
        ],
        warnings: ["news warning"]
      }
    ],
    {
      generatedAt: "2026-06-13T00:00:00Z",
      label: "combined"
    }
  );

  assert.equal(combined.label, "combined");
  assert.equal(combined.fixtures.length, 1);
  assert.equal(combined.fixtures[0].venue, "New venue");
  assert.equal(combined.results[0].homeGoals, 2);
  assert.equal(combined.teamPatches.length, 1);
  assert.equal(combined.teamPatches[0].id, "bra");
  assert.equal(combined.teamPatches[0].abbr, "BRA");
  assert.equal(combined.teamPatches[0].fifaRank, 5);
  assert.equal(combined.teamPatches[0].form, 0.04);
  assert.equal(combined.teamPatches[0].attack, 1.08);
  assert.equal(combined.teamPatches[0].injuries, 0.04);
  assert.deepEqual(combined.warnings, ["rankings warning", "news warning"]);
});

test("示例数据模板能组合成应用可预检的导入包", async () => {
  const payload = await runCompose({
    sources: [
      { adapter: "fifa-fixtures", file: "imports/examples/fifa-fixtures.json" },
      { adapter: "fifa-rankings", file: "imports/examples/fifa-rankings.csv" },
      { adapter: "injuries-news", file: "imports/examples/injuries-news.csv" },
      { adapter: "odds-market", file: "imports/examples/odds-market.csv" },
      { adapter: "recent-form", file: "imports/examples/recent-form.csv" },
      { adapter: "news-sentiment", file: "imports/examples/news-sentiment.csv" }
    ],
    generatedAt: "2026-06-14T00:00:00.000Z",
    label: "Daily verified import",
    print: true
  });

  assert.equal(payload.label, "Daily verified import");
  assert.equal(payload.fixtures.length, 3);
  assert.equal(payload.teamPatches.length, 5);
  assert.equal(payload.adapters.length, 6);

  const argentina = payload.teamPatches.find((patch) => patch.id === "arg");
  assert.ok(argentina);
  assert.equal(argentina.abbr, "ARG");
  assert.equal(argentina.fifaRank, 2);
  assert.equal(argentina.elo, 2114);
  assert.equal(argentina.form, 0.1168);
  assert.equal(argentina.injuries, 0.029);
  assert.equal(argentina.attack, 1.138);
  assert.equal(argentina.defense, 1.0973);

  const preview = previewTournamentImport(
    JSON.stringify(payload),
    currentTournamentSnapshot
  );

  assert.equal(preview.summary.label, "Daily verified import");
  assert.equal(preview.summary.importedFixtures, 3);
  assert.equal(preview.summary.importedTeams, 5);
  assert.equal(preview.fixtureChanges.length, 3);
  assert.equal(preview.teamChanges.length, 5);
  assert.match(preview.summary.warnings.join(" "), /质量失败项/);
});

test("数据更新器会标准化完整快照的完赛数量", () => {
  const normalized = normalizeImportPayload(
    {
      id: "snapshot",
      label: "snapshot",
      collectedAt: "2026-06-13T00:00:00Z",
      teams: [],
      sources: [],
      notes: [],
      fixtures: [
        {
          id: "A-1-1",
          status: "completed",
          homeGoals: 1,
          awayGoals: 0
        },
        {
          id: "A-1-2"
        }
      ]
    },
    { generatedAt: "2026-06-13T00:00:00Z" }
  );

  assert.equal(normalized.completedMatches, 1);
  assert.equal(normalized.scheduledMatches, 1);
  assert.deepEqual(normalized.fixtures[0].result, { homeGoals: 1, awayGoals: 0 });
});

test("数据更新器支持从本地文件读取并写出 JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wc-data-update-"));
  const inputPath = join(dir, "input.json");
  const outputPath = join(dir, "output.json");

  await writeFile(
    inputPath,
    JSON.stringify({
      results: [
        {
          matchId: "B-2-1",
          homeGoals: 0,
          awayGoals: 0
        }
      ]
    }),
    "utf8"
  );

  const source = await loadJsonSource({ file: inputPath });
  const normalized = normalizeImportPayload(source, {
    generatedAt: "2026-06-13T00:00:00Z"
  });

  await writeJsonOutput(normalized, { out: outputPath, print: false });

  const output = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(output.results[0].matchId, "B-2-1");
  assert.equal(output.results[0].homeGoals, 0);
});

test("数据源 adapter runner 能列出并运行 mock adapter", async () => {
  const options = parseAdapterArgs(["--adapter", "fifa-rankings", "--file", "fixtures.html", "--print"]);
  const adapters = listAdapters();
  const rankings = await runAdapter("fifa-rankings", {
    generatedAt: "2026-06-13T00:00:00Z"
  });
  const fixtures = await runAdapter("fifa-fixtures", {
    generatedAt: "2026-06-13T00:00:00Z"
  });

  assert.equal(options.adapter, "fifa-rankings");
  assert.equal(options.file, "fixtures.html");
  assert.equal(adapters.length, 6);
  assert.ok(adapters.some((adapter) => adapter.id === "news-sentiment"));
  assert.ok(adapters.some((adapter) => adapter.id === "odds-market"));
  assert.ok(adapters.some((adapter) => adapter.id === "recent-form"));
  assert.equal(rankings.adapter.id, "fifa-rankings");
  assert.ok(rankings.teamPatches.length > 0);
  assert.ok(fixtures.fixtures.length > 0);
});

test("FIFA 赛程 adapter 可解析本地 JSON 赛程文件", () => {
  const fixtures = parseFifaFixturesSource(
    JSON.stringify({
      fixtures: [
        {
          id: "D-1-1",
          group: "D",
          matchday: 1,
          date: "2026-06-13T19:00:00Z",
          venue: "Los Angeles Stadium",
          homeTeamId: "usa",
          awayTeamId: "par",
          homeGoals: 2,
          awayGoals: 1
        }
      ]
    }),
    "fixtures.json"
  );

  assert.equal(fixtures[0].id, "D-1-1");
  assert.equal(fixtures[0].status, "completed");
  assert.deepEqual(fixtures[0].result, { homeGoals: 2, awayGoals: 1 });
});

test("FIFA 赛程 adapter 可解析 data 属性 HTML 快照", () => {
  const html = `
    <article
      data-match-id="C-1-1"
      data-group="C"
      data-matchday="1"
      data-date="2026-06-13T22:00:00Z"
      data-venue="Boston Stadium"
      data-home-team-id="bra"
      data-away-team-id="mar"
      data-home-goals="0"
      data-away-goals="0"
      data-status="completed">
    </article>
  `;
  const fixtures = parseFifaFixturesSource(html, "fixtures.html");

  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].homeTeamId, "bra");
  assert.equal(fixtures[0].awayTeamId, "mar");
  assert.deepEqual(fixtures[0].result, { homeGoals: 0, awayGoals: 0 });
});

test("FIFA 排名 adapter 可解析本地 JSON 排名文件", () => {
  const patches = parseFifaRankingsSource(
    JSON.stringify({
      rankings: [
        {
          abbr: "MEX",
          rank: 14,
          elo: 1820,
          form: 0.13
        }
      ]
    }),
    "rankings.json"
  );

  assert.equal(patches[0].abbr, "MEX");
  assert.equal(patches[0].fifaRank, 14);
  assert.equal(patches[0].elo, 1820);
  assert.equal(patches[0].form, 0.13);
});

test("FIFA 排名 adapter 可解析 CSV/TSV 排名表", () => {
  const csv = [
    "abbr,rank,elo,injuries,name",
    "BRA,5,1965,0.05,巴西",
    "\"ARG\",2,1988,0.06,\"阿根廷\""
  ].join("\n");
  const patches = parseFifaRankingsSource(csv, "rankings.csv");

  assert.equal(patches.length, 2);
  assert.equal(patches[0].abbr, "BRA");
  assert.equal(patches[0].fifaRank, 5);
  assert.equal(patches[1].abbr, "ARG");
  assert.equal(patches[1].name, "阿根廷");
});

test("伤病新闻 adapter 可解析本地 JSON 伤停文件", () => {
  const patches = parseInjuriesNewsSource(
    JSON.stringify({
      injuries: [
        {
          abbr: "MEX",
          injuries: 0.12,
          form: 0.09,
          attack: 1.07
        }
      ]
    }),
    "injuries.json"
  );

  assert.equal(patches[0].abbr, "MEX");
  assert.equal(patches[0].injuries, 0.12);
  assert.equal(patches[0].form, 0.09);
  assert.equal(patches[0].attack, 1.07);
});

test("伤病新闻 adapter 可解析 CSV/TSV 状态表", () => {
  const csv = [
    "abbr,injuryLoad,recentForm,defense,name",
    "USA,0.10,0.11,1.04,美国",
    "FRA,0.06,0.14,1.18,法国"
  ].join("\n");
  const patches = parseInjuriesNewsSource(csv, "injuries.csv");

  assert.equal(patches.length, 2);
  assert.equal(patches[0].abbr, "USA");
  assert.equal(patches[0].injuries, 0.1);
  assert.equal(patches[1].form, 0.14);
  assert.equal(patches[1].defense, 1.18);
});

test("赔率市场 adapter 可解析本地 JSON 概率文件", () => {
  const patches = parseOddsMarketSource(
    JSON.stringify({
      markets: [
        {
          abbr: "ARG",
          championProbability: 0.16,
          attack: 1.21
        }
      ]
    }),
    "odds.json"
  );

  assert.equal(patches[0].abbr, "ARG");
  assert.equal(patches[0].form, 0.137);
  assert.equal(patches[0].attack, 1.21);
});

test("赔率市场 adapter 可解析 CSV/TSV 十进制赔率表", () => {
  const csv = [
    "abbr,championOdds,defense,name",
    "ENG,8.0,1.11,英格兰",
    "ESP,6.5,1.16,西班牙"
  ].join("\n");
  const patches = parseOddsMarketSource(csv, "odds.csv");

  assert.equal(patches.length, 2);
  assert.equal(patches[0].abbr, "ENG");
  assert.equal(patches[0].form, 0.121);
  assert.equal(patches[0].defense, 1.11);
  assert.equal(patches[1].name, "西班牙");
});

test("近期战绩 adapter 可解析本地 JSON 汇总表", () => {
  const patches = parseRecentFormSource(
    JSON.stringify({
      recentForm: [
        {
          abbr: "BRA",
          matches: 5,
          wins: 4,
          draws: 1,
          losses: 0,
          goalsFor: 10,
          goalsAgainst: 3
        }
      ]
    }),
    "recent-form.json"
  );

  assert.equal(patches[0].abbr, "BRA");
  assert.equal(patches[0].form, 0.173);
  assert.equal(patches[0].attack, 1.048);
  assert.equal(patches[0].defense, 1.042);
});

test("近期战绩 adapter 可解析 CSV/TSV 逐场赛果表", () => {
  const csv = [
    "homeAbbr,awayAbbr,homeGoals,awayGoals",
    "ARG,USA,2,0",
    "ARG,MEX,1,1",
    "FRA,ARG,3,2"
  ].join("\n");
  const patches = parseRecentFormSource(csv, "recent-form.csv");
  const byAbbr = new Map(patches.map((patch) => [patch.abbr, patch]));

  assert.equal(patches.length, 4);
  assert.equal(byAbbr.get("ARG").form, -0.004);
  assert.equal(byAbbr.get("ARG").attack, 1.021);
  assert.equal(byAbbr.get("ARG").defense, 0.991);
  assert.equal(byAbbr.get("USA").form, -0.22);
});

test("新闻舆情 adapter 可解析本地 JSON 情绪汇总", () => {
  const patches = parseNewsSentimentSource(
    JSON.stringify({
      news: [
        {
          abbr: "FRA",
          sentiment: 0.7,
          mediaHeat: 0.8,
          risk: 0.1,
          injuryRisk: 0.25,
          name: "法国"
        }
      ]
    }),
    "news.json"
  );

  assert.equal(patches[0].abbr, "FRA");
  assert.equal(patches[0].form, 0.09);
  assert.equal(patches[0].injuries, 0.045);
  assert.equal(patches[0].name, "法国");
});

test("新闻舆情 adapter 可聚合 CSV/TSV 新闻行", () => {
  const csv = [
    "abbr,sentiment,mentions,injuryMentions,mediaHeat,risk",
    "USA,0.6,20,2,0.7,0.2",
    "USA,-0.4,10,3,0.5,0.4",
    "MEX,-0.7,12,0,0.6,0.5"
  ].join("\n");
  const patches = parseNewsSentimentSource(csv, "news.csv");
  const byAbbr = new Map(patches.map((patch) => [patch.abbr, patch]));

  assert.equal(patches.length, 2);
  assert.equal(byAbbr.get("USA").form, -0.002);
  assert.equal(byAbbr.get("USA").injuries, 0.036);
  assert.equal(byAbbr.get("MEX").form, -0.11);
  assert.equal(byAbbr.get("MEX").injuries, 0);
});
