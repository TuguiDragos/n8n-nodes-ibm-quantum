// Reads the output of @n8n/scan-community-package and fails when it is not a pass.
// The scanner prints its verdict and then exits 0 whichever way it went, a failed provenance
// check and a 404 for the package name included, so its exit code can gate nothing: without this
// the scheduled scan stays green on a failed scan. Everything it printed goes through untouched,
// and only its own success line counts as a pass.
//
// Usage:
//   npx --yes @n8n/scan-community-package@latest <package> | node scripts/scan-verdict.mjs

const PASSED = /^✅ Package \S+ has passed all security checks\s*$/m;

let printed = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
	printed += chunk;
	process.stdout.write(chunk);
}

// The status is set rather than taken with process.exit, which ends the process while writes to a
// pipe are still queued and so drops the tail of the scanner's output on exactly the failed scan
// the log is wanted for.
if (!PASSED.test(printed)) {
	console.error('scan-verdict: the scanner did not report a pass. Its output is above.');
	process.exitCode = 1;
}
