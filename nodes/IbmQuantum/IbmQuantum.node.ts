import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import { getBackends } from './loadOptions';
import {
	asNodeError,
	checkApiVersion,
	errorMessage,
	getBaseUrl,
	type RequestContext,
} from './transport';
import {
	handleAccount,
	handleBackend,
	handleCircuitBuild,
	handleCircuitImport,
	handleJob,
	handleSession,
	handleWorkload,
} from './operations';

export class IbmQuantum implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IBM Quantum (Unofficial)',
		name: 'ibmQuantum',
		icon: { light: 'file:ibmQuantum.svg', dark: 'file:ibmQuantum.dark.svg' },
		group: ['transform'],
		// Version 2 renames the session Mode parameter to sessionMode. Observed live on 0.4.1: n8n's
		// MCP server left a parameter named `mode` out of the type definition it hands AI workflow
		// builders, so on version 1 an agent could not choose between a batch and a dedicated session.
		// @n8n/workflow-sdk treats resource, operation and mode as discriminator fields, which is the
		// likely cause; the community node path was not traced end to end, so this records what was
		// seen rather than a documented n8n rule. Version 1 stays loadable and unchanged.
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Build, run and retrieve quantum circuits on the IBM Quantum Platform',
		documentationUrl: 'https://github.com/TuguiDragos/n8n-nodes-ibm-quantum#readme',
		defaults: { name: 'IBM Quantum' },
		usableAsTool: {
			replacements: {
				// The agent does not read this by default: descriptionType is 'auto', so n8n builds the
				// tool description per operation from its `action`. This is the node panel blurb.
				description:
					'Read and control IBM Quantum from an agent: list backends, check quota, submit transpiled circuits, and fetch job results',
			},
		},
		hints: [
			{
				message:
					'Get Results holds this execution open until the job finishes. Hardware queues can run for hours, so for anything but a quick run submit in one workflow and read the result in another, started by the IBM Quantum Trigger.',
				type: 'info',
				location: 'ndv',
				whenToDisplay: 'beforeExecution',
				displayCondition:
					'={{ $parameter["resource"] === "job" && $parameter["operation"] === "getResults" }}',
			},
			{
				message:
					'Real backends run only their own native gates. A circuit using h, cx, u, ry, swap or ccx fails with reason code 1517 unless you transpile it first, and a failed job still spends quota.',
				type: 'warning',
				location: 'ndv',
				whenToDisplay: 'beforeExecution',
				displayCondition:
					'={{ $parameter["resource"] === "job" && ["submitSampler", "submitEstimator"].includes($parameter["operation"]) }}',
			},
		],
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ibmQuantumApi', required: true }],
		properties: nodeProperties,
	};

	// Populates the Backend dropdowns. Every field keeps its plain-string value, so a
	// workflow saved before this existed still resolves, and the expression toggle still
	// takes a typed name when the list cannot be loaded.
	methods = {
		loadOptions: { getBackends },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Region and instance CRN are constant per credential, so build the request context once, on
		// first use.
		let ctx: RequestContext | null = null;

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let result: IDataObject;
				if (resource === 'circuit') {
					// Named explicitly for the same reason as the resource guard below: an unknown
					// operation must not quietly fall through to Build.
					if (operation === 'import') {
						result = handleCircuitImport.call(this, i);
					} else if (operation === 'build') {
						result = handleCircuitBuild.call(this, i);
					} else {
						throw new NodeOperationError(
							this.getNode(),
							`Unsupported circuit operation: ${operation}`,
							{ itemIndex: i },
						);
					}
				} else {
					if (ctx === null) {
						const credentials = await this.getCredentials('ibmQuantumApi');
						const problem = checkApiVersion(credentials.apiVersion);
						if (problem?.fatal) {
							throw new NodeOperationError(this.getNode(), problem.message, { itemIndex: i });
						}
						if (problem) this.logger.warn(problem.message);
						ctx = {
							baseUrl: getBaseUrl(credentials.region as string),
							instanceCrn: credentials.instanceCrn as string,
						};
					}
					if (resource === 'backend') {
						result = await handleBackend.call(this, ctx, operation, i);
					} else if (resource === 'session') {
						result = await handleSession.call(this, ctx, operation, i);
					} else if (resource === 'account') {
						result = await handleAccount.call(this, ctx, operation, i);
					} else if (resource === 'workload') {
						result = await handleWorkload.call(this, ctx, operation, i);
					} else if (resource === 'job') {
						result = await handleJob.call(this, ctx, operation, i);
					} else {
						// Named explicitly rather than defaulting to job, so a resource this dispatcher
						// does not know cannot quietly run a job operation of the same name.
						throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`, {
							itemIndex: i,
						});
					}
				}

				// Never emit a null item: n8n's engine reads json.$error off every result without a
				// null check, so one empty response would fail the whole execution.
				returnData.push({ json: result ?? {}, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: errorMessage(error) }, pairedItem: { item: i } });
					continue;
				}
				throw asNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
