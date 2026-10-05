#!/usr/bin/env bash
# A stand-in for `gh` in the setup.sh tests (bash, not node, so the ~40 calls per run stay cheap).
# Appends one record per call to $FAKE_GH_LOG: the arguments separated by \x1f, then \x1e and the
# stdin when the call has `--input`, then the record terminator \x1d. It answers the two reads
# setup.sh makes:
#   gh api repos/<o>/<r> --jq .owner.type  -> $FAKE_GH_OWNER_TYPE (default User)
#   gh api repos/<o>/<r>/pages --silent    -> $FAKE_GH_PAGES: exists (default), missing (404), error (500)
# Every other call succeeds silently.
set -euo pipefail

{
  printf '%s\x1f' "$@"
  for arg in "$@"; do
    if [[ "$arg" == --input ]]; then
      printf '\x1e'
      cat
      break
    fi
  done
  printf '\x1d'
} >>"${FAKE_GH_LOG:?}"

[[ "${1:-}" == api ]] || exit 0
for arg in "$@"; do [[ "$arg" == --method ]] && exit 0; done
if [[ " $* " == *" --jq "* ]]; then
  echo "${FAKE_GH_OWNER_TYPE:-User}"
elif [[ "${2:-}" == */pages ]]; then
  case "${FAKE_GH_PAGES:-exists}" in
    missing)
      echo 'gh: Not Found (HTTP 404)' >&2
      exit 1
      ;;
    error)
      echo 'gh: Server Error (HTTP 500)' >&2
      exit 1
      ;;
  esac
fi
