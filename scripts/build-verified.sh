#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout >/dev/null || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

# Cloudflare now treats the Node compatibility behavior as the default and
# rejects an explicit nodejs_compat flag (including an empty compatibility_flags
# field) in the generated manifest.
wrangler_config="${SITES_PROJECT_ROOT}/dist/server/wrangler.json"
if [[ -f "${wrangler_config}" ]]; then
  node - "${wrangler_config}" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const config = JSON.parse(fs.readFileSync(path, "utf8"));
if (Array.isArray(config.compatibility_flags)) {
  const normalized = config.compatibility_flags.filter((flag) => flag !== "nodejs_compat");
  if (normalized.length === 0) delete config.compatibility_flags;
  else if (normalized.length !== config.compatibility_flags.length) config.compatibility_flags = normalized;
  fs.writeFileSync(path, `${JSON.stringify(config)}\n`);
}
NODE
fi

"${script_dir}/validate-artifact.sh"
