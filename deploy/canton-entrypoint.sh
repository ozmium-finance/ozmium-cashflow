#!/bin/bash
# Runs Canton directly via its own jar, instead of through `dpm sandbox`.
#
# `dpm sandbox` is a convenience wrapper that always runs its own built-in
# bootstrap script (baked into the canton-open-source jar as
# sandbox/bootstrap.canton), and that script isn't restart-safe against
# persistent storage -- see the comment at the top of
# canton-bootstrap.canton for the full story. The `sandbox` command also
# has no way to swap that script out (`--bootstrap` is explicitly
# rejected: "bootstrap script cannot be defined together with the
# 'sandbox' command"), so the only way to use our own idempotent version
# is to drop to the `daemon` command, which takes `--bootstrap` freely but
# doesn't auto-merge dpm sandbox's default topology config the way
# `sandbox` does. sandbox-defaults.conf (extracted from the same jar at
# image build time -- see Dockerfile.canton) restores that default
# topology; canton-production.conf layers Postgres storage and the JSON
# API settings on top of it, same as before.
set -euo pipefail

CANTON_JAR="$(find /opt/dpm/cache/components/canton-open-source -name 'canton-open-source-*.jar' | head -1)"

if [ -z "$CANTON_JAR" ]; then
  echo "canton-entrypoint.sh: couldn't find canton-open-source-*.jar under /opt/dpm/cache -- was dpm install/build run in the image build?" >&2
  exit 1
fi

exec java -jar "$CANTON_JAR" \
  daemon \
  -c /app/deploy/canton-defaults/sandbox-defaults.conf,/app/deploy/canton-production.conf \
  --bootstrap /app/deploy/canton-bootstrap.canton
