#!/usr/bin/env bash

# Benchmark and diagnose a shipped macOS Electron app from the outside.
# The app source and application database are not modified by this script.
#
# Accurate timing run. Direct mode reads the app's own lifecycle markers and
# does not depend on macOS Accessibility permissions.
#   DETAIL=0 LAUNCH_MODE=direct RUNS=5 bash scripts/benchmark-shipped-startup.sh
#
# Detailed diagnostic run:
#   DETAIL=1 RUNS=5 bash scripts/benchmark-shipped-startup.sh
#
# Open mode is retained only for manual diagnostics. It cannot provide a valid
# visible-window measurement unless System Events has Accessibility permission.

set -u

APP_PATH="${APP_PATH:-}"
APP_NAME="${APP_NAME:-Pipper Code (Alpha)}"
RUNS="${RUNS:-5}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"
DETAIL="${DETAIL:-0}"
LAUNCH_MODE="${LAUNCH_MODE:-direct}"
POST_WINDOW_WAIT_MS="${POST_WINDOW_WAIT_MS:-1000}"
OUTPUT_DIR="${OUTPUT_DIR:-$PWD/startup-benchmark-results}"

if [[ -z "$APP_PATH" ]]; then
  echo "APP_PATH is required so the benchmark cannot accidentally target a different app copy." >&2
  echo "Example: APP_PATH=\"$PWD/release/mac-arm64/Pipper Code (Alpha).app\" bash scripts/benchmark-shipped-startup.sh" >&2
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "App not found: $APP_PATH" >&2
  echo "Set APP_PATH to the exact .app bundle to benchmark." >&2
  exit 1
fi

if ! [[ "$RUNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "RUNS must be a positive integer: $RUNS" >&2
  exit 1
fi

if [[ "$DETAIL" != 0 && "$DETAIL" != 1 ]]; then
  echo "DETAIL must be 0 or 1: $DETAIL" >&2
  exit 1
fi

if ! [[ "$POST_WINDOW_WAIT_MS" =~ ^[0-9]+$ ]]; then
  echo "POST_WINDOW_WAIT_MS must be a non-negative integer: $POST_WINDOW_WAIT_MS" >&2
  exit 1
fi

if [[ "$LAUNCH_MODE" != open && "$LAUNCH_MODE" != direct ]]; then
  echo "LAUNCH_MODE must be open or direct: $LAUNCH_MODE" >&2
  exit 1
fi

PLIST="$APP_PATH/Contents/Info.plist"
EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST" 2>/dev/null || true)"
EXECUTABLE_PATH="$APP_PATH/Contents/MacOS/$EXECUTABLE_NAME"
ASAR_PATH="$APP_PATH/Contents/Resources/app.asar"

if [[ -z "$EXECUTABLE_NAME" || ! -x "$EXECUTABLE_PATH" ]]; then
  echo "Could not find the app executable in: $APP_PATH" >&2
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null || true)"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || true)"
APP_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST" 2>/dev/null || true)"
if [[ ! -f "$ASAR_PATH" ]]; then
  echo "Could not find packaged application code at: $ASAR_PATH" >&2
  exit 1
fi

ASAR_SHA256="$(shasum -a 256 "$ASAR_PATH" | awk '{print $1}')"
BUILD_ID="${BUNDLE_ID:-unknown}@${APP_VERSION:-unknown}+${APP_BUILD:-unknown}:asar-${ASAR_SHA256:0:12}"

mkdir -p "$OUTPUT_DIR"
SESSION_DIR="$OUTPUT_DIR/$(date +%Y%m%d-%H%M%S)-$LAUNCH_MODE-detail$DETAIL"
mkdir -p "$SESSION_DIR"
RESULT_FILE="$SESSION_DIR/startup.csv"

now_ms() {
  perl -MTime::HiRes=time -e 'printf "%.0f\n", time() * 1000'
}

bundle_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" 2>/dev/null || true
}

app_pid() {
  local pid command fallback=""
  while read -r pid command; do
    if [[ "$command" == "$EXECUTABLE_PATH" ]]; then
      echo "$pid"
      return 0
    fi
    if [[ -z "$fallback" && "$command" == "$EXECUTABLE_PATH"* ]]; then
      fallback="$pid"
    fi
  done < <(ps -axo pid=,command=)
  if [[ -n "$fallback" ]]; then
    echo "$fallback"
    return 0
  fi
  return 1
}

process_exists() {
  [[ -n "$(app_pid || true)" ]]
}

conflicting_app_pid() {
  local pid command
  while read -r pid command; do
    if [[ "$command" == */Contents/MacOS/"$EXECUTABLE_NAME" && "$command" != "$EXECUTABLE_PATH" ]]; then
      echo "$pid"
      return 0
    fi
  done < <(ps -axo pid=,command=)
  return 1
}

window_exists() {
  osascript -e "tell application \"System Events\" to tell process \"$APP_NAME\" to (count of windows) > 0" \
    >/dev/null 2>&1
}

capture_process_sample() {
  local run_dir="$1"
  local phase="$2"
  local pid
  pid="$(app_pid || true)"
  [[ -z "$pid" ]] && return 0
  {
    printf 'timestamp_ms=%s phase=%s\n' "$(now_ms)" "$phase"
    ps -p "$pid" -o pid=,ppid=,state=,%cpu=,rss=,etime=,command=
  } >>"$run_dir/process-samples.txt"
}

wait_for_process() {
  local run_dir="$1"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if process_exists; then
      capture_process_sample "$run_dir" process-visible
      return 0
    fi
    sleep 0.05
  done
  return 1
}

wait_for_window() {
  local run_dir="$1"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  local next_sample=$SECONDS
  while (( SECONDS < deadline )); do
    # A direct launch can use the app's own ready-to-show marker. This avoids
    # depending on System Events Accessibility permissions and is more precise
    # for instrumented builds.
    if [[ "$LAUNCH_MODE" == direct ]]; then
      if [[ -f "$run_dir/app.stdout.log" ]] &&
        rg -q '\[Startup\] main-window:ready-to-show|\[Main\] launchWindow ready-to-show' \
          "$run_dir/app.stdout.log" 2>/dev/null; then
        return 0
      fi
    elif window_exists; then
      capture_process_sample "$run_dir" window-visible
      return 0
    fi
    if [[ "$DETAIL" == 1 && $SECONDS -ge $next_sample ]]; then
      capture_process_sample "$run_dir" waiting-for-window
      next_sample=$((SECONDS + 1))
    fi
    sleep 0.05
  done
  return 1
}

quit_app() {
  # App names and bundle IDs are shared by installed and local packaged builds.
  # Terminate only the executable under APP_PATH, never an arbitrary same-named app.
  local pid
  pid="$(app_pid || true)"
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if ! process_exists; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

write_metadata() {
  {
    echo "app_path=$APP_PATH"
    echo "app_name=$APP_NAME"
    echo "executable=$EXECUTABLE_NAME"
    echo "bundle_id=$(bundle_value CFBundleIdentifier)"
    echo "version=$(bundle_value CFBundleShortVersionString)"
    echo "build=$(bundle_value CFBundleVersion)"
    echo "app_asar_sha256=$ASAR_SHA256"
    echo "build_id=$BUILD_ID"
    echo "launch_mode=$LAUNCH_MODE"
    echo "detail=$DETAIL"
    echo "runs=$RUNS"
    echo "timeout_seconds=$TIMEOUT_SECONDS"
    echo "post_window_wait_ms=$POST_WINDOW_WAIT_MS"
    echo "captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "system:" 
    sw_vers
    echo
    echo "hardware:" 
    system_profiler SPHardwareDataType 2>/dev/null || true
    echo
    echo "disk:" 
    df -h "$APP_PATH" 2>/dev/null || true
  } >"$SESSION_DIR/metadata.txt"
}

write_metadata
echo "run,start_epoch_ms,process_epoch_ms,window_epoch_ms,process_ms,window_ms,status,window_source" >"$RESULT_FILE"

echo "Benchmarking: $APP_PATH"
echo "Build identity: $BUILD_ID"
echo "Launch mode: $LAUNCH_MODE"
echo "Detailed diagnostics: $DETAIL"
echo "Runs: $RUNS"
echo "Results: $SESSION_DIR"
echo

for ((run = 1; run <= RUNS; run++)); do
  run_dir="$SESSION_DIR/run-$run"
  mkdir -p "$run_dir"
  launch_pid=""

  echo "Run $run/$RUNS: ensuring the shipped app is not already running..."
  conflict_pid="$(conflicting_app_pid || true)"
  if [[ -n "$conflict_pid" ]]; then
    echo "Another copy of $APP_NAME is running (pid $conflict_pid)." >&2
    echo "Quit that copy before benchmarking this APP_PATH; both copies share Electron's single-instance lock." >&2
    exit 1
  fi
  if ! quit_app; then
    echo "Could not stop $APP_NAME within ${TIMEOUT_SECONDS}s; aborting." >&2
    exit 1
  fi

  start_ms="$(now_ms)"
  if [[ "$LAUNCH_MODE" == direct ]]; then
    "$EXECUTABLE_PATH" >"$run_dir/app.stdout.log" 2>"$run_dir/app.stderr.log" &
    launch_pid=$!
  else
    open -na "$APP_PATH" >/dev/null 2>&1
  fi

  if [[ "$DETAIL" == 1 ]]; then
    echo "launch_mode=$LAUNCH_MODE" >"$run_dir/run-info.txt"
    echo "start_epoch_ms=$start_ms" >>"$run_dir/run-info.txt"
  fi

  if ! wait_for_process "$run_dir"; then
    echo "Run $run: process did not start within ${TIMEOUT_SECONDS}s" >&2
    echo "$run,$start_ms,,,,,process-timeout,none" >>"$RESULT_FILE"
    continue
  fi
  process_ms="$(now_ms)"

  app_pid_now="$(app_pid || true)"
  if [[ "$DETAIL" == 1 ]]; then
    capture_process_sample "$run_dir" process-ready
    ps -axo pid=,ppid=,state=,%cpu=,rss=,etime=,command= >"$run_dir/process-table-at-process-start.txt"
    if command -v sample >/dev/null 2>&1 && [[ -n "$app_pid_now" ]]; then
      sample "$app_pid_now" 3 1 -file "$run_dir/main-startup.sample.txt" >/dev/null 2>&1 &
      sample_pid=$!
    else
      sample_pid=""
    fi
  fi

  if ! wait_for_window "$run_dir"; then
    echo "Run $run: process started, but no visible window appeared within ${TIMEOUT_SECONDS}s" >&2
    process_delta=$((process_ms - start_ms))
    echo "$run,$start_ms,$process_ms,,${process_delta},,window-timeout,none" >>"$RESULT_FILE"
    [[ "$DETAIL" == 1 && -n "${sample_pid:-}" ]] && wait "$sample_pid" 2>/dev/null || true
    continue
  fi
  window_ms="$(now_ms)"
  process_delta=$((process_ms - start_ms))
  window_delta=$((window_ms - start_ms))
  if [[ "$LAUNCH_MODE" == direct ]] && rg -q '\[Startup\] main-window:ready-to-show|\[Main\] launchWindow ready-to-show' \
    "$run_dir/app.stdout.log" 2>/dev/null; then
    window_source="app-log"
  else
    window_source="system-events"
  fi
  echo "$run,$start_ms,$process_ms,$window_ms,$process_delta,$window_delta,ok,$window_source" >>"$RESULT_FILE"
  echo "Run $run: process=${process_delta}ms, first-window=${window_delta}ms"

  # Keep the app alive briefly after the measurement so renderer milestones
  # (React commit, FCP, project context) land in the captured stdout. This
  # delay occurs after window_delta is recorded and never affects that metric.
  if (( POST_WINDOW_WAIT_MS > 0 )); then
    sleep "$(awk "BEGIN { print $POST_WINDOW_WAIT_MS / 1000 }")"
  fi

  if [[ "$DETAIL" == 1 ]]; then
    capture_process_sample "$run_dir" post-window
    ps -axo pid=,ppid=,state=,%cpu=,rss=,thcount=,etime=,command= >"$run_dir/process-table-at-window.txt"
    [[ -n "${sample_pid:-}" ]] && wait "$sample_pid" 2>/dev/null || true
    if [[ -f "$run_dir/app.stdout.log" ]]; then
      rg -n "\\[Main\\]|ready|loadInto|agent|database|launcher" \
        "$run_dir/app.stdout.log" >"$run_dir/startup-log-summary.txt" 2>/dev/null || true
    fi
  fi

  if [[ -f "$run_dir/app.stdout.log" ]]; then
    rg '\[Startup\]' "$run_dir/app.stdout.log" >"$run_dir/startup-milestones.log" 2>/dev/null || true
  fi
done

echo
echo "Complete. The final app instance is left open."
echo "CSV: $RESULT_FILE"
if [[ "$DETAIL" == 1 ]]; then
  echo "Detailed artifacts: $SESSION_DIR/run-*/"
  echo "Note: detailed sampling adds overhead; use DETAIL=0 for authoritative timing comparisons."
fi
echo "The external script measures process launch and first visible window."
echo "React mount and workspace-interactive timings require instrumentation in a new build."
