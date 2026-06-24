import { describe, expect, it } from 'vitest';

import { extractJobStatus, TERMINAL } from '../nodes/IbmQuantum/operations';

describe('extractJobStatus', () => {
	it('reads the nested state.status first', () => {
		expect(extractJobStatus({ state: { status: 'Completed' }, status: 'Running' })).toBe('completed');
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
