#!/usr/bin/env bash
# Repository settings and branch protection for Lectio (L-032). Idempotent: every write is a
# PUT/PATCH or `gh label create --force`, so re-running converges on the same settings.
#
# Owner only (needs admin rights). Agents never run this script and never change repo settings.
#
#   scripts/repo/setup.sh --dry-run     # print the required checks and every write; change nothing
#   scripts/repo/setup.sh               # apply
#
# Options:
#   --dry-run          Print the API calls instead of making them. Read-only GETs (owner type, Pages
#                      status) still run so the printed calls match what a real run would do.
#   --repo OWNER/NAME  Target repository (default: $GH_REPO, else nyabongo/lectio).
#   --registry DIR     Required-check registry (default: .github/required-checks next to this script).
#   -h, --help         Show this header.
#
# What it sets
# - main: pull request required (0 approvals: the owner opens most PRs and cannot approve their own;
#   CODEOWNERS is informational), linear history, no force pushes, no deletion. Required status
#   checks are the job names listed in .github/required-checks/*.json, plus `merge-rule` (a Checks
#   API run posted by content-gates.yml, so it is not in the registry). Every check is pinned to the
#   GitHub Actions app (app_id 15368): a check with the same name created by any other integration,
#   or by a token through the Statuses API, does not count.
# - Push restriction: on an organization-owned repo only the owner and the github-actions app may
#   push to or merge into main. GitHub offers no push restriction on a user-owned repo; there,
#   main is guarded by the PR requirement, the pinned checks and the collaborator list (keep it to
#   the owner). Admins are not enforced, so the owner can still merge by hand (fork PRs and
#   .github/** PRs, which the merge rule never merges).
# - Repo: "Allow auto-merge" and "Automatically delete head branches" on.
# - Labels: every roadmap and runtime label (including `approved` and `ios-build`), created or
#   updated in place.
# - Pages: source set to GitHub Actions (the deploy workflow itself is L-062).
# - Environment `llm-verifiers`, deployable only from protected branches (main). Recommended home for
#   ANTHROPIC_API_KEY and OPENAI_API_KEY; moving the secrets there and adding
#   `environment: llm-verifiers` to the verifiers job in content-gates.yml are follow-ups.
#
# Required-check rule (also in CONTRIBUTING.md, "Workflows and required checks"): a workflow whose
# jobs are required checks never uses trigger-level `paths:`/`paths-ignore:` (a filtered check never
# reports and blocks every unrelated PR), accepts `workflow_dispatch`, and decides in a `changes`
# step whether there is work to do, exiting green when nothing relevant changed. Workflows that are
# not in the registry (for example runway.yml, post-deploy.yml) may filter by path.
# A new required workflow becomes required by adding its registry file, not by editing this script;
# the owner re-runs the script after such a file lands on main.
set -euo pipefail

readonly ACTIONS_APP_ID=15368
readonly EXTRA_CHECKS=(merge-rule)
readonly BRANCH=main
readonly ENVIRONMENT=llm-verifiers

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dry_run=false
repo="${GH_REPO:-nyabongo/lectio}"
registry="$script_dir/../../.github/required-checks"

usage() { sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p}' "${BASH_SOURCE[0]}"; }
die() {
  echo "setup.sh: $*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --dry-run) dry_run=true ;;
    --repo)
      (($# >= 2)) || die "--repo needs OWNER/NAME"
      repo="$2"
      shift
      ;;
    --registry)
      (($# >= 2)) || die "--registry needs a directory"
      registry="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done

[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "--repo must be OWNER/NAME, got '$repo'"
[[ -d "$registry" ]] || die "registry directory not found: $registry"
command -v gh >/dev/null || die "gh (GitHub CLI) is not on PATH"
command -v node >/dev/null || die "node is not on PATH"

# write <stdin-body-or-empty> <gh args...>: runs a mutating gh call, or prints it under --dry-run.
write() {
  local body="$1"
  shift
  if [[ "$dry_run" == true ]]; then
    printf '+ gh'
    printf ' %q' "$@"
    printf '\n'
    if [[ -n "$body" ]]; then printf '%s\n' "$body" | sed 's/^/    /'; fi
  elif [[ -n "$body" ]]; then
    printf '%s' "$body" | gh "$@" >/dev/null
  else
    gh "$@" >/dev/null
  fi
}

# Required checks: the "jobs" of every registry file, plus EXTRA_CHECKS, sorted and de-duplicated.
# A malformed file stops the script (npm run required-checks gives the full diagnosis).
mapfile -t checks < <(
  node - "$registry" "${EXTRA_CHECKS[@]}" <<'NODE'
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const [dir, ...extra] = process.argv.slice(2);
const names = new Set(extra);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  let jobs;
  try {
    ({ jobs } = JSON.parse(readFileSync(join(dir, file), 'utf8')));
  } catch (error) {
    console.error(`setup.sh: ${file}: not valid JSON (${error.message})`);
    process.exit(1);
  }
  if (!Array.isArray(jobs) || jobs.length === 0 || !jobs.every((j) => typeof j === 'string' && j !== '')) {
    console.error(`setup.sh: ${file}: "jobs" must be a non-empty array of check names`);
    process.exit(1);
  }
  for (const job of jobs) names.add(job);
}
for (const name of [...names].sort()) console.log(name);
NODE
)
((${#checks[@]} > ${#EXTRA_CHECKS[@]})) || die "no required checks found in $registry"

echo "Repository: $repo"
echo "Required checks on $BRANCH (pinned to app_id $ACTIONS_APP_ID):"
printf '  - %s\n' "${checks[@]}"
echo

owner="${repo%%/*}"
owner_type="$(gh api "repos/$repo" --jq .owner.type)"

# Branch protection. Built with node so check names are JSON-escaped, never interpolated.
protection="$(
  node - "$ACTIONS_APP_ID" "$owner_type" "$owner" "${checks[@]}" <<'NODE'
const [appId, ownerType, owner, ...checks] = process.argv.slice(2);
const body = {
  required_status_checks: { strict: false, checks: checks.map((context) => ({ context, app_id: Number(appId) })) },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 0,
    dismiss_stale_reviews: false,
    require_code_owner_reviews: false,
  },
  restrictions: ownerType === 'Organization' ? { users: [owner], teams: [], apps: ['github-actions'] } : null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: false,
};
console.log(JSON.stringify(body, null, 2));
NODE
)"
write "$protection" api --method PUT "repos/$repo/branches/$BRANCH/protection" --input -

write "" api --method PATCH "repos/$repo" -F allow_auto_merge=true -F delete_branch_on_merge=true

# Labels: name|color|description. `--force` updates an existing label in place.
while IFS='|' read -r name color description; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  write "" label create "$name" --repo "$repo" --color "$color" --description "$description" --force
done <<'LABELS'
# Roadmap: type
type:feature|1D76DB|New functionality
type:infra|5319E7|Tooling, CI, repo setup, workflows
type:content|0E8A16|Passage notes, calendar, lectionary or corpus data
type:docs|0075CA|Documentation
type:test|FBCA04|Tests and quality gates
# Roadmap: status
decision|D93F0B|Owner decision; default lives in config so engineering is not blocked
needs-secrets|B60205|Needs API keys or signing secrets that do not exist yet; everything else runs on fakes
needs-owner|E99695|Needs a repo admin or product-owner action
# Roadmap: area
area:ci|C5DEF5|GitHub Actions and repo automation
area:config|C5DEF5|packages/config and config/
area:schema|C5DEF5|Content and API JSON schemas
area:corpus|C5DEF5|Original-language corpora
area:refs|C5DEF5|Reference parsing, versification, link-outs
area:calendar|C5DEF5|romcal calendar and Kenya overrides
area:lectionary|C5DEF5|Lectionary reading-reference data
area:gates|C5DEF5|The five PR gates
area:research|C5DEF5|Local research CLI
area:providers|C5DEF5|LLM, fetch, TTS, storage, GitHub provider interfaces
area:web|BFDADC|Astro site
area:pwa|BFDADC|Service worker and manifest
area:search|BFDADC|Pagefind
area:audio|BFDADC|Narration and player
area:mobile|D4C5F9|Flutter app
area:share|BFDADC|Share cards, OG images, Web Share
area:i18n|D4C5F9|Internationalisation and Kiswahili
area:a11y|D4C5F9|Accessibility
# Runtime
needs-review|FEF2C0|Runtime: content PR waits for a human reviewer (set by the merge-rule gate)
research|BFD4F2|Runtime: PR opened by the research CLI
auto-merge-candidate|0E8A16|Runtime: all gates green, both verifiers ≥ threshold, auto-merge enabled
approved|0E8A16|Runtime: set by a configured reviewer to approve a content PR (verified via the events API)
gates-failed|D73A4A|Runtime: a deterministic gate failed
ios-build|D4C5F9|Runtime: run the macOS iOS no-codesign build on this PR
content-issue|D93F0B|A reader reported a problem with a note (from the site's Report-an-issue link)
LABELS

# Pages: create with the GitHub Actions source, or switch an existing site to it.
if pages_error="$(gh api "repos/$repo/pages" --silent 2>&1)"; then
  write "" api --method PUT "repos/$repo/pages" -f build_type=workflow
elif [[ "$pages_error" == *"HTTP 404"* ]]; then
  write "" api --method POST "repos/$repo/pages" -f build_type=workflow
else
  die "could not read the Pages settings: $pages_error"
fi

write '{"deployment_branch_policy":{"protected_branches":true,"custom_branch_policies":false}}' \
  api --method PUT "repos/$repo/environments/$ENVIRONMENT" --input -

if [[ "$dry_run" == true ]]; then
  echo
  echo "Dry run: nothing was changed."
else
  echo "Done. Settings applied to $repo."
fi
