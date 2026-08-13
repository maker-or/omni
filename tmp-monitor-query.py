#!/usr/bin/env python3
import sqlite3
import json
import statistics
from datetime import datetime, timezone

DB = "/Users/harshithpasupuleti/Library/Application Support/pipper-code-alpha/omni.sqlite"

def ts(ms):
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()

def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)

def stats(values):
    if not values:
        return {"n": 0, "avg": None, "p50": None, "p95": None, "max": None, "min": None}
    return {
        "n": len(values),
        "avg": sum(values) / len(values),
        "p50": pct(values, 50),
        "p95": pct(values, 95),
        "max": max(values),
        "min": min(values),
    }

def mb(n):
    if n is None:
        return None
    return n / (1024 * 1024)

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
cur = con.cursor()

print("=== TABLES ===")
for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1"):
    print(r[0])

print("\n=== SCHEMA ===")
for r in cur.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name"):
    print(r[0])
    print()

print("\n=== ALL SESSIONS ===")
sessions = list(cur.execute("SELECT * FROM monitor_sessions ORDER BY started_at DESC"))
for s in sessions:
    d = dict(s)
    started = d["started_at"]
    ended = d["ended_at"]
    dur = None if ended is None else (ended - started)
    print({
        **d,
        "started_iso": ts(started),
        "ended_iso": ts(ended),
        "duration_ms": dur,
        "duration_min": None if dur is None else dur / 60000,
    })
