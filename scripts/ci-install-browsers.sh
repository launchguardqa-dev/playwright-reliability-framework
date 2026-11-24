#!/usr/bin/env bash
# Installs a Playwright browser in CI with a per-attempt time limit and retries.
#
# Why: the install step downloads Linux packages from Ubuntu's mirrors. When a
# mirror stops responding, a plain install hangs until the whole job times out
# (20+ minutes, no tests run). Here a stuck attempt is stopped after
# ATTEMPT_TIMEOUT seconds and retried, so a mirror hiccup costs minutes, not the run.
#
# Lesson from a real failure: the system packages are installed by apt-get running
# under sudo (as root). `timeout` runs as the CI user, so it can't kill that apt-get.
# The orphaned apt-get kept the dpkg lock, and every retry failed instantly with
# "Could not get lock /var/lib/dpkg/lock-frontend". So after a failed attempt we stop
# leftover apt-get processes with sudo and repair any half-finished install, and apt is
# told to WAIT for the lock (DPkg::Lock::Timeout) rather than fail immediately.
#
# Usage: scripts/ci-install-browsers.sh <chromium|firefox|webkit>
# Tunables (env): ATTEMPTS (3), ATTEMPT_TIMEOUT seconds (240), RETRY_DELAY seconds (15),
#                 APT_LOCK_TIMEOUT seconds (180),
#                 INSTALL_CMD (default "npx playwright install --with-deps"),
#                 CLEANUP_CMD (default: the apt cleanup below). Both overridable for testing.

set -uo pipefail

BROWSER="${1:?usage: ci-install-browsers.sh <browser>}"
ATTEMPTS="${ATTEMPTS:-3}"
ATTEMPT_TIMEOUT="${ATTEMPT_TIMEOUT:-240}"
RETRY_DELAY="${RETRY_DELAY:-15}"
APT_LOCK_TIMEOUT="${APT_LOCK_TIMEOUT:-180}"
INSTALL_CMD="${INSTALL_CMD:-npx playwright install --with-deps}"

# sudo without a password prompt (GitHub's Ubuntu runners have it). Elsewhere, skip apt handling.
have_sudo() { command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; }

# Stop apt-get processes left over from a timed-out attempt, then repair dpkg state.
apt_cleanup() {
  have_sudo || return 0
  if pgrep -x apt-get >/dev/null 2>&1; then
    echo "Stopping leftover apt-get processes: $(pgrep -x apt-get | tr '\n' ' ')"
    sudo -n pkill -TERM -x apt-get || true
    for _ in $(seq 1 20); do pgrep -x apt-get >/dev/null 2>&1 || break; sleep 1; done
    sudo -n pkill -KILL -x apt-get || true
  fi
  # Finish or roll back any package configuration the killed attempt left halfway.
  sudo -n dpkg --configure -a || true
}
CLEANUP_CMD="${CLEANUP_CMD:-apt_cleanup}"

# Make apt wait for the dpkg lock instead of failing at once (a safety net if cleanup
# can't free it immediately). Applies to every apt-get run on this machine from now on.
if have_sudo; then
  echo "DPkg::Lock::Timeout \"${APT_LOCK_TIMEOUT}\";" | sudo -n tee /etc/apt/apt.conf.d/99-ci-lock-timeout >/dev/null \
    && echo "apt will wait up to ${APT_LOCK_TIMEOUT}s for the dpkg lock."
fi

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "::group::Install ${BROWSER} (attempt ${attempt}/${ATTEMPTS}, limit ${ATTEMPT_TIMEOUT}s)"
  # --kill-after: if the installer ignores SIGTERM, SIGKILL it 10s later. This stops the
  # installer itself; root-owned apt-get children are handled by the cleanup below.
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
    echo "::group::Clean up before retrying"
    ${CLEANUP_CMD}
    echo "::endgroup::"
    sleep $((attempt * RETRY_DELAY))
  fi
done

echo "::error::Could not install ${BROWSER} after ${ATTEMPTS} attempts. Likely a package mirror outage on the runner; re-run the job."
exit 1
