# PJ Stock AI

手機版台股分析原型，GitHub Pages 可直接部署。

## 資料來源

- 上市股：TWSE 官方 `STOCK_DAY`
- 上櫃股：TPEx 官方 `tradingStock`
- 靜態資料位置：`public/pj-stock-ai/data/stocks/*.json`

## 本機使用

```bash
npm install
npm run update:stock-data
npm start
```

開啟：

```text
http://localhost:3000/pj-stock-ai/
```

## GitHub Pages

推到 GitHub 後，到 repository 的 Settings -> Pages，Source 選 GitHub Actions。

工作流程 `.github/workflows/deploy-pj-stock-ai.yml` 會：

1. 抓 TWSE/TPEx 官方資料
2. 產生 `public/pj-stock-ai/data/stocks/*.json`
3. 部署 `public/` 到 GitHub Pages

部署後網址通常會是：

```text
https://你的帳號.github.io/你的repo/pj-stock-ai/
```
