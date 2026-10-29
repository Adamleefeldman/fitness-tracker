# Phase 2 — daily auto-sync with launchd

Runs `garmin_health.cli sync` every morning at **7:00 local** so yesterday's data
is already in the database when you wake up. `sync` is gap-aware: it re-checks the
last stored day and fills any days missed while the laptop was off. Then
`push-workouts` puts the plan's runs for the next 14 days on your Garmin calendar
(see [Runs on your watch](../README.md#runs-on-your-watch)), so edits and
adaptations reach the watch by morning.

## Files
- `run_sync.sh` — the job: cds to the project, runs the sync then push-workouts with the venv Python, logs to `logs/sync.log`.
- `com.adamfeldman.garminsync.plist` — the launchd schedule (7:00 daily).

## Install (one time)

```bash
# 1. Make the runner executable
chmod +x ~/garmin-health/automation/run_sync.sh   # path adjusted to your repo

# 2. Smoke-test the runner by hand (writes to logs/sync.log)
./automation/run_sync.sh && tail -n 20 logs/sync.log

# 3. Link the schedule into LaunchAgents and load it
cp automation/com.adamfeldman.garminsync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.adamfeldman.garminsync.plist
```

## Manage it

```bash
# Confirm it's registered
launchctl list | grep garminsync

# Run it now to test the schedule (don't wait for 7am)
launchctl start com.adamfeldman.garminsync

# Change the time: edit the plist's Hour/Minute, then reload:
launchctl unload ~/Library/LaunchAgents/com.adamfeldman.garminsync.plist
launchctl load   ~/Library/LaunchAgents/com.adamfeldman.garminsync.plist

# Stop scheduling entirely
launchctl unload ~/Library/LaunchAgents/com.adamfeldman.garminsync.plist
```

## Notes
- **Token refresh:** the cached Garmin token in `.garminconnect/` auto-refreshes,
  so the job stays non-interactive. If Garmin ever forces a re-login, run any
  command once by hand to refresh it.
- **Verify it ran:** `tail logs/sync.log` — each run appends a timestamped block.
