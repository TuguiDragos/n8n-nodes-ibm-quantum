import {
	NodeOperationError,
	type IDataObject,
	type INodeExecutionData,
	type IPollFunctions,
} from 'n8n-workflow';

import { clampCount, extractJobStatus, stateError } from './operations';
import { checkApiVersion, enrichApiError, getBaseUrl } from './transport';

// IBM caps GET /jobs at 200 and substitutes its own default for anything outside the range, so a
// larger value silently changes the window instead of widening it. The UI maxValue is only a hint,
// so the bound is applied here where both triggers pass through.
export const MAX_POLL_LIMIT = 200;

// The dedupe cursor must stay larger than one scan window. If it were smaller, a job that fell off
// the cursor while still inside the window would be emitted a second time.
export const SEEN_JOB_CURSOR = 500;

// Shared polling loop for the IBM Quantum triggers. Fetch recent jobs, apply a match predicate,
// dedupe via workflow static data, and map each emitted job. Manual runs return a sample without
// touching the cursor; the first poll seeds the cursor so existing history does not fire.
export async function pollJobs(
	poll: IPollFunctions,
	rawLimit: unknown,
	matches: (job: IDataObject) => boolean,
	mapJob: (job: IDataObject) => IDataObject,
	extraQs: IDataObject = {},
): Promise<INodeExecutionData[][] | null> {
	const limit = clampCount(rawLimit, 50, MAX_POLL_LIMIT);
	const credentials = await poll.getCredentials('ibmQuantumApi');
	// Only the fatal case is raised here. A deprecation warning belongs to the action node, which
	// runs on demand; a trigger polls on a schedule and would repeat the same line indefinitely.
	const problem = checkApiVersion(credentials.apiVersion);
	if (problem?.fatal) throw new NodeOperationError(poll.getNode(), problem.message);
	const baseUrl = getBaseUrl(credentials.region as string);

	let response: IDataObject;
	try {
		const body = (await poll.helpers.httpRequestWithAuthentication.call(poll, 'ibmQuantumApi', {
			method: 'GET',
			url: `${baseUrl}/jobs`,
			// pending false narrows the scan window to finished jobs, so a burst of new
			// submissions cannot push a finished job out of it. exclude_params drops each
			// job's circuit payload, matching the official client's listing default.
			qs: { limit, pending: false, exclude_params: true, ...extraQs },
			// Repeated keys for array values (tags=a&tags=b), the encoding IBM recognises.
			// See the same note in transport.ts.
			arrayFormat: 'repeat',
			json: true,
			timeout: 30000,
		})) as IDataObject | null;
		// An empty body arrives as null. transport.ts applies this guard for the action node; the
		// trigger builds its own request, so without it the read below throws a bare TypeError
		// outside the error wrapper and repeats on every poll.
		response = body ?? {};
	} catch (error) {
		throw enrichApiError(poll.getNode(), error);
	}

	// Guard on the shape, not just on null: `?? []` lets a non-array `jobs` through to .filter and
	// crashes with a bare TypeError. Same reasoning as parseResults in results.ts.
	const asJobList = (value: unknown): IDataObject[] | null =>
		Array.isArray(value) ? (value as IDataObject[]) : null;
	const returned =
		asJobList(response) ?? asJobList(response.jobs) ?? asJobList(response.workloads) ?? [];
	// Hold the scan window to what was asked for rather than trusting the server to honour it. This
	// is what keeps the window below SEEN_JOB_CURSOR, and with it the promise that a job already
	// emitted cannot fall off the cursor and fire a second time.
	const jobs = returned.slice(0, limit);

	// A job with no id cannot be deduplicated (every String(undefined) collides), so skip it. A null
	// entry is skipped for the same reason, and because reading .id off it throws a raw TypeError
	// that would repeat on every poll. The IBM API always returns a full list; this only guards a
	// malformed or partial response.
	const matched = jobs.filter((job) => job != null && job.id != null && matches(job));

	if (poll.getMode() === 'manual') {
		if (matched.length === 0) return [poll.helpers.returnJsonArray([])];
		return [poll.helpers.returnJsonArray([mapJob(matched[0])])];
	}

	const staticData = poll.getWorkflowStaticData('node');
	const firstRun = staticData.seenJobIds === undefined;
	const seen = (staticData.seenJobIds as string[]) ?? [];
	const fresh = matched.filter((job) => !seen.includes(String(job.id)));

	staticData.seenJobIds = [...seen, ...fresh.map((job) => String(job.id))].slice(-SEEN_JOB_CURSOR);

	if (firstRun || fresh.length === 0) return null;
	return [poll.helpers.returnJsonArray(fresh.map(mapJob))];
}

// Whether a job's terminal status counts as an error for the error trigger.
export function isErrorStatus(status: string, errorFilter: string): boolean {
	const failed = status === 'failed' || status === 'error';
	const canceled = status.startsWith('cancel');
	if (!failed && !canceled) return false;
	if (errorFilter === 'failed') return failed;
	if (errorFilter === 'canceled') return canceled;
	return true;
}

// Add the failure details beside the untouched job. The job carries these only under state,
// so nothing existing is shadowed and expressions reading the raw fields keep working.
export function withErrorDetails(job: IDataObject): IDataObject {
	return { ...job, ...stateError(job) };
}

// Extract the failure details the API exposes on a job's state object.
export function extractStateError(job: IDataObject): IDataObject {
	return {
		jobId: job.id ?? null,
		backend: job.backend ?? null,
		// Read through the same helper the trigger matched on, so a job carrying only a top-level
		// status is reported with that status instead of an empty string.
		status: extractJobStatus(job),
		...stateError(job),
		job,
	};
}
