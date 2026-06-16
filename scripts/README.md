# ITF Tournament Scraper

Fetches the ITF Men's World Tennis Tour calendar daily, extracts tournament data via Claude, and saves it to InstantDB.

## How it works

1. GitHub Actions runs the job every day at 6am UTC
2. `scrape-itf.js` fetches the ITF calendar page
3. The HTML is sent to Claude (`claude-sonnet-4-6`) which extracts all tournaments as JSON
4. New tournaments are inserted into InstantDB (duplicates, matched by name + start date, are skipped)

## Setting up GitHub Secrets

Go to your repository on GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add these two secrets:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (from [console.anthropic.com](https://console.anthropic.com)) |
| `INSTANTDB_APP_ID` | `f819fcd1-f0da-4658-ac5c-a190539808f6` |

## Running manually

You can trigger the workflow at any time from GitHub → **Actions** → **ITF Tournament Scraper** → **Run workflow**.

## Running locally

```bash
ANTHROPIC_API_KEY=sk-ant-... INSTANTDB_APP_ID=f819fcd1-f0da-4658-ac5c-a190539808f6 node scripts/scrape-itf.js
```
