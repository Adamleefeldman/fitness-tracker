#!/bin/bash
# Daily Garmin sync, invoked by launchd (see com.adamfeldman.garminsync.plist).
# Calls the project's venv Python directly so it doesn't depend on launchd's PATH.
# Appends a timestamped block to logs/sync.log so you can confirm it ran.
# After the sync, the plan's runs for the next 14 days go to the Garmin
# calendar (push-workouts), so the watch has any edits or adaptations.

set -o pipefail
PROJECT_DIR="/Users/adamfeldman/garmin-health"
cd "$PROJECT_DIR" || exit 1

mkdir -p logs
{
  echo "===== sync $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
  ".venv/bin/python" -m garmin_health.cli sync
  echo "----- exit $? at $(date '+%H:%M:%S') -----"
  echo "===== push-workouts ====="
  ".venv/bin/python" -m garmin_health.cli push-workouts
  echo "----- exit $? at $(date '+%H:%M:%S') -----"
} >> logs/sync.log 2>&1
