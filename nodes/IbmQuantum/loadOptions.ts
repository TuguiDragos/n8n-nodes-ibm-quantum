import {
	NodeOperationError,
	type IDataObject,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
} from 'n8n-workflow';

import { checkApiVersion, enrichApiError, getBaseUrl } from './transport';

const REQUEST_TIMEOUT_MS = 30000;

// GET /backends already returns status and queue depth per device, so the label costs no extra
// call. The value stays the bare name, which is what every operation sends and what workflows
// saved before this dropdown existed already hold.
export function backendLabel(device: IDataObject): string {
	const name = String(device.name ?? '');
	const status = (device.status as IDataObject) ?? {};
	const parts: string[] = [];
	if (typeof status.name === 'string' && status.name !== '') parts.push(status.name);
	if (typeof device.queue_length === 'number') parts.push(`${device.queue_length} queued`);
	return parts.length > 0 ? `${name} (${parts.join(', ')})` : name;
}

export async function getBackends(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const credentials = await this.getCredentials('ibmQuantumApi');
	const problem = checkApiVersion(credentials.apiVersion);
	if (problem?.fatal) throw new NodeOperationError(this.getNode(), problem.message);

	let response: IDataObject;
	try {
		const body = (await this.helpers.httpRequestWithAuthentication.call(this, 'ibmQuantumApi', {
			method: 'GET',
			url: `${getBaseUrl(credentials.region as string)}/backends`,
			json: true,
			timeout: REQUEST_TIMEOUT_MS,
		})) as IDataObject | null;
		// An empty body arrives as null, same guard as transport.ts and triggerPoll.ts.
		response = body ?? {};
	} catch (error) {
		throw enrichApiError(this.getNode(), error);
	}

	const devices = Array.isArray(response.devices) ? (response.devices as unknown[]) : [];
	return devices
		.filter((device): device is IDataObject => device !== null && typeof device === 'object')
		.map((device) => ({ name: backendLabel(device), value: String(device.name ?? '') }))
		.filter((option) => option.value !== '')
		.sort((a, b) => a.value.localeCompare(b.value));
}
