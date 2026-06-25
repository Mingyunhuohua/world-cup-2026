import { pathToFileURL } from "node:url";
import { readValue, writeAdapterOutput } from "./core.mjs";
import { fifaFixturesAdapter, runFifaFixturesAdapter } from "./fifa-fixtures.mjs";
import { fifaRankingsAdapter, runFifaRankingsAdapter } from "./fifa-rankings.mjs";
import { injuriesNewsAdapter, runInjuriesNewsAdapter } from "./injuries-news.mjs";
import { matchResultsAdapter, runMatchResultsAdapter } from "./match-results.mjs";
import { newsSentimentAdapter, runNewsSentimentAdapter } from "./news-sentiment.mjs";
import { oddsMarketAdapter, runOddsMarketAdapter } from "./odds-market.mjs";
import { recentFormAdapter, runRecentFormAdapter } from "./recent-form.mjs";

const usage = `Usage:
  npm run data:adapter -- --list
  npm run data:adapter -- --adapter fifa-fixtures --print
  npm run data:adapter -- --adapter fifa-fixtures --file C:/tmp/fixtures.html --out C:/tmp/fixtures-import.json
  npm run data:adapter -- --adapter fifa-rankings --out C:/tmp/rankings-import.json
  npm run data:adapter -- --adapter news-sentiment --file C:/tmp/news.csv --out C:/tmp/news-import.json
  npm run data:adapter -- --adapter recent-form --file C:/tmp/recent-form.csv --out C:/tmp/recent-form-import.json

Adapters:
  fifa-fixtures
  fifa-rankings
  injuries-news
  match-results
  news-sentiment
  odds-market
  recent-form
`;

export const adapterRegistry = [
  { ...fifaFixturesAdapter, run: runFifaFixturesAdapter },
  { ...fifaRankingsAdapter, run: runFifaRankingsAdapter },
  { ...injuriesNewsAdapter, run: runInjuriesNewsAdapter },
  { ...matchResultsAdapter, run: runMatchResultsAdapter },
  { ...newsSentimentAdapter, run: runNewsSentimentAdapter },
  { ...oddsMarketAdapter, run: runOddsMarketAdapter },
  { ...recentFormAdapter, run: runRecentFormAdapter }
];

export function parseAdapterArgs(argv) {
  const options = {
    adapter: undefined,
    file: undefined,
    out: undefined,
    print: false,
    list: false,
    live: false,
    generatedAt: undefined,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--adapter") {
      options.adapter = readValue(argv, index, "--adapter");
      index += 1;
      continue;
    }

    if (arg === "--file") {
      options.file = readValue(argv, index, "--file");
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.out = readValue(argv, index, "--out");
      index += 1;
      continue;
    }

    if (arg === "--generated-at") {
      options.generatedAt = readValue(argv, index, "--generated-at");
      index += 1;
      continue;
    }

    if (arg === "--print") {
      options.print = true;
      continue;
    }

    if (arg === "--live") {
      options.live = true;
      continue;
    }

    if (arg === "--list") {
      options.list = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.help && !options.list && !options.adapter) {
    throw new Error("Pass --adapter or --list.");
  }

  if (!options.help && !options.list && !options.print && !options.out) {
    throw new Error("Pass --out or --print.");
  }

  return options;
}

export function listAdapters() {
  return adapterRegistry.map(({ run: _run, ...adapter }) => adapter);
}

export async function runAdapter(adapterId, options = {}) {
  const adapter = adapterRegistry.find((item) => item.id === adapterId);

  if (!adapter) {
    throw new Error(`Unknown adapter: ${adapterId}`);
  }

  return adapter.run(options);
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseAdapterArgs(argv);

  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }

  if (options.list) {
    await writeAdapterOutput({ adapters: listAdapters() }, { print: true });
    return;
  }

  const payload = await runAdapter(options.adapter, {
    file: options.file,
    generatedAt: options.generatedAt,
    live: options.live
  });

  await writeAdapterOutput(payload, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`${usage}\n`);
    process.exitCode = 1;
  });
}
