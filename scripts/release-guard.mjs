// Fails a publish whose changelog section is still undated. npm runs this from prepublishOnly,
// the moment the working tree becomes a release and the only gate both a publish from the
// workflow and a publish by hand go through; CI never runs it, so the section stays undated for
// as long as the release is unmade. Nothing read that heading before: the metadata test asserts
// the version has a section, which "## 0.6.0 (unreleased)" satisfies as well as a date does.
//
// Usage:
//   node scripts/release-guard.mjs

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Every section heads with the version and a parenthesis. The version is taken as written, so a
// prerelease suffix heads a section as readily as `X.Y.Z`. The date rule is positive, so anything
// that is not a date stops the publish, whatever word stands in for one; 0.1.1 carries the year
// alone. The suite parses the real file with this same expression, so a `##` heading it cannot
// read fails the build rather than waiting to fail the publish.
export const HEADING = /^## (\S+) \(([^)]*)\)$/gm;
export const RELEASE_DATE = /^\d{4}(-\d{2}-\d{2})?$/;

export function releaseBlocker(changelog, version) {
	const section = [...changelog.matchAll(HEADING)].find(([, declared]) => declared === version);
	if (!section) {
		return `CHANGELOG.md has no "## ${version} (date)" heading for the version package.json declares.`;
	}
	if (!RELEASE_DATE.test(section[2])) {
		return `CHANGELOG.md heads ${version} with "(${section[2]})". Date that section before publishing.`;
	}
	return '';
}

// Only when node was pointed at this file, so the suite can import the function above without
// reading anything or setting an exit code. Both sides go through realpath, because node resolves
// symlinks in module URLs and leaves them in argv[1].
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
	const root = new URL('../', import.meta.url);
	const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
	const blocker = releaseBlocker(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version);
	if (blocker) {
		console.error(`release-guard: ${blocker}`);
		process.exitCode = 1;
	}
}
