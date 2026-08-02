import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { extractJobStatus, parseTagList } from './operations';
import { extractStateError, isErrorStatus, pollJobs } from './triggerPoll';

export class IbmQuantumErrorTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IBM Quantum Error (Unofficial) Trigger',
		name: 'ibmQuantumErrorTrigger',
		icon: { light: 'file:ibmQuantum.svg', dark: 'file:ibmQuantum.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '=On {{$parameter["errorFilter"]}} jobs',
		description:
			'Starts the workflow when an IBM Quantum job fails or is canceled, with the failure reason and code',
		documentationUrl: 'https://github.com/TuguiDragos/n8n-nodes-ibm-quantum#readme',
		defaults: { name: 'IBM Quantum Error Trigger' },
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
				displayName: 'On',
				name: 'errorFilter',
				type: 'options',
				options: [
					{ name: 'Canceled Only', value: 'canceled' },
					{ name: 'Failed Only', value: 'failed' },
					{ name: 'Failed or Canceled', value: 'any' },
				],
				default: 'any',
				description: 'Which failure status fires the trigger',
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
		const limit = this.getNodeParameter('limit', 50) as number;
		const tagFilters = parseTagList(this.getNodeParameter('tagFilter', ''));
		return pollJobs(
			this,
			limit,
			(job: IDataObject) => isErrorStatus(extractJobStatus(job), errorFilter),
			extractStateError,
			tagFilters.length > 0 ? { tags: tagFilters } : {},
		);
	}
}
