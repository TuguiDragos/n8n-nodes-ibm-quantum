import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import { getBaseUrl, type RequestContext } from './transport';
import {
	handleAccount,
	handleBackend,
	handleCircuitBuild,
	handleCircuitImport,
	handleJob,
	handleSession,
} from './operations';

export class IbmQuantum implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IBM Quantum (Unofficial)',
		name: 'ibmQuantum',
		icon: { light: 'file:ibmQuantum.svg', dark: 'file:ibmQuantum.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Build, run and retrieve quantum circuits on the IBM Quantum Platform',
		documentationUrl: 'https://github.com/TuguiDragos/n8n-nodes-ibm-quantum#readme',
		defaults: { name: 'IBM Quantum' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ibmQuantumApi', required: true }],
		properties: nodeProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Region is constant per credential, so build the request context once, on first use.
		let ctx: RequestContext | null = null;

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let result: IDataObject;
				if (resource === 'circuit') {
					result =
						operation === 'import'
							? handleCircuitImport.call(this, i)
							: handleCircuitBuild.call(this, i);
				} else {
					if (ctx === null) {
						const credentials = await this.getCredentials('ibmQuantumApi');
						ctx = { baseUrl: getBaseUrl(credentials.region as string) };
					}
					if (resource === 'backend') {
						result = await handleBackend.call(this, ctx, operation, i);
					} else if (resource === 'session') {
						result = await handleSession.call(this, ctx, operation, i);
					} else if (resource === 'account') {
						result = await handleAccount.call(this, ctx, operation);
					} else {
						result = await handleJob.call(this, ctx, operation, i);
					}
				}

				returnData.push({ json: result, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Preserve the context-rich errors raised downstream, and wrap only raw ones.
				const wrapped =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				throw wrapped;
			}
		}

		return [returnData];
	}
}
