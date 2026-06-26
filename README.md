# PJ Stock AI

手機版台股分析工具，可部署到 GitHub Pages。

## 使用方式

GitHub Pages 網址：

```text
https://你的帳號.github.io/你的repo/pj-stock-ai/
```

## 資料來源

- 上市股：TWSE 官方 `STOCK_DAY`
- 上櫃股：TPEx 官方 `tradingStock`
- 靜態資料：`public/pj-stock-ai/data/stocks/*.json`

## 更新資料

```bash
npm run update:stock-data
```

## GitHub Pages 部署

1. 把這個資料夾推到 GitHub repo
2. 到 GitHub repo 的 `Settings -> Pages`
3. Source 選 `GitHub Actions`
4. 執行 `Deploy PJ Stock AI` workflow

Workflow 會抓官方資料、產生 JSON，然後部署 `public/` 到 GitHub Pages。
