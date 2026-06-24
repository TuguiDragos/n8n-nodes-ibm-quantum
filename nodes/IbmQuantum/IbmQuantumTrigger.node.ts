import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { extractJobStatus, isTerminalStatus } from './operations';
import { pollJobs } from './triggerPoll';

// Decide whether a job in the given status should fire the trigger.
export function jobMatchesFilter(status: string, statusFilter: string): boolean {
	if (!isTerminalStatus(status)) return false;
	if (statusFilter === 'any') return true;
	if (statusFilter === 'canceled') return status.startsWith('cancel');
	return status === statusFilter;
}

export class IbmQuantumTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IBM Quantum Trigger (Unofficial)',
		name: 'ibmQuantumTrigger',
		icon: { light: 'file:ibmQuantum.svg', dark: 'file:ibmQuantum.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '=Polling for {{$parameter["statusFilter"]}} jobs',
		description: 'Starts the workflow when an IBM Quantum job finishes (completed, failed or canceled)',
		documentationUrl: 'https://github.com/TuguiDragos/n8n-nodes-ibm-quantum#readme',
		defaults: { name: 'IBM Quantum Trigger' },
		polling: true,
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
				typeOptions: { minValue: 1 },
				default: 20,
				description: 'How many recent jobs to read on each poll',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const statusFilter = this.getNodeParameter('statusFilter', 'any') as string;
		const limit = this.getNodeParameter('limit', 20) as number;
		return pollJobs(
			this,
			limit,
			(job: IDataObject) => jobMatchesFilter(extractJobStatus(job), statusFilter),
			(job: IDataObject) => job,
		);
	}
}
