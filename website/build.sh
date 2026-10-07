#!/usr/bin/env bash
# Builds the website into website/_site from the repository it sits in. It needs the project's packages (npm ci
# --ignore-scripts) and the website's own (npm ci --prefix website), and stops at the first figure or quoted sentence
# that no longer holds, so a page that would say something untrue is never written.
set -euo pipefail
web="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$web/.."
rm -rf "$web/_build" "$web/_site"
mkdir -p "$web/_build" "$web/_site"

# What the page quotes, measured on this tree: the operations the built node declares, the Bell circuit as the node's
# own Circuit > Build writes it, and the unit suite with its coverage, under the same 100% gate CI applies.
npm run build
node "$web/scripts/extract_ops.cjs"
node "$web/scripts/bell.cjs"
npx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory="$web/_build/coverage" \
  --reporter=default --reporter=json --outputFile.json="$web/_build/vitest.json"

cp -R "$web/static/." "$web/_site/"
python3 "$web/scripts/build_site.py"
python3 "$web/scripts/make_404.py"
python3 "$web/scripts/make_extras.py"
echo "built $web/_site"
