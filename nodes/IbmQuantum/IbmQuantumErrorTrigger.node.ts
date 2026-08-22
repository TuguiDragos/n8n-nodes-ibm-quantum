import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { extractJobStatus, parseCsvList } from './operations';
import { extractStateError, isErrorStatus, pollJobs } from './triggerPoll';

export class IbmQuantumErrorTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IBM Quantum Error (Unofficial) Trigger',
		name: 'ibmQuantumErrorTrigger',
		icon: { light: 'file:ibmQuantum.svg', dark: 'file:ibmQuantum.dark.svg' },
		group: ['trigger'],
		version: 1,
		// Superseded by the main trigger's 'Failed or Canceled' option, which matches the same jobs
		// and emits the same three reason fields. The rest of the payload differs though, so it is
		// not a drop-in swap: this node reports `jobId` and a lowercased `status`, while the main
		// trigger spreads IBM's job and so reports `id` and IBM's own casing. Hidden rather than
		// removed so saved workflows keep polling, the way n8n retired Cron for Schedule Trigger.
		hidden: true,
		subtitle: '=On {{$parameter["errorFilter"]}} jobs',
		description:
			'Starts the workflow when an IBM Quantum job fails or is canceled, with the failure reason and code',
		documentationUrl: 'https://github.com/TuguiDragos/n8n-nodes-ibm-quantum#readme',
		defaults: { name: 'IBM Quantum Error Trigger' },
		polling: true,
		// usableAsTool is deliberately absent. The verification ruleset that once required it on
		// every node (0.3.3 shipped it under protest) now forbids it on triggers, and rightly so: a
		// tool variant of a polling trigger can never run, since the class implements poll() and
		// not execute(). See @n8n/eslint-plugin-community-nodes 0.29.0, rule node-usable-as-tool.
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ibmQuantumApi', required: true }],
		properties: [
			{
				displayName: 'Trigger On',
				name: 'errorFilter',
				type: 'options',
				options: [
					{ name: 'Canceled Only', value: 'canceled' },
					{ name: 'Failed Only', value: 'failed' },
					{ name: 'Failed or Canceled', value: 'any' },
				],
				default: 'any',
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
		const errorFilter = this.getNodeParameter('errorFilter', 'any') as string;
		// pollJobs clamps this: the UI maxValue is a hint an expression can ignore.
		const limit = this.getNodeParameter('limit', 50);
		const tagFilters = parseCsvList(this.getNodeParameter('tagFilter', ''));
		return pollJobs(
			this,
			limit,
			(job: IDataObject) => isErrorStatus(extractJobStatus(job), errorFilter),
			extractStateError,
			tagFilters.length > 0 ? { tags: tagFilters } : {},
		);
	}
}
