#!/usr/bin/env python3
"""Read-only monitor DB report. Prints every number as text."""
from __future__ import annotations

import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SRC = Path.home() / "Library/Application Support/pipper-code-alpha/omni.sqlite"
DST = Path("/tmp/omni-monitor.sqlite")

if not DST.exists() or DST.stat().st_mtime < SRC.stat().st_mtime:
    DST.write_bytes(SRC.read_bytes())

DB = str(DST)


def iso(ms):
    if ms is None:
        return "NULL"
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def num(v, digits=6):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return str(v)
        # keep integer-valued floats readable, else full precision text
        if v == int(v) and abs(v) < 1e15:
            return str(int(v)) if abs(v) >= 1 else format(v, ".10g")
        return format(v, ".10g")
    return str(v)


def avg(xs):
    return (sum(xs) / len(xs)) if xs else None


def pct(xs, p):
    if not xs:
        return None
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * (p / 100.0)
    f = int(math.floor(k))
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def print_kv(title, d):
    print(f"--- {title} ---")
    for k, v in d.items():
        print(f"{k}: {num(v) if isinstance(v, (int, float, type(None))) else v}")
    print()


con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
cur = con.cursor()

print("DB_PATH: " + DB)
print("SRC_PATH: " + str(SRC))
print("SRC_BYTES: " + str(SRC.stat().st_size))
print("DST_BYTES: " + str(DST.stat().st_size))
print()

print("========== 1) LAST 20 MONITOR SESSIONS ==========")
rows = list(
    cur.execute(
        """
        SELECT id, label, started_at, ended_at,
               CASE WHEN ended_at IS NULL THEN NULL ELSE (ended_at - started_at) / 1000.0 END AS duration_s
        FROM monitor_sessions
        ORDER BY started_at DESC
        LIMIT 20
        """
    )
)
print("row_count: " + str(len(rows)))
for i, r in enumerate(rows, 1):
    print(
        f"[{i}] id={r['id']} label={r['label']!r} started_at={num(r['started_at'])} "
        f"started_iso={iso(r['started_at'])} ended_at={num(r['ended_at'])} "
        f"ended_iso={iso(r['ended_at'])} duration_s={num(r['duration_s'])}"
    )

print()
print("========== 2) COMPLETED RECORDINGS NEAR 6min AND 27-28min ==========")
completed = list(
    cur.execute(
        """
        SELECT id, label, started_at, ended_at,
               (ended_at - started_at) / 1000.0 AS duration_s,
               (ended_at - started_at) / 60000.0 AS duration_min
        FROM monitor_sessions
        WHERE ended_at IS NOT NULL
        ORDER BY started_at DESC
        """
    )
)
print("completed_count: " + str(len(completed)))
for i, r in enumerate(completed, 1):
    print(
        f"completed[{i}] id={r['id']} label={r['label']!r} started_at={num(r['started_at'])} "
        f"started_iso={iso(r['started_at'])} ended_at={num(r['ended_at'])} "
        f"ended_iso={iso(r['ended_at'])} duration_s={num(r['duration_s'])} "
        f"duration_min={num(r['duration_min'])}"
    )

# Prefer latest matches in the requested bands.
band_6 = [r for r in completed if 5.0 <= r["duration_min"] <= 7.5]
band_27 = [r for r in completed if 26.0 <= r["duration_min"] <= 29.5]
print("band_6min_candidates: " + str(len(band_6)))
print("band_27min_candidates: " + str(len(band_27)))
for r in band_6:
    print(
        f"cand_6 id={r['id']} duration_s={num(r['duration_s'])} duration_min={num(r['duration_min'])} "
        f"started_iso={iso(r['started_at'])}"
    )
for r in band_27:
    print(
        f"cand_27 id={r['id']} duration_s={num(r['duration_s'])} duration_min={num(r['duration_min'])} "
        f"started_iso={iso(r['started_at'])}"
    )

chosen = []
if band_6:
    chosen.append(("~6min", band_6[0]))
if band_27:
    chosen.append(("~27-28min", band_27[0]))

# If bands empty, still pick closest completed to 6min and 27.5min among latest.
if len(chosen) < 2 and completed:
    def closest(target_min):
        return min(completed, key=lambda r: abs(r["duration_min"] - target_min))

    if not band_6:
        chosen.append(("closest_to_6min", closest(6.0)))
    if not band_27:
        chosen.append(("closest_to_27_5min", closest(27.5)))

# de-dupe by id preserving order
seen = set()
sessions = []
for tag, r in chosen:
    if r["id"] in seen:
        continue
    seen.add(r["id"])
    sessions.append((tag, r))

print("selected_count: " + str(len(sessions)))
for tag, r in sessions:
    print(
        f"SELECTED tag={tag} id={r['id']} label={r['label']!r} "
        f"started_at={num(r['started_at'])} started_iso={iso(r['started_at'])} "
        f"ended_at={num(r['ended_at'])} ended_iso={iso(r['ended_at'])} "
        f"duration_s={num(r['duration_s'])} duration_min={num(r['duration_min'])}"
    )

for tag, sess in sessions:
    sid = sess["id"]
    started = sess["started_at"]
    ended = sess["ended_at"]
    print()
    print(f"########## SESSION {sid} ({tag}) ##########")
    print(f"label: {sess['label']}")
    print(f"started_at: {num(started)}")
    print(f"started_iso: {iso(started)}")
    print(f"ended_at: {num(ended)}")
    print(f"ended_iso: {iso(ended)}")
    print(f"duration_s: {num(sess['duration_s'])}")
    print(f"duration_min: {num(sess['duration_min'])}")

    print()
    print(f"========== 3) monitor_samples by role  session={sid} ==========")
    sample_rows = list(
        cur.execute(
            """
            SELECT role,
                   COUNT(*) AS n,
                   AVG(cpu_percent) AS avg_cpu_percent,
                   MAX(cpu_percent) AS max_cpu_percent,
                   AVG(cpu_percent_of_system) AS avg_cpu_percent_of_system,
                   MAX(cpu_percent_of_system) AS max_cpu_percent_of_system,
                   AVG(memory_bytes) AS avg_memory_bytes,
                   MAX(memory_bytes) AS max_memory_bytes,
                   AVG(thread_count) AS avg_thread_count,
                   MAX(thread_count) AS max_thread_count,
                   AVG(busy_threads) AS avg_busy_threads,
                   MAX(busy_threads) AS max_busy_threads,
                   MAX(blocked_threads) AS max_blocked_threads
            FROM monitor_samples
            WHERE session_id = ?
            GROUP BY role
            ORDER BY role
            """,
            (sid,),
        )
    )
    print("role_group_count: " + str(len(sample_rows)))
    total_samples = cur.execute(
        "SELECT COUNT(*) FROM monitor_samples WHERE session_id = ?", (sid,)
    ).fetchone()[0]
    print("sample_row_count: " + str(total_samples))
    for r in sample_rows:
        print(
            f"role={r['role']} count={num(r['n'])} "
            f"avg_cpu_percent={num(r['avg_cpu_percent'])} max_cpu_percent={num(r['max_cpu_percent'])} "
            f"avg_cpu_percent_of_system={num(r['avg_cpu_percent_of_system'])} "
            f"max_cpu_percent_of_system={num(r['max_cpu_percent_of_system'])} "
            f"avg_memory_bytes={num(r['avg_memory_bytes'])} max_memory_bytes={num(r['max_memory_bytes'])} "
            f"avg_thread_count={num(r['avg_thread_count'])} max_thread_count={num(r['max_thread_count'])} "
            f"avg_busy_threads={num(r['avg_busy_threads'])} max_busy_threads={num(r['max_busy_threads'])} "
            f"max_blocked_threads={num(r['max_blocked_threads'])}"
        )

    print()
    print(f"========== 4) monitor_renderer_samples  session={sid} ==========")
    rend = cur.execute(
        """
        SELECT COUNT(*) AS n,
               AVG(js_heap_used_bytes) AS avg_js_heap_used_bytes,
               MAX(js_heap_used_bytes) AS max_js_heap_used_bytes,
               AVG(dom_node_count) AS avg_dom_node_count,
               MAX(dom_node_count) AS max_dom_node_count,
               SUM(long_task_count) AS sum_long_task_count,
               SUM(long_task_ms) AS sum_long_task_ms,
               SUM(gc_pause_count) AS sum_gc_pause_count,
               SUM(gc_pause_ms) AS sum_gc_pause_ms,
               AVG(running_thread_count) AS avg_running_thread_count,
               MAX(running_thread_count) AS max_running_thread_count
        FROM monitor_renderer_samples
        WHERE session_id = ?
        """,
        (sid,),
    ).fetchone()
    print(
        f"count={num(rend['n'])} "
        f"avg_js_heap_used_bytes={num(rend['avg_js_heap_used_bytes'])} "
        f"max_js_heap_used_bytes={num(rend['max_js_heap_used_bytes'])} "
        f"avg_dom_node_count={num(rend['avg_dom_node_count'])} "
        f"max_dom_node_count={num(rend['max_dom_node_count'])} "
        f"sum_long_task_count={num(rend['sum_long_task_count'])} "
        f"sum_long_task_ms={num(rend['sum_long_task_ms'])} "
        f"sum_gc_pause_count={num(rend['sum_gc_pause_count'])} "
        f"sum_gc_pause_ms={num(rend['sum_gc_pause_ms'])} "
        f"avg_running_thread_count={num(rend['avg_running_thread_count'])} "
        f"max_running_thread_count={num(rend['max_running_thread_count'])}"
    )

    print()
    print(f"========== 5) monitor_incidents in window  session={sid} ==========")
    incidents = list(
        cur.execute(
            """
            SELECT id, timestamp, kind, summary, payload_json
            FROM monitor_incidents
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp
            """,
            (started, ended),
        )
    )
    print("incident_count: " + str(len(incidents)))
    by_kind = {}
    for inc in incidents:
        by_kind.setdefault(inc["kind"], []).append(inc)
    print("kind_count: " + str(len(by_kind)))
    for kind, items in sorted(by_kind.items(), key=lambda kv: kv[0]):
        print(f"kind={kind} count={num(len(items))}")
        summaries = {}
        blocked = []
        for inc in items:
            summaries[inc["summary"]] = summaries.get(inc["summary"], 0) + 1
            if kind == "renderer_freeze":
                try:
                    payload = json.loads(inc["payload_json"] or "{}")
                except json.JSONDecodeError:
                    payload = {}
                bms = payload.get("blocked_ms")
                if bms is None:
                    # common aliases
                    bms = payload.get("blockedMs") or payload.get("duration_ms") or payload.get("durationMs")
                print(
                    f"  freeze id={num(inc['id'])} timestamp={num(inc['timestamp'])} "
                    f"iso={iso(inc['timestamp'])} summary={inc['summary']!r} blocked_ms={num(bms)}"
                )
        print("  summaries:")
        for summary, cnt in sorted(summaries.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"    count={num(cnt)} summary={summary!r}")

    print()
    print(f"========== 6) monitor_connection_episodes overlapping window  session={sid} ==========")
    episodes = list(
        cur.execute(
            """
            SELECT connection_id, agent_id, pid, spawned_at, initialized_at,
                   transport_closed_at, process_exited_at, ended_at, exit_code, signal,
                   intentional, terminal_cause, active_thread_id, running_thread_ids_json,
                   uptime_ms, reconnect_attempt, previous_connection_id
            FROM monitor_connection_episodes
            WHERE spawned_at <= ?
              AND (ended_at IS NULL OR ended_at >= ?)
            ORDER BY spawned_at
            """,
            (ended, started),
        )
    )
    print("episode_count: " + str(len(episodes)))
    for i, e in enumerate(episodes, 1):
        print(
            f"[{i}] connection_id={e['connection_id']} agent_id={e['agent_id']} pid={num(e['pid'])} "
            f"spawned_at={num(e['spawned_at'])} spawned_iso={iso(e['spawned_at'])} "
            f"initialized_at={num(e['initialized_at'])} initialized_iso={iso(e['initialized_at'])} "
            f"transport_closed_at={num(e['transport_closed_at'])} transport_closed_iso={iso(e['transport_closed_at'])} "
            f"process_exited_at={num(e['process_exited_at'])} process_exited_iso={iso(e['process_exited_at'])} "
            f"ended_at={num(e['ended_at'])} ended_iso={iso(e['ended_at'])} "
            f"exit_code={num(e['exit_code'])} signal={e['signal']!r} intentional={num(e['intentional'])} "
            f"terminal_cause={e['terminal_cause']!r} active_thread_id={e['active_thread_id']!r} "
            f"uptime_ms={num(e['uptime_ms'])} reconnect_attempt={num(e['reconnect_attempt'])} "
            f"previous_connection_id={e['previous_connection_id']!r} "
            f"running_thread_ids_json={e['running_thread_ids_json']}"
        )

    print()
    print(f"========== 7) monitor_switches in window  session={sid} ==========")
    switch_rows = list(
        cur.execute(
            """
            SELECT phase, duration_ms, success, error
            FROM monitor_switches
            WHERE timestamp >= ? AND timestamp <= ?
            """,
            (started, ended),
        )
    )
    print("switch_row_count: " + str(len(switch_rows)))
    by_phase = {}
    for sw in switch_rows:
        by_phase.setdefault(sw["phase"], []).append(sw)
    print("phase_count: " + str(len(by_phase)))
    for phase, items in sorted(by_phase.items(), key=lambda kv: kv[0]):
        durs = [float(x["duration_ms"]) for x in items if x["duration_ms"] is not None]
        failures = [x for x in items if not x["success"]]
        print(
            f"phase={phase} count={num(len(items))} "
            f"avg_duration_ms={num(avg(durs))} p95_duration_ms={num(pct(durs, 95))} "
            f"max_duration_ms={num(max(durs) if durs else None)} "
            f"failure_count={num(len(failures))}"
        )
        for f in failures:
            print(f"  failure duration_ms={num(f['duration_ms'])} error={f['error']!r}")

    print()
    print(f"========== 8) monitor_tab_click_timings in window  session={sid} ==========")
    clicks = list(
        cur.execute(
            """
            SELECT click_to_highlight_paint_ms, click_to_switch_resolved_ms, success, phase
            FROM monitor_tab_click_timings
            WHERE timestamp >= ? AND timestamp <= ?
            """,
            (started, ended),
        )
    )
    print("click_row_count: " + str(len(clicks)))
    h = [float(x["click_to_highlight_paint_ms"]) for x in clicks if x["click_to_highlight_paint_ms"] is not None]
    s = [float(x["click_to_switch_resolved_ms"]) for x in clicks if x["click_to_switch_resolved_ms"] is not None]
    print(
        f"avg_click_to_highlight_paint_ms={num(avg(h))} "
        f"p95_click_to_highlight_paint_ms={num(pct(h, 95))} "
        f"max_click_to_highlight_paint_ms={num(max(h) if h else None)}"
    )
    print(
        f"avg_click_to_switch_resolved_ms={num(avg(s))} "
        f"p95_click_to_switch_resolved_ms={num(pct(s, 95))} "
        f"max_click_to_switch_resolved_ms={num(max(s) if s else None)}"
    )
    fail_clicks = [x for x in clicks if not x["success"]]
    print("click_failure_count: " + str(len(fail_clicks)))

    print()
    print(f"========== 9) monitor_diff_ingestions  session={sid} ==========")
    diffs = list(
        cur.execute(
            """
            SELECT duration_ms, next_frame_ms, post_paint_ms, serialized_utf16_bytes
            FROM monitor_diff_ingestions
            WHERE session_id = ?
            """,
            (sid,),
        )
    )
    print("diff_count: " + str(len(diffs)))
    d_ms = [float(x["duration_ms"]) for x in diffs if x["duration_ms"] is not None]
    n_ms = [float(x["next_frame_ms"]) for x in diffs if x["next_frame_ms"] is not None]
    p_ms = [float(x["post_paint_ms"]) for x in diffs if x["post_paint_ms"] is not None]
    bts = [float(x["serialized_utf16_bytes"]) for x in diffs if x["serialized_utf16_bytes"] is not None]
    print(
        f"avg_duration_ms={num(avg(d_ms))} p95_duration_ms={num(pct(d_ms, 95))} "
        f"max_duration_ms={num(max(d_ms) if d_ms else None)}"
    )
    print(
        f"avg_next_frame_ms={num(avg(n_ms))} p95_next_frame_ms={num(pct(n_ms, 95))} "
        f"max_next_frame_ms={num(max(n_ms) if n_ms else None)}"
    )
    print(
        f"avg_post_paint_ms={num(avg(p_ms))} p95_post_paint_ms={num(pct(p_ms, 95))} "
        f"max_post_paint_ms={num(max(p_ms) if p_ms else None)}"
    )
    print(
        f"avg_serialized_utf16_bytes={num(avg(bts))} p95_serialized_utf16_bytes={num(pct(bts, 95))} "
        f"max_serialized_utf16_bytes={num(max(bts) if bts else None)} "
        f"sum_serialized_utf16_bytes={num(sum(bts) if bts else 0)}"
    )

    print()
    print(f"========== 10) 1-minute CPU buckets  session={sid} ==========")
    buckets = list(
        cur.execute(
            """
            SELECT role,
                   CAST((timestamp - ?) / 60000 AS INTEGER) AS minute_index,
                   MIN(timestamp) AS bucket_start_ts,
                   MAX(timestamp) AS bucket_end_ts,
                   COUNT(*) AS n,
                   AVG(cpu_percent) AS avg_cpu_percent,
                   MAX(cpu_percent) AS max_cpu_percent,
                   AVG(cpu_percent_of_system) AS avg_cpu_percent_of_system,
                   MAX(cpu_percent_of_system) AS max_cpu_percent_of_system
            FROM monitor_samples
            WHERE session_id = ?
              AND role IN ('electron-renderer', 'electron-main')
            GROUP BY role, minute_index
            ORDER BY role, minute_index
            """,
            (started, sid),
        )
    )
    print("bucket_count: " + str(len(buckets)))
    for b in buckets:
        print(
            f"role={b['role']} minute_index={num(b['minute_index'])} "
            f"bucket_start_ts={num(b['bucket_start_ts'])} bucket_start_iso={iso(b['bucket_start_ts'])} "
            f"bucket_end_ts={num(b['bucket_end_ts'])} bucket_end_iso={iso(b['bucket_end_ts'])} "
            f"n={num(b['n'])} avg_cpu_percent={num(b['avg_cpu_percent'])} "
            f"max_cpu_percent={num(b['max_cpu_percent'])} "
            f"avg_cpu_percent_of_system={num(b['avg_cpu_percent_of_system'])} "
            f"max_cpu_percent_of_system={num(b['max_cpu_percent_of_system'])}"
        )

print()
print("========== DONE ==========")
