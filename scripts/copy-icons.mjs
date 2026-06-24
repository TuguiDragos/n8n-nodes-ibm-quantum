// Copy node and credential icons into dist, preserving layout. Replaces the gulp icon copy.
import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const SRC_DIRS = ['nodes', 'credentials'];
const ICON_RE = /\.(png|svg)$/i;

async function* walkIcons(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return; // directory may not exist (e.g. no credential icons)
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkIcons(path);
		} else if (ICON_RE.test(entry.name)) {
			yield path;
		}
	}
}

let copied = 0;
for (const base of SRC_DIRS) {
	for await (const file of walkIcons(base)) {
		const dest = join('dist', file);
		await mkdir(dirname(dest), { recursive: true });
		await copyFile(file, dest);
		copied += 1;
	}
}

console.log(`copy-icons: copied ${copied} icon(s) into dist`);
