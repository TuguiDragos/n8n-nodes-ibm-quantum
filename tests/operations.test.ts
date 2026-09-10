import { describe, expect, it } from 'vitest';

import { cursorFromHref, extractJobStatus, TERMINAL } from '../nodes/IbmQuantum/operations';

describe('extractJobStatus', () => {
	it('reads the nested state.status first', () => {
		expect(extractJobStatus({ state: { status: 'Completed' }, status: 'Running' })).toBe(
			'completed',
		);
	});

	it('falls back to a string state, then the top level status', () => {
		expect(extractJobStatus({ state: 'RUNNING' })).toBe('running');
		expect(extractJobStatus({ status: 'Failed' })).toBe('failed');
	});

	it('returns an empty string when no status is present', () => {
		expect(extractJobStatus({})).toBe('');
	});
});

describe('TERMINAL', () => {
	// The IBM Quantum Platform V2 terminal statuses are completed, canceled and failed.
	it('recognises every real terminal status', () => {
		for (const status of ['completed', 'canceled', 'failed']) {
			expect(TERMINAL).toContain(status);
		}
	});

	it('does not treat in-progress statuses as terminal', () => {
		for (const status of ['pending', 'in_progress', 'running', 'queued']) {
			expect(TERMINAL).not.toContain(status);
		}
	});
});

describe('cursorFromHref', () => {
	const WORKLOADS = 'https://quantum.cloud.ibm.com/api/v1/workloads';

	it('reads the token IBM puts in the paging link, percent-decoded', () => {
		expect(cursorFromHref(`${WORKLOADS}?limit=5&next=3fe78a36b9aa7f26`, 'next')).toBe(
			'3fe78a36b9aa7f26',
		);
		expect(cursorFromHref('/api/v1/workloads?previous=abc%2Bdef%3D&limit=5#top', 'previous')).toBe(
			'abc+def=',
		);
	});

	it('returns null for a missing link, a non-string, no query, or no such parameter', () => {
		for (const href of [
			undefined,
			null,
			{ href: 'x?next=1' },
			WORKLOADS,
			`${WORKLOADS}?limit=5&nextpage=1`,
			`${WORKLOADS}?previous=1`,
			`${WORKLOADS}?next=`,
			`${WORKLOADS}?next`,
		]) {
			expect(cursorFromHref(href, 'next'), String(href)).toBeNull();
		}
	});

	it('keeps a token whose percent encoding is malformed rather than dropping the page', () => {
		expect(cursorFromHref('https://x/workloads?next=%E0%A4%A', 'next')).toBe('%E0%A4%A');
	});

	it('takes the first occurrence when the parameter repeats', () => {
		expect(cursorFromHref('https://x/workloads?next=first&next=second', 'next')).toBe('first');
	});
});
