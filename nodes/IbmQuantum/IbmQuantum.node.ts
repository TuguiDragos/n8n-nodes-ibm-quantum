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
		// Version 2 renames the session Mode parameter to sessionMode. n8n's MCP server treats a
		// parameter literally named `mode` as a node discriminator and drops it from the type
		// definitions it hands to AI workflow builders, so on version 1 an agent cannot choose
		// between a batch and a dedicated session. Version 1 stays loadable and unchanged.
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Build, run and retrieve quantum circuits on the IBM Quantum Platform',
		documentationUrl: 'https://github.com/TuguiDragos/n8n-nodes-ibm-quantum#readme',
		defaults: { name: 'IBM Quantum' },
		// n8n composes a tool description per operation from its action text and falls back to the
		// node description. The replacement is written for that fallback: it tells an agent which
		// calls are safe to make unprompted and why it cannot invent a circuit for real hardware.
		// The reference URL belongs here rather than in documentationUrl or the codex file, because
		// those two reach the editor UI only: n8n's MCP server hands a model the parameter
		// definitions and nothing else, so a link is reachable only if it sits in description text.
		usableAsTool: {
			replacements: {
				description:
					'Read and control IBM Quantum from an agent: list backends and pick the least busy one, read instance usage against the quota, check a job status, fetch results, and list jobs or workloads. Submitting a circuit needs an OpenQASM 3 string already transpiled for the target backend, because the Qiskit Runtime API does not transpile and rejects anything else, so submit only circuits supplied to you. Every operation, parameter, output shape and error code is documented at https://raw.githubusercontent.com/TuguiDragos/n8n-nodes-ibm-quantum/main/llms-full.txt',
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
						const problem = checkApiVersion(credentials.apiVersion);
						if (problem?.fatal) {
							throw new NodeOperationError(this.getNode(), problem.message, { itemIndex: i });
						}
						if (problem) this.logger.warn(problem.message);
						ctx = { baseUrl: getBaseUrl(credentials.region as string) };
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

				returnData.push({ json: result, pairedItem: { item: i } });
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
