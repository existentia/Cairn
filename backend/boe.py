"""Bank of England base rate — fetch, fallback and SQLite-backed cache.

The cache lives in the single-row `boe_rate_cache` table rather than in
process memory so that both gunicorn workers (and the dashboard call) see the
same data, and so it survives restarts.

  * A successful live fetch is reused for LIVE_TTL_SECS (the rate changes at
    most eight times a year).
  * After a failed fetch we wait RETRY_SECS before trying again, so a BoE
    outage doesn't add a timeout to every request.
  * If a fetch fails but an earlier live result is stored, that is served
    (flagged `stale`) in preference to the hard-coded history.
  * FALLBACK_CHANGES is the last resort. Add a row whenever Bank Rate moves.
"""

import csv
import http.cookiejar
import io
import json
import sqlite3
import time
import urllib.request
from datetime import datetime

LIVE_TTL_SECS = 24 * 60 * 60
RETRY_SECS = 60 * 60

# Bank Rate change dates (effective date, new rate %).
FALLBACK_CHANGES = [
    ("2000-02-10", 6.00), ("2001-02-08", 5.75), ("2001-04-05", 5.50), ("2001-05-10", 5.25),
    ("2001-08-02", 5.00), ("2001-09-18", 4.75), ("2001-10-04", 4.50), ("2001-11-08", 4.00),
    ("2003-02-06", 3.75), ("2003-07-10", 3.50), ("2003-11-06", 3.75), ("2004-02-05", 4.00),
    ("2004-05-06", 4.25), ("2004-06-10", 4.50), ("2004-08-05", 4.75), ("2005-08-04", 4.50),
    ("2006-08-03", 4.75), ("2006-11-09", 5.00), ("2007-01-11", 5.25), ("2007-05-10", 5.50),
    ("2007-07-05", 5.75), ("2007-12-06", 5.50), ("2008-02-07", 5.25), ("2008-04-10", 5.00),
    ("2008-10-08", 4.50), ("2008-11-06", 3.00), ("2008-12-04", 2.00), ("2009-01-08", 1.50),
    ("2009-02-05", 1.00), ("2009-03-05", 0.50), ("2016-08-04", 0.25), ("2017-11-02", 0.50),
    ("2018-08-02", 0.75), ("2020-03-11", 0.25), ("2020-03-19", 0.10), ("2021-12-16", 0.25),
    ("2022-02-03", 0.50), ("2022-03-17", 0.75), ("2022-05-05", 1.00), ("2022-06-16", 1.25),
    ("2022-08-04", 1.75), ("2022-09-22", 2.25), ("2022-11-03", 3.00), ("2022-12-15", 3.50),
    ("2023-02-02", 4.00), ("2023-03-23", 4.25), ("2023-05-11", 4.50), ("2023-06-22", 5.00),
    ("2023-08-03", 5.25), ("2024-08-01", 5.00), ("2024-11-07", 4.75), ("2025-02-06", 4.50),
    ("2025-05-08", 4.25), ("2025-08-07", 4.00), ("2025-12-18", 3.75), ("2026-11-05", 4.00),
]


def build_result(changes, now_dt, **extra):
    """Shape a sorted list of {"date", "rate"} changes into the API payload:
    current rate, a month-by-month series, and the 20 most recent changes."""
    changes = sorted(changes, key=lambda c: c["date"])
    monthly = []
    idx = 0
    current = changes[0]["rate"]
    for year in range(int(changes[0]["date"][:4]), now_dt.year + 1):
        for month in range(1, 13):
            if year == now_dt.year and month > now_dt.month:
                break
            month_start = f"{year}-{month:02d}-01"
            while idx < len(changes) - 1 and changes[idx + 1]["date"] <= month_start:
                idx += 1
                current = changes[idx]["rate"]
            monthly.append({"date": month_start, "rate": current})
    return {
        "current_rate": changes[-1]["rate"],
        "current_date": changes[-1]["date"],
        "history": monthly,
        "changes": changes[-20:],
        **extra,
    }


def fallback_result(now_dt, error=""):
    changes = [{"date": d, "rate": r} for d, r in FALLBACK_CHANGES]
    return build_result(changes, now_dt, fallback=True, fetch_error=error)


def fetch_live(now_dt):
    """Fetch the daily Bank Rate series (IUDBEDR) from the BoE statistical
    database. Returns a list of {"date", "rate"}; raises on any failure."""
    # BoE requires cookies — use a cookie-enabled opener
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,text/csv,text/plain,*/*",
    }

    # Step 1: hit the main database page to establish a session and get cookies
    opener.open(urllib.request.Request(
        "https://www.bankofengland.co.uk/boeapps/database/", headers=headers,
    ), timeout=10)

    # Step 2: fetch the CSV using the documented endpoint
    csv_url = (
        "https://www.bankofengland.co.uk/boeapps/database/"
        "_iadb-fromshowcolumns.asp?csv.x=yes"
        f"&Datefrom=01/Jan/2000&Dateto={now_dt.strftime('%d/%b/%Y')}"
        "&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N"
    )
    with opener.open(urllib.request.Request(csv_url, headers=headers), timeout=15) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    # HTML instead of CSV means the cookie session / redirect failed
    if "<!DOCTYPE" in raw[:100] or "<html" in raw[:100].lower():
        raise ValueError("BoE returned HTML instead of CSV — cookie session may have failed")

    rates = []
    for row in csv.reader(io.StringIO(raw)):
        if len(row) >= 2:
            try:
                d = datetime.strptime(row[0].strip(), "%d %b %Y")
                rates.append({"date": d.strftime("%Y-%m-%d"), "rate": float(row[1].strip())})
            except (ValueError, TypeError):
                continue
    if not rates:
        raise ValueError("No rate data parsed from BoE CSV response")
    return rates


def _read_row(db):
    try:
        return db.execute(
            "SELECT payload, is_fallback, fetched_at, last_attempt FROM boe_rate_cache WHERE id = 1"
        ).fetchone()
    except sqlite3.OperationalError:  # table not migrated yet
        return None


def _write_row(db, payload, is_fallback, fetched_at, last_attempt):
    db.execute(
        "INSERT OR REPLACE INTO boe_rate_cache (id, payload, is_fallback, fetched_at, last_attempt)"
        " VALUES (1, ?, ?, ?, ?)",
        (json.dumps(payload), 1 if is_fallback else 0, fetched_at, last_attempt),
    )
    db.commit()


def get_rates(db, now=None, fetch=None):
    """Return the rate payload, fetching from the BoE only when the cache is
    out of date and we haven't tried recently. `now` (epoch seconds) and
    `fetch` are injectable for tests."""
    now = time.time() if now is None else now
    fetch = fetch or fetch_live
    now_dt = datetime.fromtimestamp(now)

    row = _read_row(db)
    cached = json.loads(row[0]) if row else None
    is_fallback = bool(row[1]) if row else False
    fresh = bool(row) and not is_fallback and now - row[2] < LIVE_TTL_SECS
    tried_recently = bool(row) and now - row[3] < RETRY_SECS

    if fresh or tried_recently:
        return cached if fresh or is_fallback else {**cached, "stale": True}

    try:
        result = build_result(fetch(now_dt), now_dt)
    except Exception as e:  # network, parsing, anything — degrade, never 500
        if cached and not is_fallback:
            # Keep the last good live data; just note that we tried.
            db.execute("UPDATE boe_rate_cache SET last_attempt = ? WHERE id = 1", (now,))
            db.commit()
            return {**cached, "stale": True, "fetch_error": str(e)}
        result = fallback_result(now_dt, str(e))
        _write_row(db, result, True, now, now)
        return result

    _write_row(db, result, False, now, now)
    return result


def cached_current_rate(db):
    """Current rate from the cache without touching the network (or None).
    Used by the dashboard call, which must stay fast."""
    row = _read_row(db)
    if not row:
        return None
    try:
        return json.loads(row[0]).get("current_rate")
    except (ValueError, TypeError):
        return None
