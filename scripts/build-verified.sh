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

# The Cloudflare Vite plugin serializes an empty compatibility_flags array even
# when the project does not configure flags. Sites treats the field itself as
# an explicit override, so remove only the empty generated field.
wrangler_config="${SITES_PROJECT_ROOT}/dist/server/wrangler.json"
if [[ -f "${wrangler_config}" ]]; then
  node --input-type=module - "${wrangler_config}" <<'NODE'
import fs from "node:fs";

const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (Array.isArray(config.compatibility_flags) && config.compatibility_flags.length === 0) {
  delete config.compatibility_flags;
  fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`);
}
NODE
fi

"${script_dir}/validate-artifact.sh"
