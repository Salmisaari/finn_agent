"""
Daily commodity price fetcher → BigQuery
Fetches Brent crude (EIA API), 1,3-Butadiene (SunSirs), and
WTI prediction market probabilities (Polymarket) daily.

Table: data-warehouse-365114.data_finance.commodity_prices

Local usage: python3 scripts/commodity_prices.py
Cloud Run: uses default service account credentials
"""

import os
import re
import json
import logging
import subprocess
from datetime import datetime, timezone
import urllib.request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ID = "data-warehouse-365114"
TABLE_REF = f"{PROJECT_ID}.data_finance.oil_commodities"

EIA_API_KEY = os.environ.get("EIA_API_KEY", "")


def fetch_brent() -> dict | None:
    """Fetch latest Brent crude spot price from EIA API."""
    url = (
        f"https://api.eia.gov/v2/petroleum/pri/spt/data/"
        f"?api_key={EIA_API_KEY}"
        f"&frequency=daily"
        f"&data[0]=value"
        f"&facets[series][]=RBRTE"
        f"&sort[0][column]=period&sort[0][direction]=desc"
        f"&length=1"
    )
    try:
        response = urllib.request.urlopen(url, timeout=15)
        data = json.loads(response.read().decode("utf-8"))
        record = data["response"]["data"][0]
        return {
            "date": record["period"],
            "commodity": "brent_crude",
            "price": float(record["value"]),
            "currency": "USD/bbl",
            "source": "EIA_RBRTE",
        }
    except Exception as e:
        logger.error(f"Brent fetch failed: {e}")
        return None


def fetch_butadiene() -> dict | None:
    """Fetch latest 1,3-Butadiene price from SunSirs (China spot, RMB/ton)."""
    url = "https://www.sunsirs.com/uk/prodetail-886.html"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
    })
    try:
        response = urllib.request.urlopen(req, timeout=15)
        html = response.read().decode("utf-8")

        # Extract date and price from the table
        # SunSirs format: <td>price</td><td>date</td>
        matches = re.findall(
            r"<td>([\d,.]+)</td>\s*<td>(\d{4}-\d{2}-\d{2})</td>",
            html,
        )
        if matches:
            price_str, date_str = matches[0]  # most recent row
            price = float(price_str.replace(",", ""))
            if 5000 < price < 50000:
                return {
                    "date": date_str,
                    "commodity": "butadiene_1_3",
                    "price": price,
                    "currency": "RMB/ton",
                    "source": "sunsirs_886",
                }

        # Fallback: look for large numbers (butadiene is 8,000-20,000 range)
        prices = re.findall(r"(\d{1,3}(?:,\d{3})*\.\d{2})", html)
        if prices:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            price = float(prices[0].replace(",", ""))
            if 5000 < price < 50000:
                return {
                    "date": today,
                    "commodity": "butadiene_1_3",
                    "price": price,
                    "currency": "RMB/ton",
                    "source": "sunsirs_886",
                }

        logger.warning(f"Butadiene: no price found in HTML ({len(html)} bytes)")
        return None
    except Exception as e:
        logger.error(f"Butadiene fetch failed: {e}")
        return None


def fetch_drewry_freight() -> list[dict]:
    """Fetch weekly container freight rates from Drewry WCI page."""
    url = "https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html",
    })
    try:
        response = urllib.request.urlopen(req, timeout=15)
        html = response.read().decode("utf-8")

        results = []
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Look for route rates: "$X,XXX" pattern near route names
        routes = {
            "Rotterdam": "freight_sha_rtm",
            "Genoa": "freight_sha_genoa",
        }

        for route_name, commodity_key in routes.items():
            # Pattern: route name near a dollar amount
            pattern = rf"{route_name}[^$]*?\$([\d,]+)"
            match = re.search(pattern, html)
            if match:
                price = float(match.group(1).replace(",", ""))
                if 500 < price < 20000:
                    results.append({
                        "date": today,
                        "commodity": commodity_key,
                        "price": price,
                        "currency": "USD/FEU",
                        "source": "drewry_wci",
                    })

        # WCI composite
        composite_match = re.search(r"World Container Index[^$]*?\$([\d,]+)", html)
        if composite_match:
            price = float(composite_match.group(1).replace(",", ""))
            if 500 < price < 20000:
                results.append({
                    "date": today,
                    "commodity": "freight_wci_composite",
                    "price": price,
                    "currency": "USD/FEU",
                    "source": "drewry_wci",
                })

        logger.info(f"Drewry WCI: fetched {len(results)} freight rates")
        return results
    except Exception as e:
        logger.error(f"Drewry fetch failed: {e}")
        return []


POLYMARKET_EVENTS = [
    ("what-price-will-wti-hit-in-april-2026", "wti_apr"),
    ("cl-hit-jun-2026", "cl_jun"),
]

POLYMARKET_SINGLE_MARKETS = [
    ("strait-of-hormuz-traffic-returns-to-normal-by-april-30", "hormuz_normal_apr"),
    ("strait-of-hormuz-traffic-returns-to-normal-by-end-of-may", "hormuz_normal_may"),
    ("bab-el-mandeb-strait-effectively-closed-by", "bab_el_mandeb_closed"),
]

TRACK_LEVELS = {"120", "130", "140", "150", "160", "80"}


def fetch_polymarket_wti() -> list[dict]:
    """Fetch WTI crude oil prediction market probabilities from Polymarket."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    results = []

    for slug, prefix in POLYMARKET_EVENTS:
        url = f"https://gamma-api.polymarket.com/events?slug={slug}"
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        })
        try:
            response = urllib.request.urlopen(req, timeout=15)
            data = json.loads(response.read().decode("utf-8"))
            if not data:
                logger.warning(f"Polymarket: empty response for {slug}")
                continue

            event = data[0]
            markets = event.get("markets", [])

            for market in markets:
                if market.get("closed"):
                    continue
                question = market.get("question", "")
                prices = market.get("outcomePrices", "")

                if not prices:
                    continue

                try:
                    price_list = json.loads(prices) if isinstance(prices, str) else prices
                except (json.JSONDecodeError, TypeError):
                    continue

                yes_prob = round(float(price_list[0]) * 100, 1)

                dollar_match = re.search(r"\$(\d+)", question)
                if not dollar_match:
                    continue
                level = dollar_match.group(1)

                if level not in TRACK_LEVELS:
                    continue

                direction = "dip_" if "(LOW)" in question else ""
                commodity_key = f"{prefix}_polymarket_{direction}{level}"

                results.append({
                    "date": today,
                    "commodity": commodity_key,
                    "price": yes_prob,
                    "currency": "probability_%",
                    "source": f"polymarket_{market.get('id', '')}",
                })

        except Exception as e:
            logger.error(f"Polymarket fetch failed for {slug}: {e}")

    # Fetch single-market events (straits)
    for slug, prefix in POLYMARKET_SINGLE_MARKETS:
        url = f"https://gamma-api.polymarket.com/events?slug={slug}"
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        })
        try:
            response = urllib.request.urlopen(req, timeout=15)
            data = json.loads(response.read().decode("utf-8"))
            if not data:
                continue

            event = data[0]
            for market in event.get("markets", []):
                if market.get("closed"):
                    continue
                prices = market.get("outcomePrices", "")
                if not prices:
                    continue
                try:
                    price_list = json.loads(prices) if isinstance(prices, str) else prices
                except (json.JSONDecodeError, TypeError):
                    continue

                yes_prob = round(float(price_list[0]) * 100, 1)
                question = market.get("question", "")

                # For multi-market events (Bab el-Mandeb), include the timeframe
                date_match = re.search(r"(April|May|June|March)\s*\d*\??", question)
                suffix = f"_{date_match.group(0).strip('?').strip().lower().replace(' ', '_')}" if date_match else ""

                commodity_key = f"{prefix}{suffix}"

                results.append({
                    "date": today,
                    "commodity": commodity_key,
                    "price": yes_prob,
                    "currency": "probability_%",
                    "source": f"polymarket_{market.get('id', '')}",
                })
        except Exception as e:
            logger.error(f"Polymarket fetch failed for {slug}: {e}")

    logger.info(f"Polymarket: fetched {len(results)} probability levels")
    return results


def insert_via_bq_cli(record: dict):
    """Insert a price record using bq CLI (works with local gcloud auth)."""
    # Check if already exists
    check_sql = (
        f"SELECT COUNT(*) as cnt FROM `{TABLE_REF}` "
        f"WHERE date = '{record['date']}' AND commodity = '{record['commodity']}'"
    )
    result = subprocess.run(
        ["bq", "query", "--use_legacy_sql=false", "--format=json", check_sql],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        rows = json.loads(result.stdout)
        if rows and int(rows[0].get("cnt", 0)) > 0:
            logger.info(f"Skipping {record['commodity']} {record['date']} — already exists")
            return

    # Insert
    insert_sql = (
        f"INSERT INTO `{TABLE_REF}` (date, commodity, price, currency, source, _synced_at) "
        f"VALUES ('{record['date']}', '{record['commodity']}', {record['price']}, "
        f"'{record['currency']}', '{record['source']}', CURRENT_TIMESTAMP())"
    )
    result = subprocess.run(
        ["bq", "query", "--use_legacy_sql=false", insert_sql],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        logger.info(f"Inserted {record['commodity']} {record['date']}: {record['price']} {record['currency']}")
    else:
        logger.error(f"Insert failed: {result.stderr}")


def insert_via_client(record: dict):
    """Insert using BigQuery Python client (for Cloud Run)."""
    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT_ID)

    check_query = (
        f"SELECT COUNT(*) as cnt FROM `{TABLE_REF}` "
        f"WHERE date = '{record['date']}' AND commodity = '{record['commodity']}'"
    )
    result = list(client.query(check_query).result())
    if result[0].cnt > 0:
        logger.info(f"Skipping {record['commodity']} {record['date']} — already exists")
        return

    row = {
        "date": record["date"],
        "commodity": record["commodity"],
        "price": record["price"],
        "currency": record["currency"],
        "source": record["source"],
        "_synced_at": datetime.now(timezone.utc).isoformat(),
    }
    errors = client.insert_rows_json(TABLE_REF, [row])
    if errors:
        logger.error(f"Insert failed: {errors}")
    else:
        logger.info(f"Inserted {record['commodity']} {record['date']}: {record['price']} {record['currency']}")


def main():
    # Use bq CLI locally, BigQuery client in Cloud Run
    use_cli = os.environ.get("USE_BQ_CLI", "1") == "1"
    insert = insert_via_bq_cli if use_cli else insert_via_client

    brent = fetch_brent()
    butadiene = fetch_butadiene()

    if brent:
        insert(brent)
    else:
        logger.warning("No Brent data fetched")

    if butadiene:
        insert(butadiene)
    else:
        logger.warning("No Butadiene data fetched")

    freight = fetch_drewry_freight()
    for fr in freight:
        insert(fr)
    if not freight:
        logger.warning("No freight data fetched")

    polymarket = fetch_polymarket_wti()
    for pm in polymarket:
        insert(pm)
    if not polymarket:
        logger.warning("No Polymarket data fetched")

    logger.info("Done")


if __name__ == "__main__":
    main()
