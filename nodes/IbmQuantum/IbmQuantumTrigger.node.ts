import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { extractJobStatus, isTerminalStatus, parseTagList } from './operations';
import { pollJobs } from './triggerPoll';

// Decide whether a job in the given status should fire the trigger.
export function jobMatchesFilter(status: string, statusFilter: string): boolean {
	if (!isTerminalStatus(status)) return false;
	if (statusFilter === 'any') return true;
	if (statusFilter === 'canceled') return status.startsWith('cancel');
	// The defensive 'error' alias counts as failed, matching the error trigger's behavior.
	if (statusFilter === 'failed') return status === 'failed' || status === 'error';
	return status === statusFilter;
}

export class IbmQuantumTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IBM Quantum (Unofficial) Trigger',
		name: 'ibmQuantumTrigger',
		icon: { light: 'file:ibmQuantum.svg', dark: 'file:ibmQuantum.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '=Polling for {{$parameter["statusFilter"]}} jobs',
		description:
			'Starts the workflow when an IBM Quantum job finishes (completed, failed or canceled)',
		documentationUrl: 'https://github.com/TuguiDragos/n8n-nodes-ibm-quantum#readme',
		defaults: { name: 'IBM Quantum Trigger' },
		polling: true,
		// The verification ruleset (node-usable-as-tool) requires the property to be present; the
		// n8n-workflow type then narrows it to `true | UsableAsToolDescription`, so `false` does not
		// compile and there is no way to opt out. n8n consequently generates a tool variant of this
		// trigger that an AI Agent cannot actually run, since the class implements poll() and not
		// execute(). Nothing to do about it here: both constraints are upstream.
		usableAsTool: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ibmQuantumApi', required: true }],
		properties: [
			{
				displayName: 'Status',
				name: 'statusFilter',
				type: 'options',
				options: [
					{ name: 'Any Terminal (Completed, Failed or Canceled)', value: 'any' },
					{ name: 'Canceled', value: 'canceled' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'Failed', value: 'failed' },
				],
				default: 'any',
				description: 'Which finished-job status fires the trigger',
			},
			{
				displayName: 'Jobs to Scan',
				name: 'limit',
				type: 'number',
				// IBM caps GET /jobs at 200 and silently substitutes its own default for anything
				// outside the range, so the ceiling is worth showing in the UI rather than hiding.
				typeOptions: { minValue: 1, maxValue: 200 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Tags',
				name: 'tagFilter',
				type: 'string',
				default: '',
				placeholder: 'experiment-7, vqe',
				description:
					'Only consider jobs carrying these tags (set tags on the Submit operation). Comma-separated for several, and a job must carry all of them. Leave empty to consider all jobs.',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const statusFilter = this.getNodeParameter('statusFilter', 'any') as string;
		const limit = this.getNodeParameter('limit', 50) as number;
		const tagFilters = parseTagList(this.getNodeParameter('tagFilter', ''));
		return pollJobs(
			this,
			limit,
			(job: IDataObject) => jobMatchesFilter(extractJobStatus(job), statusFilter),
			(job: IDataObject) => job,
			tagFilters.length > 0 ? { tags: tagFilters } : {},
		);
	}
}
