# RFQ Radar

A fast way for a DLA vendor to answer one question about each DIBBS solicitation: **should I bid on this?**

DIBBS posts ~2,000 new RFQ lines a day, and roughly 44,000 solicitations are live across a month.
Most are irrelevant to any given vendor. RFQ Radar pulls the daily DIBBS files, rolls them up to one
row per solicitation, and runs every RFQ through the first three bid/no-bid gates. What's left is
the short list worth a human's time. Every row links back to its DIBBS record, quote form, and PDF.

```bash
node server.mjs          # Node 20+. No npm install, no dependencies.
# open http://localhost:3000   (first run downloads ~1 month of files from DIBBS)
```

`OFFLINE=1 node server.mjs` serves whatever is already in `./data` without calling DIBBS.

### Deploy (DigitalOcean droplet)

One long-running process with a disk, so a small VM fits better than serverless. On a fresh
Ubuntu droplet, as root:

```bash
curl -fsSLO https://raw.githubusercontent.com/YOU/REPO/main/deploy/setup.sh
bash setup.sh https://github.com/YOU/REPO.git
```

That installs Node 22, runs the app under systemd, and serves it over HTTPS at
`https://<droplet-ip-with-dashes>.sslip.io` via Caddy (no domain needed). It then checks
whether DIBBS accepts requests from the droplet's IP. If DIBBS blocks it, the script prints the
one-line `scp` to upload a locally downloaded `data/` folder instead.

## The idea: bid/no-bid gates

A bid specialist's triage is a sequence of yes/no questions. The app makes the first three automatic:

| Gate | Question | Data needed | Source |
|---|---|---|---|
| 1 | **Can I still bid?** | Return-by date | RFQ |
| 2 | **Am I allowed to?** | Set-aside type + my certifications | RFQ + my profile |
| 3 | **Can I get the part?** | Approved sources (CAGE) for the NSN + suppliers I buy from, or a product class (FSC) I deal in | RFQ + DLA approved-source file + my profile |
| 4 | **Is it worth it? Who's at the table?** | Past awards for the NSN (winners, prices, frequency) + my cost | DIBBS award search, on demand + my input |
| 5 | Can I deliver in time? | Required delivery, supplier lead time | *Not built yet* |

### Gate 4: reading the table

You can't see competing bids (quotes are sealed), but you can see who has been winning. When you
open an RFQ, the app pulls that NSN's award history from DIBBS (about 4 months; cached 12 h) and
reads the table:

- **Heat:** *sticky incumbent* (one company won every recent award), *crowded* (4+ different
  winners, or nobody above 50%), *contested*, *thin* (one award), or *unknown* (no history).
- **Winners** with their share, flagged if they're an approved source or one of your suppliers.
- **Price anchor:** award totals are per contract, so unit price is only known when we also hold
  that solicitation's RFQ file (quantity). The median of those is the anchor. Otherwise totals only.
- **Your price check:** enter your supplier cost and markup to see profit if you win, a *rough*
  expected value (baseline win chance = 1 / (recent winners + you), labeled as a placeholder until
  calibrated on real outcomes), and warnings:
  - priced above recent winners → likely to lose;
  - cost above what DLA paid → this table is priced below your supply chain;
  - **winner's-curse check:** 30%+ under recent winners → read the PDF for first article, packaging,
    inspection and spec before quoting. Cheap wins are where adverse selection hides.

The heat labels are rules of thumb from award counts, not predictions, and the UI says so.

The top of the page is a **funnel**: All RFQs → still open → eligible → I can source it. Each step
shows its count and is clickable. The detail panel shows a **gate checklist** for the selected RFQ:
✓ / ✕ / ? with the reason, including which of your suppliers is an approved source and the part
numbers to ask them for.

The **profile** (certifications, supplier CAGEs, product classes) is set once and stored in the
browser. "Try a sample" fills it from the suppliers and classes most common in open RFQs, for demos.

## How the data is pulled

**Bulk daily files, not page scraping.** DIBBS publishes each day's RFQs as files. Everything below
was verified against live DIBBS.

| File | Contents | Used for |
|---|---|---|
| `inYYMMDD.txt` | Fixed-width, 140 chars/line, Latin-1: solicitation, NSN, PR, return-by, qty, unit, nomenclature, buyer, AMSC, item type, set-aside | Everything |
| `bqYYMMDD.zip` → `as*.txt` | Approved sources: NSN, CAGE, part number | Gate 3 |
| `caYYMMDD.zip` | Every PDF for the day (large) | Not downloaded. Rows link to the single PDF |

Things found while probing DIBBS:

1. **A DoD consent page on each of two hosts.** `www.dibbs.bsm.dla.mil` (app) and `dibbs2.bsm.dla.mil`
   (files) each need their own consent. Unconsented requests return **HTTP 200 with the consent page**,
   so the status code can't be trusted. The client detects the page by content, posts the ASP.NET form,
   and keeps a cookie jar per host (including the firewall's `TS…` cookies).
2. **Plain `fetch` works.** A public write-up claimed the F5 firewall blocks Node `fetch`. Tested from
   a home network: it doesn't.
3. **Once consented, missing files are a clean 404.** The file list comes from the Recent RFQs page, not
   the calendar. Sunday files exist; Saturdays don't. The newest file lags ~1–2 days.
4. **A file's date is its post date, not the issue date.** The UI says "posted."
5. **Amendments re-post lines.** ~10% of (solicitation, PR) pairs reappear in a later file, 95% of them
   with a later return-by. Ingest upserts on (solicitation, PR), newest file wins, and keeps the earlier
   date so the UI can flag "deadline extended."
6. **Nomenclature is cut at 21 characters** in the file. The detail panel says so and links the PDF.

## Data model

- Raw files are cached in `./data` as published (append-only; files never change once posted).
- On load they're parsed into **lines** keyed by (solicitation, PR), then rolled up to **one row per
  solicitation**. Only 4.6% have more than one line, almost always the same NSN split across purchase
  requests, so showing lines would mostly show duplicates.
- **In memory, no database.** A month is ~50k lines / ~44k solicitations (9 MB of raw files). It
  loads in under a second, and a full scan with gates and every facet count takes under 100 ms. A database would add an install step (and native-module risk
  on Windows) and buy nothing at this size. If history grew to years, SQLite with FTS would be next.

## Filters, and why

| Filter | Why |
|---|---|
| Gates 1–3 (funnel) | The three questions that decide whether an RFQ is worth reading. ~72% of a month's RFQs are already closed, so gate 1 alone removes most of the noise |
| Closing within 3 days | Median posting-to-deadline window is 8 days. 39% of open RFQs close within 3 |
| New in latest file | "What's new since yesterday?" Uses *first*-posted, so amendments don't look new |
| Deadline extended | A re-posted RFQ with a later deadline: a second chance to quote |
| Product class (FSC) | Vendors specialize by product class. Searchable, with names |
| Set-aside | Gate 2 applies it from the profile. This is for looking at one type |
| Quantity | Very skewed (median 8, top 1% over 4,600): screens by capacity |
| Buying office | From the solicitation prefix (Aviation, Land & Maritime, Medical…) |

Every option shows how many results you'd get if you picked it, computed with all *other* filters
applied. All view state is in the URL, so any view can be bookmarked or shared.

**Search** covers item name, product-class name, solicitation #, NSN / NIIN, PR #, approved-source
CAGEs and part numbers. Punctuation is ignored (`8415-01-677-9240` = `8415016779240`). Commas or
newlines mean "any of", so you can paste a list of NSNs you stock. Keyboard: `/` to search, `Esc` to close.

## What's deliberately not here

- **Gate 5.** Required delivery days are likely in the batch-quote file (unverified) and supplier
  lead times only the user knows. The checklist marks it "?" and says what's missing.
- **A calibrated win model.** The EV baseline is deliberately naive. The right model comes from the
  user's own bid/win/loss history.
- Accounts (the profile is per browser), deployment, SAM.gov/NECO, PDF parsing.

## Next

1. **Show table heat in the list:** prefetch award history for the gate-3 shortlist in the background,
   so "crowded / incumbent / thin" becomes a sortable column, not just a detail-panel read.
2. **Keep the daily files forever** so more past awards get a known quantity (true unit prices).
3. **Offers received per award** from FPDS/USAspending (the literal field size), if DLA's small
   DIBBS awards are reported there.
4. **Gate 5:** required delivery days (likely in the `bq` batch-quote file; unverified) + per-supplier
   lead times the user records once.
3. Learn from behavior: which RFQs the user opens, bids, wins, and loses.

## Layout

```
server.mjs        HTTP server, sync on start + hourly
lib/dibbs.mjs     DIBBS client: consent handling, cookies per host, links
lib/ingest.mjs    download new daily files into ./data
lib/parse.mjs     fixed-width + CSV parsers, tiny zip reader
lib/store.mjs     build in-memory solicitations (upsert, rollup, approved sources)
lib/query.mjs     gates, search, filters, facet counts
lib/awards.mjs    gate 4: award history per NSN, table read
lib/labels.mjs    set-aside, FSC and office names
public/           vanilla JS + CSS frontend
```
