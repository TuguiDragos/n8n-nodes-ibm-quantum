import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { extractJobStatus } from './operations';
import { extractStateError, isErrorStatus, pollJobs } from './triggerPoll';

export class IbmQuantumErrorTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IBM Quantum Error Trigger (Unofficial)',
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
				typeOptions: { minValue: 1 },
				default: 20,
				description: 'How many recent jobs to read on each poll',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const errorFilter = this.getNodeParameter('errorFilter', 'any') as string;
		const limit = this.getNodeParameter('limit', 20) as number;
		return pollJobs(
			this,
			limit,
			(job: IDataObject) => isErrorStatus(extractJobStatus(job), errorFilter),
			extractStateError,
		);
	}
}
