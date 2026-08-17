// Copy the non-TypeScript files n8n loads at runtime into dist, preserving layout: node and
// credential icons, and the codex .node.json files that give each node its picker category,
// search aliases and documentation links.
import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const SRC_DIRS = ['nodes', 'credentials'];
const ASSET_RE = /(\.(png|svg)|\.node\.json)$/i;

async function* walkAssets(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return; // directory may not exist (e.g. no credential icons)
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkAssets(path);
		} else if (ASSET_RE.test(entry.name)) {
			yield path;
		}
	}
}

let copied = 0;
for (const base of SRC_DIRS) {
	for await (const file of walkAssets(base)) {
		const dest = join('dist', file);
		await mkdir(dirname(dest), { recursive: true });
		await copyFile(file, dest);
		copied += 1;
	}
}

console.log(`copy-assets: copied ${copied} file(s) into dist`);
