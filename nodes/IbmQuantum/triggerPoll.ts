import {
	type IDataObject,
	type INodeExecutionData,
	type IPollFunctions,
} from 'n8n-workflow';

import { enrichApiError, getBaseUrl } from './transport';

// Shared polling loop for the IBM Quantum triggers. Fetch recent jobs, apply a match predicate,
// dedupe via workflow static data, and map each emitted job. Manual runs return a sample without
// touching the cursor; the first poll seeds the cursor so existing history does not fire.
export async function pollJobs(
	poll: IPollFunctions,
	limit: number,
	matches: (job: IDataObject) => boolean,
	mapJob: (job: IDataObject) => IDataObject,
): Promise<INodeExecutionData[][] | null> {
	const credentials = await poll.getCredentials('ibmQuantumApi');
	const baseUrl = getBaseUrl(credentials.region as string);

	let response: IDataObject;
	try {
		response = (await poll.helpers.httpRequestWithAuthentication.call(poll, 'ibmQuantumApi', {
			method: 'GET',
			url: `${baseUrl}/jobs`,
			qs: { limit },
			json: true,
			timeout: 30000,
		})) as IDataObject;
	} catch (error) {
		throw enrichApiError(poll.getNode(), error);
	}

	const jobs = Array.isArray(response)
		? (response as IDataObject[])
		: ((response.jobs as IDataObject[]) ?? (response.workloads as IDataObject[]) ?? []);

	// A job with no id cannot be deduplicated (every String(undefined) collides), so skip it. The
	// IBM API always returns an id; this only guards a malformed or partial response.
	const matched = jobs.filter((job) => job.id != null && matches(job));

	if (poll.getMode() === 'manual') {
		if (matched.length === 0) return [poll.helpers.returnJsonArray([])];
		return [poll.helpers.returnJsonArray([mapJob(matched[0])])];
	}

	const staticData = poll.getWorkflowStaticData('node');
	const firstRun = staticData.seenJobIds === undefined;
	const seen = (staticData.seenJobIds as string[]) ?? [];
	const fresh = matched.filter((job) => !seen.includes(String(job.id)));

	staticData.seenJobIds = [...seen, ...fresh.map((job) => String(job.id))].slice(-500);

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

// Extract the failure details the API exposes on a job's state object.
export function extractStateError(job: IDataObject): IDataObject {
	const state = (job.state as IDataObject) ?? {};
	return {
		jobId: job.id ?? null,
		backend: job.backend ?? null,
		status: typeof state.status === 'string' ? state.status.toLowerCase() : '',
		reason: state.reason ?? null,
		reasonCode: state.reason_code ?? null,
		reasonSolution: state.reason_solution ?? null,
		job,
	};
}
