import { describe, expect, it } from 'vitest';

// Everything here is read through a relative import rather than the filesystem. `npm run lint`
// applies the n8n community-nodes rules to this directory, and no-restricted-imports allows only
// relative paths, devDependencies and a short allowlist, so `node:fs` would fail the lint.
import agents from '../AGENTS.md?raw';
import ci from '../.github/workflows/ci.yml?raw';
import publishWorkflow from '../.github/workflows/publish.yml?raw';
import scanWorkflow from '../.github/workflows/scan.yml?raw';
import pullRequestTemplate from '../.github/PULL_REQUEST_TEMPLATE.md?raw';
import changelog from '../CHANGELOG.md?raw';
import conduct from '../CODE_OF_CONDUCT.md?raw';
import contributing from '../CONTRIBUTING.md?raw';
import { IbmQuantumApi } from '../credentials/IbmQuantumApi.credentials';
import eslintConfig from '../eslint.config.mjs?raw';
import llmsFull from '../llms-full.txt?raw';
import llmsIndex from '../llms.txt?raw';
import { nodeProperties } from '../nodes/IbmQuantum/descriptions';
import {
	ADDITIONAL_OPTION_KEYS,
	nonIsaInstructions,
	RANK_METRICS,
} from '../nodes/IbmQuantum/operations';
import { IbmQuantum } from '../nodes/IbmQuantum/IbmQuantum.node';
import codexAction from '../nodes/IbmQuantum/IbmQuantum.node.json';
import { IbmQuantumErrorTrigger } from '../nodes/IbmQuantum/IbmQuantumErrorTrigger.node';
import codexErrorTrigger from '../nodes/IbmQuantum/IbmQuantumErrorTrigger.node.json';
import { IbmQuantumTrigger } from '../nodes/IbmQuantum/IbmQuantumTrigger.node';
import codexTrigger from '../nodes/IbmQuantum/IbmQuantumTrigger.node.json';
import transportSource from '../nodes/IbmQuantum/transport.ts?raw';
import PACKAGE from '../package.json';
import readme from '../README.md?raw';
import harness from '../scripts/qa-run.mjs?raw';
import { HEADING, RELEASE_DATE, releaseBlocker } from '../scripts/release-guard.mjs';
import scanVerdict from '../scripts/scan-verdict.mjs?raw';
import security from '../SECURITY.md?raw';

const NODES = [
	[new IbmQuantum(), codexAction],
	[new IbmQuantumTrigger(), codexTrigger],
	[new IbmQuantumErrorTrigger(), codexErrorTrigger],
] as const;

describe('package registration', () => {
	it('registers every node class it ships, and the credential', () => {
		for (const [node] of NODES) {
			const file = `dist/nodes/IbmQuantum/${node.constructor.name}.node.js`;
			expect(PACKAGE.n8n.nodes).toContain(file);
		}
		expect(PACKAGE.n8n.nodes).toHaveLength(NODES.length);
		expect(PACKAGE.n8n.credentials).toContain('dist/credentials/IbmQuantumApi.credentials.js');
	});

	it('names the credential the nodes ask for', () => {
		const credentialName = new IbmQuantumApi().name;
		for (const [node] of NODES) {
			expect(node.description.credentials?.[0].name).toBe(credentialName);
		}
	});

	// n8n's loader reads n8nNodesApiVersion, nodes and credentials and nothing else. `n8n-node
	// cloud-support` writes a `strict: true` beside them, and with it `n8n-node lint` refuses any
	// eslint.config.mjs that is not the CLI's own template, which this repository's is not.
	it('keeps the n8n block to the keys n8n reads', () => {
		expect(Object.keys(PACKAGE.n8n).sort()).toEqual(['credentials', 'n8nNodesApiVersion', 'nodes']);
	});

	it('declares @n8n/node-cli, which the submission guide requires as a devDependency', () => {
		expect(PACKAGE.devDependencies['@n8n/node-cli']).toBeTruthy();
	});
});

describe('the toolchain scope', () => {
	it('lints and formats tests and scripts, not only what ships', () => {
		for (const script of ['lint', 'lintfix', 'format', 'format:check'] as const) {
			expect(PACKAGE.scripts[script], script).toContain(' tests scripts');
		}
	});

	// The scanner lints its own {nodes,credentials} glob and package.json on one leg and index.js on
	// the other, all of it under no-console as well, and its verdict is the only one that decides
	// verification. A path or a rule missing from the config is green here and red at the gate.
	it('lints the paths the verification scanner lints, under the rule it adds to all of them', () => {
		expect(eslintConfig).toMatch(/const covered = \[[^\]]*'index\.js'/);
		expect(eslintConfig).toContain("'{nodes,credentials}/**/*.{js,ts,json}'");
		expect(eslintConfig).toContain("'no-console': 'error'");
		expect(eslintConfig).not.toMatch(/ignores: \[[^\]]*'index\.js'/);
		for (const script of ['lint', 'lintfix'] as const) {
			expect(PACKAGE.scripts[script], script).toContain('package.json index.js nodes credentials');
		}
	});

	// @n8n/scan-community-package prints its verdict and then exits 0 whether the package passed or
	// failed, so calling it directly leaves the scheduled scan green on a failed scan, which is the
	// surprise the workflow exists to prevent.
	it('gates both scan invocations on the verdict the scanner prints, not on its exit code', () => {
		expect(PACKAGE.scripts.scan).toContain('| node scripts/scan-verdict.mjs');
		expect(scanWorkflow).toContain('- run: npm run scan');
		expect(scanWorkflow).not.toMatch(/- run: npx .*scan-community-package/);
	});

	// An unscoped n8n-node is published on the registry as a dependency-confusion placeholder, not
	// as this CLI, and npx resolves the bare name to it once the devDependency is missing. Only
	// --no makes npx refuse instead of fetching it, so a document that drops the flag hands a
	// reader a lint that never runs.
	it('spells the n8n CLI lint everywhere with the flag that keeps npx off the registry', () => {
		for (const [name, document] of [
			['README.md', readme],
			['CONTRIBUTING.md', contributing],
			['AGENTS.md', agents],
			['.github/PULL_REQUEST_TEMPLATE.md', pullRequestTemplate],
			['.github/workflows/ci.yml', ci],
		] as const) {
			expect(document, name).toContain('npx --no -- n8n-node lint');
			expect(document, name).not.toMatch(/npx\s+n8n-node/);
		}
	});

	// process.exit ends the process with writes to a pipe still queued, so a failed scan piped into
	// tee, grep or a log collector loses the tail of the scanner's output, which is the only part of
	// that log anyone reads.
	it('lets the reader drain the scanner output it echoes before it exits 1', () => {
		expect(scanVerdict).toContain('process.exitCode = 1;');
		expect(scanVerdict).not.toMatch(/process\.exit\(/);
	});
});

describe('the publish workflow', () => {
	// This is the one job that holds an OIDC token, and setup-node's trusted publishing guidance is
	// that a poisoned dependency cache can expose credentials, that token among them.
	it('installs cold on the job that mints the OIDC token', () => {
		expect(publishWorkflow).toContain('id-token: write');
		expect(publishWorkflow).toContain('package-manager-cache: false');
		expect(publishWorkflow).not.toMatch(/^\s+cache: /m);
	});

	// GitHub runs nothing for created on a draft release, and publishing that draft later fires
	// published, so created alone would let a drafted release skip the registry entirely.
	it('triggers on the release activity type a drafted release also fires', () => {
		expect(publishWorkflow).toContain('types: [published]');
		expect(publishWorkflow).not.toContain('types: [created]');
	});

	// The check was guarded by the event name, so a manual dispatch skipped it and published
	// whatever the branch it ran from declared, with no tag to disagree with.
	it('holds a manual dispatch to the tag a release is held to', () => {
		expect(publishWorkflow).not.toContain("github.event_name == 'release'");
		expect(publishWorkflow).toContain('"$GITHUB_REF_TYPE" != "tag"');
		expect(publishWorkflow).toContain('"$PKG" != "$TAG"');
	});

	// npm writes the latest dist tag whenever --tag is absent, so a release marked as a
	// pre-release would take the tag npm install and the n8n registry read. github.event.release
	// is empty on a dispatch, which is the trigger the draft-release note recommends, so without
	// the lookup a pre-release run by hand would decide on the version string alone.
	it('names the dist tag instead of taking the npm default', () => {
		expect(publishWorkflow).toContain('npm publish --access public --tag "$DIST_TAG"');
		expect(publishWorkflow).toContain('DIST_TAG=next');
		expect(publishWorkflow).toContain('DIST_TAG=latest');
		expect(publishWorkflow).toContain('if [ -z "$PRERELEASE" ]; then');
		expect(publishWorkflow).toContain('gh release view "$GITHUB_REF_NAME"');
	});

	// prepublishOnly is the last gate in front of the registry, and a publish never goes through
	// CI, so anything CI runs that it does not run is a check no release has to pass.
	it('runs every gate CI runs before it publishes', () => {
		const gates = [...ci.matchAll(/^\s+- run: (.+)$/gm)]
			.map((match) => match[1])
			.filter((command) => command !== 'npm ci --ignore-scripts');
		expect(gates).toHaveLength(5);
		for (const gate of gates) {
			expect(PACKAGE.scripts.prepublishOnly, gate).toContain(gate);
		}
	});

	// Every section but the newest carries a date, and the newest carries "(unreleased)" until the
	// day it goes out. Nothing read that word: the changelog test below asks only that the version
	// has a section, which the undated heading satisfies. The guard runs first in prepublishOnly,
	// the gate a publish from the workflow and a publish by hand both pass through, and CI never
	// runs it, so the section stays undated for as long as the release is unmade.
	it('refuses to publish a version the changelog leaves undated', () => {
		expect(PACKAGE.scripts.prepublishOnly).toMatch(/^node scripts\/release-guard\.mjs &&/);
		expect(releaseBlocker('## 0.6.0 (unreleased)\n', '0.6.0')).toContain('(unreleased)');
		expect(releaseBlocker('## 0.6.0 (in progress)\n', '0.6.0')).toContain('(in progress)');
		expect(releaseBlocker('## 0.6.0 (2026-09-30)\n', '0.6.0')).toBe('');
		expect(releaseBlocker('## 0.1.1 (2025)\n', '0.1.1')).toBe('');
		expect(releaseBlocker('## 0.5.0 (2026-08-21)\n', '0.6.0')).toContain('has no');
	});

	// A heading the guard cannot parse reads as a missing section, which stops the publish just as
	// firmly, but the maintainer meets that at the registry rather than in CI. So every `##` heading
	// is held to the guard's own expression rather than a second one that might differ from it: only
	// the version being written may hold anything but a date, and the guard has to agree with the
	// file about which case this is. The collector allows the three leading spaces CommonMark still
	// renders as a heading and the guard's anchor refuses, since a fourth makes it a code block.
	it('dates every changelog section but the one still being written', () => {
		const headings = [...changelog.matchAll(/^ {0,3}#{2} .+$/gm)].map((match) => match[0]);
		const sections = [...changelog.matchAll(HEADING)];
		expect(sections.map((match) => match[0])).toEqual(headings);
		expect(headings.length).toBeGreaterThan(1);
		let current = '';
		for (const [heading, version, when] of sections) {
			if (version === PACKAGE.version) current = when;
			else expect(when, heading).toMatch(RELEASE_DATE);
		}
		expect(releaseBlocker(changelog, PACKAGE.version) === '', current).toBe(
			RELEASE_DATE.test(current),
		);
	});

	// The publish is not the last step. api.n8n.io keeps a row per node type pinning one npmVersion
	// and that tarball's dist.integrity, n8n refuses a community package with no checksum once
	// N8N_UNVERIFIED_PACKAGES_ENABLED is off, and a checksum fits one tarball, so an unlisted
	// version is unreachable on the verified path however long it has been on npm: 0.2.2, 0.2.3 and
	// 0.4.1 never reached those rows. A release runbook that stops at npm hides that from whoever
	// follows it, so both documents a releaser reads have to carry it.
	it('tells a releaser that npm is not the step that makes a version installable', () => {
		expect(contributing).toMatch(/^## Releasing$/m);
		for (const [name, document] of [
			['CONTRIBUTING.md', contributing],
			['AGENTS.md', agents],
		] as const) {
			expect(document, name).toContain('api.n8n.io');
			expect(document, name).toContain('N8N_UNVERIFIED_PACKAGES_ENABLED');
			expect(document, name).toContain('checksum');
			expect(document, name).toMatch(/relist/i);
		}
	});
});

describe('codex files', () => {
	// The build copies these into dist; if one drifts from its node name n8n silently ignores it,
	// so the picker category, search aliases and docs links disappear without any error.
	it.each(NODES.map(([node, codex]) => [node.constructor.name, node, codex] as const))(
		'%s has a codex naming its own node type',
		(_className, node, codex) => {
			expect(codex.node).toBe(`${PACKAGE.name}.${node.description.name}`);
			expect(codex.categories.length).toBeGreaterThan(0);
			expect(codex.alias.length).toBeGreaterThan(0);
			expect(codex.resources).toBeTruthy();
		},
	);

	// The panel search scores each alias entry on its own and matches the typed term as a
	// subsequence of that one string, so "Instances" answers "instance" too while two entries never
	// answer a two word term. Without these, nothing in the node answers a search for the account
	// side: "instance", "cost", "limit", "quota" and "usage" all return no node at all.
	it('gives the account operations words the panel search can find', () => {
		expect(codexAction.alias).toEqual(
			expect.arrayContaining(['Instances', 'Usage', 'Cost Limit', 'Quota']),
		);
	});

	// codexVersion is the codex schema version and is always "1.0". nodeVersion is contested: n8n's
	// codex docs say it "should have the same value as the version parameter in your main node
	// file", which would be "2.0" here, but the n8n review rejected "2.0" twice and asked for "1.0",
	// the value n8n's own Code node (version [1, 2]) and 399 of the 400 built-in codex files carry.
	// The review gates verification, so "1.0" is pinned; do not reopen this against the docs alone.
	it.each(NODES.map(([node, codex]) => [node.constructor.name, codex] as const))(
		'%s pins both codex versions to the schema value',
		(_className, codex) => {
			expect(codex.nodeVersion).toBe('1.0');
			expect(codex.codexVersion).toBe('1.0');
		},
	);
});

describe('documented surface', () => {
	// The operation count appears in README.md and llms.txt. Both are written by hand, so this
	// pins the real figure: if you add an operation, update the prose the failure points at.
	const EXPECTED = { account: 11, backend: 6, circuit: 2, job: 12, session: 4, workload: 1 };

	it('has the resource and operation counts the docs claim', () => {
		const counts: Record<string, number> = {};
		for (const property of nodeProperties) {
			if (property.name !== 'operation') continue;
			for (const resource of (property.displayOptions?.show?.resource ?? []) as string[]) {
				counts[resource] = ((property.options ?? []) as unknown[]).length;
			}
		}
		expect(counts).toEqual(EXPECTED);
		const total = Object.values(EXPECTED).reduce((sum, n) => sum + n, 0);
		expect(total).toBe(36);

		// The same figure is written out in three places by hand. Pin all of them, because a count
		// that drifts in prose is the kind of error no other test would ever catch.
		expect(llmsIndex).toContain(`${total} operations`);
		expect(readme).toContain(
			`${total} operations across ${Object.keys(EXPECTED).length} resources`,
		);
		expect(changelog).toContain(`${total} operations`);
	});

	// The README resource table is the one place a reader counts operations by name. It is written
	// by hand as well, so an operation added to the dropdown but not to its row, a row entry the
	// dropdown never had, or a row for a resource the node no longer has, would leave the sentence
	// above the table correct and the table wrong.
	it('lists every operation in the README resource table', () => {
		const advertised: Record<string, string[]> = {};
		for (const property of nodeProperties) {
			if (property.name !== 'operation') continue;
			const names = ((property.options ?? []) as Array<{ name: string }>).map(
				(option) => option.name,
			);
			for (const resource of (property.displayOptions?.show?.resource ?? []) as string[]) {
				advertised[resource] = names;
			}
		}

		const start = readme.indexOf('operations across');
		const table = readme.slice(start, readme.indexOf('\n\n', readme.indexOf('| :--', start)));
		for (const resource of Object.keys(EXPECTED)) {
			const label = resource[0].toUpperCase() + resource.slice(1);
			const row = table.match(new RegExp(`^\\| \\*\\*${label}\\*\\* \\| (.+) \\|$`, 'm'));
			expect(row, `README table row for ${label}`).not.toBeNull();
			const listed = (row as RegExpMatchArray)[1]
				.replace(/\([^)]*\)/g, '')
				.split(',')
				.map((entry) => entry.trim());
			expect(listed.sort(), `${label} row`).toEqual([...(advertised[resource] ?? [])].sort());
		}
		const rows = [...table.matchAll(/^\| \*\*(.+?)\*\* \|/gm)].map((match) => match[1]);
		expect(rows.sort(), 'README table rows').toEqual(
			Object.keys(EXPECTED)
				.map((resource) => resource[0].toUpperCase() + resource.slice(1))
				.sort(),
		);
	});

	it('describes the n8n variables that exist rather than the tool flag n8n removed', () => {
		// n8n 1.85.0 removed N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE; llms-full.txt still required it
		// in 0.4.1 and 0.5.0, so both files are pinned to the live list.
		for (const doc of [readme, llmsFull]) {
			expect(doc).not.toContain('N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true');
			expect(doc).toContain('N8N_UNVERIFIED_PACKAGES_ENABLED');
			expect(doc).toContain('N8N_COMMUNITY_PACKAGES_ENABLED');
		}
	});

	// publish.yml refuses a release tag that does not match package.json; nothing refused a version
	// with no changelog section until now.
	it('has a changelog section for the version package.json declares', () => {
		expect(changelog).toContain(`## ${PACKAGE.version}`);
	});

	// The header named the month the file was generated in, which is right in the month the
	// release goes out and wrong from the next one on, and llms-full.txt ships inside the tarball.
	// The version is the part of that claim a check can hold to package.json, so it is the only
	// part left: a month put back here fails this test rather than the reader.
	it('names the version llms-full.txt was generated from, and no month to go stale', () => {
		const claim = llmsFull.match(/It is generated from the source of version (\S+?)\.(?=\s)/);
		expect(claim?.[1]).toBe(PACKAGE.version);
	});

	// n8n 2.36 moved its engines requirement to Node 24 without announcing it, and four documents
	// here said "Node.js 22 or 24" as if the two were interchangeable. They are hand-written, so
	// this pins the wording that replaced it and fails if the old phrase comes back anywhere.
	it('names Node 24 as the runtime and Node 22 only for n8n 2.35 and older', () => {
		for (const text of [readme, llmsFull, agents, contributing]) {
			expect(text).not.toMatch(/Node(\.js)? 22 or (24|newer)/);
			expect(text).toMatch(/n8n 2\.35\s+and\s+older/);
		}
		expect(readme).toContain('badge/node-24');
		expect(PACKAGE.engines.node).toBe('>=22');
	});

	it('names the fleet, limits and error codes IBM publishes rather than retired ones', () => {
		// ibm_torino was retired on 1 April 2026 and "50 MB" never had an official source; both
		// survived several releases because nothing read the prose. The registry link and the codes
		// are pinned so the failure table cannot quietly lose them again.
		const retiredAsCurrent = /such as\s+ibm_fez, ibm_kingston, ibm_marrakesh and ibm_torino/;
		for (const doc of [readme, llmsFull]) {
			expect(doc).not.toMatch(retiredAsCurrent);
			expect(doc).not.toContain('50 MB');
			expect(doc).toContain('https://quantum.cloud.ibm.com/docs/en/errors');
		}
		for (const code of [1506, 1517, 1519, 1520, 1521, 1522, 1603]) {
			expect(llmsFull).toContain(`reason_code ${code}`);
		}
		expect(llmsFull).toContain('code 5302');
		expect(llmsFull).toContain('code 1352');
	});

	it('tells contributors which n8n reloads a linked build without a restart', () => {
		// n8n 2.29.0 made the restart optional; the sentence demanding one on every change outlived
		// it, so the release that changed the local workflow is pinned here.
		expect(contributing).not.toMatch(/needs a rebuild and a restart/);
		expect(contributing).toContain('n8n 2.29.0');
	});

	it('presents the MCP omission of mode as an observation, not an n8n rule', () => {
		// The blanket claim that n8n "drops" a parameter named mode was never verified beyond one
		// live check on 0.4.1; the docs must keep saying what was measured and no more.
		for (const doc of [readme, agents]) {
			expect(doc).toContain('Observed live on 0.4.1');
			expect(doc).not.toMatch(/drops it from the type definitions/);
		}
	});
});

// llms-full.txt is the file an assistant reads, and until now nothing noticed when a parameter
// landed in descriptions.ts without a line there. Every operation value and every parameter name,
// nested collection fields included, must appear in it as a backticked token, and every operation
// must appear in README.md under its display name. Option choices (name plus value, no type) are
// not parameters and are skipped.
describe('the documentation names every operation and parameter the UI advertises', () => {
	type Entry = { name?: string; type?: string; options?: unknown[]; values?: unknown[] };
	const parameterNames = new Set<string>();
	const operationNames = new Set<string>();

	const walk = (entries: unknown[]) => {
		for (const entry of entries) {
			if (typeof entry !== 'object' || entry === null) continue;
			const property = entry as Entry;
			if (property.name === 'operation') {
				for (const option of (property.options ?? []) as Array<{ name: string; value: string }>) {
					parameterNames.add(option.value);
					operationNames.add(option.name);
				}
				continue;
			}
			if (property.name === 'resource') continue;
			if (typeof property.type === 'string' && typeof property.name === 'string') {
				parameterNames.add(property.name);
			}
			if (Array.isArray(property.options)) walk(property.options);
			if (Array.isArray(property.values)) walk(property.values);
		}
	};
	walk(nodeProperties);

	it('names every operation value and parameter in llms-full.txt', () => {
		expect(parameterNames.size).toBeGreaterThan(80);
		const missing = [...parameterNames].filter((name) => !llmsFull.includes(`\`${name}\``));
		expect(missing).toEqual([]);
	});

	it('names every operation in README.md', () => {
		expect(operationNames.size).toBeGreaterThan(20);
		const missing = [...operationNames].filter((name) => !readme.includes(name));
		expect(missing).toEqual([]);
	});
});

describe('the four documents embed every readme-assets file listed here', () => {
	// `node:fs` is barred here by the lint's import rule, so the list is by hand and nothing
	// reads the directory: a file added under readme-assets/ needs its own row to be checked at all.
	const README_ASSETS = [
		'01-trigger-picker.png',
		'02-actions-top.png',
		'03-actions-mid.png',
		'04-ai-tool.png',
		'05-credentials.png',
		'06-least-busy.png',
		'07-run-overview.png',
		'08-run-summary.png',
		'09-session-actions.png',
		'10-circuit-build.png',
		'banner-conduct.svg',
		'banner-contributing.svg',
		'banner-security.svg',
		'hero.svg',
	];
	const DOCUMENTS: Record<string, string> = {
		'README.md': readme,
		'SECURITY.md': security,
		'CONTRIBUTING.md': contributing,
		'CODE_OF_CONDUCT.md': conduct,
	};

	it('embeds every readme-assets file on the list', () => {
		expect(README_ASSETS).toHaveLength(14);
		for (const file of README_ASSETS) {
			const embedded = Object.values(DOCUMENTS).some((document) =>
				document.includes(`readme-assets/${file}`),
			);
			expect(embedded, file).toBe(true);
		}
	});

	it('points at no image under .github/', () => {
		for (const [name, document] of Object.entries(DOCUMENTS)) {
			expect(document, name).not.toContain('.github/images');
		}
	});
});

// The hosts table in SECURITY.md ends with "and no others", and nothing checked it: a host added
// to transport.ts would ship without a row, and the count word in front of the table would lie.
// Every host the node requests is a literal in transport.ts, except IAM, which lives in the
// credential's preAuthentication and is pinned by tests/credentials.test.ts.
describe('SECURITY.md names every host the code talks to', () => {
	const COUNT_WORDS: Record<number, string> = { 3: 'Three', 4: 'Four', 5: 'Five' };
	const codeHosts = [
		...new Set([
			'https://iam.cloud.ibm.com',
			...(transportSource.match(/https:\/\/[a-z0-9.-]+/g) ?? []),
		]),
	]
		.map((url) => new URL(url).hostname)
		.sort();
	const section = security.slice(
		security.indexOf('### Where requests go'),
		security.indexOf('### What gets written down'),
	);
	const listedHosts = [...section.matchAll(/^\| `([a-z0-9.-]+)` \|/gm)].map((match) => match[1]);

	it('lists each host exactly once, and no other', () => {
		expect([...listedHosts].sort()).toEqual(codeHosts);
	});

	it('spells the count in front of the table to match the rows', () => {
		expect(section).toContain(`${COUNT_WORDS[listedHosts.length]} hosts, and no others:`);
	});
});

describe('the pull request checklist matches CI', () => {
	// The audit found the template asking for three of the four checks CI enforced. Pin the two
	// lists against each other, so the next new step cannot go missing from the checklist.
	const ciCommands = [...ci.matchAll(/^\s+- run: (.+)$/gm)].map((match) => match[1]);
	const checklist = [...pullRequestTemplate.matchAll(/^- \[ \] `([^`]+)` passes$/gm)].map(
		(match) => match[1],
	);

	it('runs the n8n CLI lint right after the repository lint, and refuses to fetch it', () => {
		expect(ciCommands).toEqual([
			'npm ci --ignore-scripts',
			'npm run lint',
			'npx --no -- n8n-node lint',
			'npm run format:check',
			'npm run build',
			'npm run test:coverage',
		]);
	});

	it("asks for every check CI runs, in CI's order", () => {
		expect(checklist).toEqual([
			'npm run lint',
			'npx --no -- n8n-node lint',
			'npm run format:check',
			'npm run build',
			'npm test',
		]);
	});
});

describe('the example workflow in llms-full.txt', () => {
	// The fenced JSON is written to be imported into n8n verbatim, so it must stay parseable and
	// internally wired: a stale node name inside connections would import as a broken workflow,
	// and an AI assistant copying it would ship that breakage onward.
	it('parses, wires every connection to a real node, and uses the current node version', () => {
		const fenced = llmsFull.match(/```json\n([\s\S]*?)```/);
		expect(fenced).not.toBeNull();
		const workflow = JSON.parse((fenced as RegExpMatchArray)[1]) as {
			nodes: Array<{ name: string; type: string; typeVersion: number }>;
			connections: Record<string, { main: Array<Array<{ node: string }>> }>;
		};
		const names = workflow.nodes.map((node) => node.name);
		expect(names.length).toBeGreaterThan(0);
		for (const [source, outputs] of Object.entries(workflow.connections)) {
			expect(names).toContain(source);
			for (const port of outputs.main) {
				for (const target of port) expect(names).toContain(target.node);
			}
		}
		const ibmNodes = workflow.nodes.filter((node) => node.type === `${PACKAGE.name}.ibmQuantum`);
		expect(ibmNodes.length).toBeGreaterThan(0);
		for (const node of ibmNodes) expect(node.typeVersion).toBe(2);
	});
});

// A json field whose default does not parse makes n8n's code editor show a lint error before the
// user has touched anything, on an optional field.
describe('every JSON field opens without an error marker', () => {
	it('gives each json parameter a default that parses', () => {
		const jsonFields = nodeProperties.filter((property) => property.type === 'json');
		expect(jsonFields.length).toBeGreaterThan(0);
		for (const field of jsonFields) {
			expect(() => JSON.parse(String(field.default))).not.toThrow();
		}
	});
});

// The field's own example was, in 0.5.0, a key the REST schema refuses. Tie the example
// to the list the node enforces, and to the two documents that repeat it.
describe('the Additional Options example is a key IBM accepts', () => {
	const field = nodeProperties.find((property) => property.name === 'additionalOptions');
	const example = (field?.description ?? '').match(/for example (\{.*?\}\})/)?.[1] ?? '';

	it('parses and uses only keys both primitive schemas list', () => {
		const keys = Object.keys(JSON.parse(example) as Record<string, unknown>);
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) {
			expect(ADDITIONAL_OPTION_KEYS.sampler).toContain(key);
			expect(ADDITIONAL_OPTION_KEYS.estimator).toContain(key);
		}
	});

	it('is the example the README and llms-full.txt give', () => {
		expect(readme).toContain(example);
		expect(llmsFull).toContain(example);
	});

	it('no longer suggests the environment key anywhere a user reads', () => {
		expect(field?.description).not.toContain('{"environment"');
		expect(readme).not.toContain('{"environment"');
		expect(llmsFull).not.toContain('{"environment"');
	});
});

// n8n loads a dynamic list once, on open, and on Refresh List. There is no polling and no TTL
// (ParameterInput.vue: the credentials watcher runs immediate, plus the refreshOptions action),
// so the status and queue in a label go stale while the panel stays open. Say so in the tooltip.
describe('the backend dropdowns explain when their labels refresh', () => {
	const dropdowns = nodeProperties.filter(
		(property) => property.typeOptions?.loadOptionsMethod === 'getBackends',
	);

	it('covers every field that loads the list', () => {
		expect(dropdowns.length).toBeGreaterThan(0);
		for (const field of dropdowns) {
			expect(field.description).toContain('Refresh List');
		}
	});

	// The lint rule node-param-description-wrong-for-dynamic-options requires the standard
	// sentence to be last, so anything added has to sit in front of it.
	it('keeps the expression hint as the closing sentence', () => {
		for (const field of dropdowns) {
			expect(field.description).toMatch(/expression<\/a>\.$/);
		}
	});
});

// The handler validates Rank By against RANK_METRICS and the dropdown lists its own values; a value
// present in one and not the other would either be unselectable or rejected at run time.
describe('the Rank By options match what the handler accepts', () => {
	const rankBy = nodeProperties.find((property) => property.name === 'rankBy');

	it('offers exactly the handler metrics, with queue length as the default', () => {
		const values = ((rankBy?.options ?? []) as Array<{ value: string }>).map((o) => o.value);
		expect([...values].sort()).toEqual(Object.keys(RANK_METRICS).sort());
		expect(rankBy?.default).toBe('queueLength');
	});

	it('is shown only for Get Least Busy, beside Processor Family', () => {
		const family = nodeProperties.find((property) => property.name === 'processorFamily');
		for (const field of [rankBy, family]) {
			expect(field?.displayOptions?.show).toEqual({
				resource: ['backend'],
				operation: ['getLeastBusy'],
			});
		}
		expect(family?.default).toBe('');
	});
});

// With descriptionType 'auto', which is n8n's default, getToolDescriptionForNode builds the tool
// description from the operation's `action`. That makes `action` the only text a model reads, so
// the constraint that sinks a submitted job has to be in it. Verified against n8n's own MCP
// server, which reports the base description and never the usableAsTool replacement.
describe('the submit actions carry the constraint a model must not miss', () => {
	const operations = nodeProperties.filter((property) => property.name === 'operation');
	const submits = operations
		.flatMap((property) => (property.options ?? []) as Array<{ value: string; action?: string }>)
		.filter((option) => option.value.startsWith('submit'));

	it('names all three submit operations', () => {
		expect(submits.map((option) => option.value).sort()).toEqual([
			'submitEstimator',
			'submitNoiseLearner',
			'submitSampler',
		]);
	});

	it('says the circuit must already be transpiled', () => {
		for (const option of submits) {
			expect(option.action).toMatch(/transpiled ISA circuit/);
		}
	});
});

// n8n's useNodeDocsUrl returns the class's documentationUrl whenever it starts with http and only
// falls back to the codex, with its utm parameters appended after the anchor, when it does not. The
// two therefore have to name one page: both triggers sent the Docs button to the top of the README
// and the codex to the section that describes them.
describe('the node documentation links agree', () => {
	it.each(NODES.map(([node, codex]) => [node.constructor.name, node, codex] as const))(
		'%s sends the Docs button and the codex to the same page',
		(_className, node, codex) => {
			expect(node.description.documentationUrl).toBe(codex.resources.primaryDocumentation[0].url);
		},
	);

	it('points each node at the part of the README that covers it', () => {
		for (const trigger of [new IbmQuantumTrigger(), new IbmQuantumErrorTrigger()]) {
			expect(trigger.description.documentationUrl).toMatch(/#long-running-jobs$/);
		}
		expect(readme).toContain('## Long-running jobs');
		expect(new IbmQuantum().description.documentationUrl).toMatch(/#readme$/);
	});
});

// The credential dialog's "Read our docs" link comes from the credential class, while the node
// panel's link comes from the codex. They pointed at different pages, so a user got IBM's general
// guides index, which documents none of these four fields.
describe('the credential documentation links agree', () => {
	it('sends both the dialog and the codex to the same page', () => {
		const fromClass = new IbmQuantumApi().documentationUrl;
		const fromCodex = codexAction.resources.credentialDocumentation[0].url;
		expect(fromClass).toBe(fromCodex);
	});

	it('points at the section that lists the four fields', () => {
		expect(new IbmQuantumApi().documentationUrl).toMatch(/#credentials$/);
		expect(readme).toContain('### Credentials');
	});
});

describe('AI tool exposure', () => {
	// This text is the node panel blurb, not what a model reads. Two consumers were checked and
	// neither sees it: the AI Agent resolves `descriptionType: 'auto'` (n8n's default) through
	// getToolDescriptionForNode, which returns `<action> in IBM Quantum`; and n8n's own MCP server
	// reports the BASE description for every operation, confirmed live against the published
	// 0.4.1. What does reach a model is each parameter's own description, so the ISA constraint
	// is pinned there instead.
	it('keeps the tool blurb short, since a model never reads it', () => {
		const usableAsTool = new IbmQuantum().description.usableAsTool;
		expect(usableAsTool).toBeTruthy();
		const replacement = (usableAsTool as { replacements?: { description?: string } }).replacements;
		expect(replacement?.description).toMatch(/transpiled/i);
		expect((replacement?.description ?? '').length).toBeLessThan(160);
	});

	// The constraint a model must not miss, on the parameters it actually receives.
	it('states the transpilation constraint on the parameters a model is given', () => {
		const carriers = nodeProperties.filter((property) =>
			/does not transpile/i.test(property.description ?? ''),
		);
		expect(carriers.map((property) => property.name)).toEqual(expect.arrayContaining(['backend']));
	});

	it('keeps both triggers out of the tool picker, which the verification ruleset requires', () => {
		expect(new IbmQuantumTrigger().description.usableAsTool).toBeUndefined();
		expect(new IbmQuantumErrorTrigger().description.usableAsTool).toBeUndefined();
	});

	it('supports node version 2 by default while still loading version 1', () => {
		const description = new IbmQuantum().description;
		expect(description.version).toEqual([1, 2]);
		expect(description.defaultVersion).toBe(2);
	});
});

// descriptions.ts is 1000 lines of hand-written UI text that neither the type checker nor the lint
// rules read. These pin the properties that silently drift.
describe('the UI text stays consistent with the operations it names', () => {
	const allText = nodeProperties
		.flatMap((property) => [
			property.displayName,
			property.description ?? '',
			property.placeholder ?? '',
			...(
				(property.options ?? []) as Array<{ name?: string; description?: string; action?: string }>
			).flatMap((option) => [option.name ?? '', option.description ?? '', option.action ?? '']),
		])
		.join('\n');

	// The three listing operations were renamed to "Get Many"; prose that still says "List" sends
	// the reader looking for an operation that is no longer in the dropdown.
	it('never refers to a listing operation by its old name', () => {
		expect(allText).not.toMatch(/\b(Job|Backend|Workload) List\b/);
		expect(allText).not.toMatch(/\bList operation\b/);
		expect(allText).not.toMatch(/\bList Tags\b/);
	});

	it('gives every operation option a name, a value, an action and a description', () => {
		for (const property of nodeProperties) {
			if (property.name !== 'operation') continue;
			for (const option of (property.options ?? []) as Array<Record<string, unknown>>) {
				expect(option.name, `${String(option.value)} name`).toBeTruthy();
				expect(option.value, `${String(option.name)} value`).toBeTruthy();
				expect(option.action, `${String(option.value)} action`).toBeTruthy();
				expect(option.description, `${String(option.value)} description`).toBeTruthy();
			}
		}
	});

	// n8n's UX guidelines ask for examples to read as examples. This walked the action node's top
	// two levels only, which is how both triggers shipped a Tags placeholder without the prefix and
	// how the fields inside a fixedCollection were never read at all.
	it('prefixes every example placeholder with "e.g."', () => {
		const BUTTON_LABELS = new Set(['Add Filter', 'Add Gate', 'Add Option']);
		const check = (properties: typeof nodeProperties) => {
			for (const property of properties) {
				const placeholder = property.placeholder;
				if (placeholder && !BUTTON_LABELS.has(placeholder)) {
					expect(placeholder, `${property.name} placeholder`).toMatch(/^e\.g\. /);
				}
				for (const entry of (property.options ?? []) as unknown[]) {
					if (typeof entry !== 'object' || entry === null) continue;
					const values = (entry as { values?: typeof nodeProperties }).values;
					if (Array.isArray(values)) check(values);
					else if ('name' in entry && 'type' in entry)
						check([entry as (typeof nodeProperties)[number]]);
				}
			}
		};
		for (const [node] of NODES) check(node.description.properties);
	});

	it('offers every program Submit sends as a Program filter on Get Many', () => {
		const listFilters = nodeProperties.find((property) => property.name === 'listFilters');
		const fields = (listFilters?.options ?? []) as Array<{
			name: string;
			options?: Array<{ value: string }>;
		}>;
		const program = fields.find((field) => field.name === 'program');
		expect(program?.options?.map((option) => option.value)).toEqual([
			'',
			'estimator',
			'noise-learner',
			'sampler',
		]);
	});
});

// IBM retired its cloud simulators on 15 May 2024 and marks devices[].is_simulator deprecated in
// its OpenAPI spec. Both toggles stay for saved workflows, so their descriptions have to say that
// they no longer do anything, or the next reader designs a workflow around a simulator that does
// not exist.
describe('the simulator toggles say what IBM retired', () => {
	it('marks Include Simulators as deprecated without changing the parameter', () => {
		const field = nodeProperties.find((property) => property.name === 'includeSimulators');
		expect(field).toMatchObject({ type: 'boolean', default: false });
		expect(field?.description).toMatch(/^Whether/);
		expect(field?.description).toMatch(/Deprecated/);
		expect(field?.description).toMatch(/15 May 2024/);
	});

	it('tells the analytics Simulators filter reader the same date', () => {
		const filters = nodeProperties.find((property) => property.name === 'analyticsFilters');
		const field = ((filters?.options ?? []) as Array<{ name: string; description?: string }>).find(
			(option) => option.name === 'simulators',
		);
		expect(field?.description).toMatch(/^Whether/);
		expect(field?.description).toMatch(/15 May 2024/);
	});

	it('no longer calls a backend a simulator in the dropdown tooltip', () => {
		const field = nodeProperties.find((property) => property.name === 'backendName');
		expect(field?.description).not.toMatch(/simulator/i);
	});
});

describe('the consolidated trigger', () => {
	const trigger = new IbmQuantumTrigger().description;
	const errorTrigger = new IbmQuantumErrorTrigger().description;
	const triggerOn = trigger.properties.find((p) => p.name === 'statusFilter');

	// n8n builds the Triggers list from a property named Event, Events or Trigger On. Anything
	// else makes it fall back to a single unnamed placeholder entry.
	it('labels the event property so n8n lists each option in the panel', () => {
		expect(triggerOn?.displayName).toBe('Trigger On');
		expect(errorTrigger.properties.find((p) => p.name === 'errorFilter')?.displayName).toBe(
			'Trigger On',
		);
	});

	it('offers the combined failure option that replaced the error trigger', () => {
		const values = (triggerOn?.options ?? []).map((o) => (o as { value: string }).value);
		expect(values).toContain('failedOrCanceled');
		expect(values).toEqual(['any', 'canceled', 'completed', 'failed', 'failedOrCanceled']);
	});

	// Hidden, never deleted: saved workflows still resolve the type and keep polling.
	it('retires the error trigger without unregistering it', () => {
		expect(errorTrigger.hidden).toBe(true);
		expect(errorTrigger.name).toBe('ibmQuantumErrorTrigger');
		expect(PACKAGE.n8n.nodes).toContain('dist/nodes/IbmQuantum/IbmQuantumErrorTrigger.node.js');
	});

	// n8n renders each entry as `action ?? 'On ' + noCase(name)`, and noCase flattens the
	// parenthesised list into a run-on phrase, so the catch-all option sets its label explicitly.
	it('gives the catch-all option a short panel label', () => {
		const options = (triggerOn?.options ?? []) as Array<{ value: string; action?: string }>;
		const any = options.find((o) => o.value === 'any');
		expect(any?.action).toBe('On any terminal state');
		for (const option of options.filter((o) => o.value !== 'any')) {
			expect(option.action).toBeUndefined();
		}
	});

	// The subtitle renders the stored value on the canvas, so a value that is not plain lowercase
	// leaks camelCase into the UI unless the subtitle spells it out.
	it('never shows a raw camelCase value on the canvas', () => {
		const subtitle = String(trigger.subtitle);
		for (const option of (triggerOn?.options ?? []) as Array<{ value: string }>) {
			if (/^[a-z]+$/.test(option.value)) continue;
			expect(subtitle).toContain(option.value);
			expect(subtitle).toContain('failed or canceled');
		}
	});

	it('keeps the retired trigger findable through the main trigger aliases', () => {
		expect(codexTrigger.alias).toEqual(expect.arrayContaining(['Error', 'Failed', 'Canceled']));
	});

	// n8n shows this text in the node panel, and the registry preview shows it before install.
	it('describes itself as a trigger rather than with action-node prose', () => {
		expect(trigger.description).toMatch(/^Starts a workflow when an IBM Quantum job /);
		expect(trigger.description).not.toMatch(/^Run quantum circuits/);
		expect(trigger.description).toMatch(/reason/);
		expect(errorTrigger.description).toMatch(/^Starts the workflow when an IBM Quantum job /);
	});
});

describe('the account and session texts state what IBM documents', () => {
	const operationOption = (resource: string, value: string) => {
		const property = nodeProperties.find(
			(candidate) =>
				candidate.name === 'operation' &&
				(candidate.displayOptions?.show?.resource ?? []).includes(resource),
		);
		const options = (property?.options ?? []) as Array<{ value: string; description?: string }>;
		return options.find((option) => option.value === value);
	};

	it('says the analytics figures are in milliseconds', () => {
		for (const value of ['getAnalytics', 'getAnalyticsGrouped', 'getAnalyticsByDate']) {
			expect(operationOption('account', value)?.description, value).toMatch(/milliseconds/);
		}
	});

	it('says what Close does to queued and running jobs', () => {
		const close = operationOption('session', 'close')?.description;
		expect(close).toMatch(/queued jobs will not run/);
		expect(close).toMatch(/running job finishes/);
	});

	it('says IBM caps Max TTL by plan', () => {
		const maxTtl = nodeProperties.find((property) => property.name === 'maxTtl')?.description;
		expect(maxTtl).toMatch(/10 minutes/);
		expect(maxTtl).toMatch(/8 hours/);
	});
});

// Every problem this release fixed except one was a text that no longer matched behaviour, and
// neither the suite nor lint could see any of them. This is the one place where a description is
// checked against what the code actually does: each gate says whether IBM runs it untouched, and
// the node's own ISA scanner is the authority. If the basis set ever changes, or a gate is added
// with the wrong blurb, this fails instead of shipping a tooltip that lies.
describe('gate descriptions match the ISA scanner', () => {
	const HEAD = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[3] q;\nbit[3] c;\n';
	// One minimal statement per gate, in the form the builder emits.
	const EMITTED: Record<string, string> = {
		barrier: 'barrier q[0], q[1];',
		ccx: 'ccx q[0], q[1], q[2];',
		cx: 'cx q[0], q[1];',
		crx: 'crx(0.5) q[0], q[1];',
		cry: 'cry(0.5) q[0], q[1];',
		crz: 'crz(0.5) q[0], q[1];',
		cz: 'cz q[0], q[1];',
		delay: 'delay[100ns] q[0];',
		h: 'h q[0];',
		id: 'id q[0];',
		measure: 'c[0] = measure q[0];',
		p: 'p(0.5) q[0];',
		reset: 'reset q[0];',
		rx: 'rx(0.5) q[0];',
		ry: 'ry(0.5) q[0];',
		rz: 'rz(0.5) q[0];',
		rzz: 'rzz(0.5) q[0], q[1];',
		s: 's q[0];',
		sdg: 'sdg q[0];',
		swap: 'swap q[0], q[1];',
		sx: 'sx q[0];',
		t: 't q[0];',
		tdg: 'tdg q[0];',
		u: 'U(0, 0, 0) q[0];',
		x: 'x q[0];',
		y: 'y q[0];',
		z: 'z q[0];',
	};

	const gateOptions = () => {
		const gates = nodeProperties.find((p) => p.name === 'gates');
		const group = (gates?.options ?? [])[0] as { values: Array<Record<string, unknown>> };
		const gate = group.values.find((v) => v.name === 'gate') as {
			options: Array<{ name: string; value: string; description: string }>;
		};
		return gate.options;
	};

	it('has an example statement for every gate in the palette', () => {
		const values = gateOptions().map((o) => o.value);
		expect(values.sort()).toEqual(Object.keys(EMITTED).sort());
	});

	it('says "runs as-is" for exactly the gates the scanner accepts', () => {
		for (const option of gateOptions()) {
			const claimsClean =
				option.description.startsWith('Runs as-is') ||
				option.description.startsWith('Directive') ||
				option.description.startsWith('Accepted but emits nothing');
			const scannerClean = nonIsaInstructions(`${HEAD}${EMITTED[option.value]}`).length === 0;
			expect(
				claimsClean,
				`${option.value}: description says ${claimsClean ? 'clean' : 'transpile'}, scanner says ${
					scannerClean ? 'clean' : 'transpile'
				}`,
			).toBe(scannerClean);
		}
	});

	it('gives every gate a description', () => {
		for (const option of gateOptions()) {
			expect(option.description, option.value).toBeTruthy();
		}
	});
});

// The harness runs by hand against a real account and is not part of the package, so a renamed or
// removed operation survives in it until the next live pass fails on it. When Set Cost Limit was
// dropped in 0.5.0 its harness phase went in the same commit; nothing but care made that happen.
describe('the live harness names only what the UI advertises', () => {
	const resource = nodeProperties.find((property) => property.name === 'resource');
	const resources = ((resource?.options ?? []) as Array<{ value: string }>).map(
		(option) => option.value,
	);
	const operations = nodeProperties
		.filter((property) => property.name === 'operation')
		.flatMap((property) => (property.options ?? []) as Array<{ value: string }>)
		.map((option) => option.value);

	it('uses advertised resource and operation values in every node it builds', () => {
		const named = [...harness.matchAll(/\boperation: '([A-Za-z]+)'/g)].map((match) => match[1]);
		expect(named.length).toBeGreaterThan(30);
		for (const operation of named) expect(operations).toContain(operation);
		for (const [, value] of harness.matchAll(/\bresource: '([A-Za-z]+)'/g)) {
			expect(resources).toContain(value);
		}
	});

	it('exercises the 0.6.0 reads and the Get Status toggle with the parameter names the UI defines', () => {
		for (const name of ['includeParams', 'planId', 'returnAll', 'rankBy', 'processorFamily']) {
			expect(nodeProperties.some((property) => property.name === name)).toBe(true);
			expect(harness).toContain(`${name}:`);
		}
		for (const operation of ['getAccountConfiguration', 'getManyInstances']) {
			expect(harness).toContain(`operation: '${operation}'`);
		}
	});
});
