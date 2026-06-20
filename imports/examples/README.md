# 真实数据导入模板

这个目录放给 `data:adapter` 和 `data:compose` 使用的本地 CSV/JSON 示例。第一版不会自动联网抓取，建议每天把真实数据整理到这些模板里，再生成一个可导入网页的数据包。

## 推荐日常流程

1. 用真实来源更新本目录里的 CSV/JSON。
2. 运行组合命令生成导入包。
3. 打开网页的数据更新中心，上传或粘贴生成的 JSON。
4. 先看“导入预检”和“模型影响预估”，确认后再应用。

```powershell
npm.cmd run data:compose -- `
  --source fifa-fixtures=imports/examples/fifa-fixtures.json `
  --source fifa-rankings=imports/examples/fifa-rankings.csv `
  --source injuries-news=imports/examples/injuries-news.csv `
  --source odds-market=imports/examples/odds-market.csv `
  --source recent-form=imports/examples/recent-form.csv `
  --source news-sentiment=imports/examples/news-sentiment.csv `
  --label "Daily verified import" `
  --out imports/generated/worldcup-2026-daily-import.json
```

如果只想检查输出内容、不写文件，把最后一行改成 `--print`。

## 文件说明

- `fifa-fixtures.json`：赛程、赛果、场地、比赛状态。`id` 必须匹配当前快照里的比赛 ID。
- `fifa-rankings.csv`：球队排名、ELO、攻防和基础状态。`id` 或 `abbr` 至少填一个。
- `injuries-news.csv`：球队级伤停负荷。`injuries` 建议用 `0` 到 `0.22` 左右的小数，越高代表伤停越重。
- `odds-market.csv`：赔率或隐含概率。可填 `championOdds`，脚本会折算为球队状态信号。
- `recent-form.csv`：近期战绩。可填 `lastResults`，例如 `WWDLW`，也可填胜平负、进失球。
- `news-sentiment.csv`：新闻情绪、舆论热度、风险、伤停提及。数值一般用 `-1..1` 或 `0..1`。

## 字段约定

- 球队 ID 使用当前项目里的小写 ID，例如 `arg`、`fra`、`mex`、`usa`。
- 缩写使用三位大写，例如 `ARG`、`FRA`、`MEX`、`USA`。
- CSV 第一行必须是表头。
- 可以只更新部分球队；导入时会和当前快照合并。
- 多个来源同时给出 `form`、`injuries`、`attack`、`defense` 时，组合脚本会对这些动态数值取平均。

## 单独验证某个模板

```powershell
npm.cmd run data:adapter -- --adapter fifa-rankings --file imports/examples/fifa-rankings.csv --print
npm.cmd run data:adapter -- --adapter injuries-news --file imports/examples/injuries-news.csv --print
npm.cmd run data:adapter -- --adapter odds-market --file imports/examples/odds-market.csv --print
npm.cmd run data:adapter -- --adapter recent-form --file imports/examples/recent-form.csv --print
npm.cmd run data:adapter -- --adapter news-sentiment --file imports/examples/news-sentiment.csv --print
```

## 注意

这些模板里的数值是格式示例，不代表真实预测意见。正式使用前需要替换为当天核验后的真实数据，并保留来源、时间和人工判断依据。
