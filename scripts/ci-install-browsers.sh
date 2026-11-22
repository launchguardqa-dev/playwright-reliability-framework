#!/usr/bin/env bash
# Installs a Playwright browser in CI with a per-attempt time limit and retries.
#
# Why: the install step downloads Linux packages from Ubuntu's mirrors. When a
# mirror stops responding, a plain install hangs until the whole job times out
# (20+ minutes, no tests run). Here a stuck attempt is killed after
# ATTEMPT_TIMEOUT seconds and retried, so a mirror hiccup costs minutes, not the run.
#
# Usage: scripts/ci-install-browsers.sh <chromium|firefox|webkit>
# Tunables (env): ATTEMPTS (3), ATTEMPT_TIMEOUT seconds (240), RETRY_DELAY seconds (15),
#                 INSTALL_CMD (default "npx playwright install --with-deps"; overridable for testing)

set -uo pipefail

BROWSER="${1:?usage: ci-install-browsers.sh <browser>}"
ATTEMPTS="${ATTEMPTS:-3}"
ATTEMPT_TIMEOUT="${ATTEMPT_TIMEOUT:-240}"
RETRY_DELAY="${RETRY_DELAY:-15}"
INSTALL_CMD="${INSTALL_CMD:-npx playwright install --with-deps}"

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "::group::Install ${BROWSER} (attempt ${attempt}/${ATTEMPTS}, limit ${ATTEMPT_TIMEOUT}s)"
  # --kill-after: if the installer ignores SIGTERM, SIGKILL it 10s later.
  # timeout signals the whole process group, so a hung apt-get child dies too.
  # shellcheck disable=SC2086  # INSTALL_CMD is intentionally word-split
  timeout --kill-after=10 "${ATTEMPT_TIMEOUT}" ${INSTALL_CMD} "${BROWSER}"
  status=$?
  echo "::endgroup::"

  if [ "${status}" -eq 0 ]; then
    echo "Installed ${BROWSER} on attempt ${attempt}."
    exit 0
  fi

  if [ "${status}" -eq 124 ] || [ "${status}" -eq 137 ]; then
    reason="timed out after ${ATTEMPT_TIMEOUT}s"
  else
    reason="exit code ${status}"
  fi
  echo "::warning::Installing ${BROWSER} failed on attempt ${attempt}/${ATTEMPTS} (${reason})."

  if [ "${attempt}" -lt "${ATTEMPTS}" ]; then
    sleep $((attempt * RETRY_DELAY))
  fi
done

echo "::error::Could not install ${BROWSER} after ${ATTEMPTS} attempts. Likely a package mirror outage on the runner; re-run the job."
exit 1
