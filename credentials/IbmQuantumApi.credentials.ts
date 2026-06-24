import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

export class IbmQuantumApi implements ICredentialType {
	name = 'ibmQuantumApi';

	displayName = 'IBM Quantum API';

	icon = { light: 'file:ibmQuantum.svg', dark: 'file:ibmQuantum.dark.svg' } as const;

	documentationUrl = 'https://quantum.cloud.ibm.com/docs/en/guides';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your IBM Cloud API key. Create one under Manage, Access (IAM), API keys in the IBM Cloud console. The node exchanges it for a short-lived access token automatically.',
		},
		{
			displayName: 'Instance CRN',
			name: 'instanceCrn',
			type: 'string',
			default: '',
			required: true,
			description:
				'Cloud Resource Name (CRN) of your Qiskit Runtime instance. Copy it from the instance details page in the IBM Quantum Platform console. It starts with crn:v1.',
		},
		{
			displayName: 'Region',
			name: 'region',
			type: 'options',
			options: [
				{ name: 'EU (Germany)', value: 'eu-de' },
				{ name: 'US East', value: 'us-east' },
			],
			default: 'us-east',
			description:
				'Region your IBM Quantum Platform instance was created in. This must match the region of the instance the CRN above belongs to.',
		},
		{
			displayName: 'API Version',
			name: 'apiVersion',
			type: 'string',
			default: '2026-04-15',
			description:
				'Date (YYYY-MM-DD) that selects the IBM API response format. Leave the default unless IBM docs require a newer version.',
		},
		// Filled in by preAuthentication; hidden from the form. The expirable flag is what
		// tells n8n to run preAuthentication at all. Without it n8n skips the token exchange,
		// leaving this empty so requests go out as "Bearer " and IBM rejects them.
		{
			displayName: 'Session Token',
			name: 'sessionToken',
			type: 'hidden',
			typeOptions: { password: true, expirable: true },
			default: '',
		},
	];

	// Exchange the API key for a short-lived IAM bearer token. n8n caches it and re-runs this
	// on a 401, so the token refreshes without manual expiry handling.
	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const options: IHttpRequestOptions = {
			method: 'POST',
			url: 'https://iam.cloud.ibm.com/identity/token',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
				apikey: credentials.apiKey as string,
			}).toString(),
		};

		let response: { access_token?: string };
		try {
			response = (await this.helpers.httpRequest(options)) as { access_token?: string };
		} catch {
			// The underlying error can carry the request body, which holds the API key. Never surface it.
			throw new Error(
				'IBM IAM token request failed. Check that the API key is valid and the account has IBM Quantum access.',
			);
		}
		if (!response?.access_token) {
			throw new Error('IBM IAM did not return an access token. Check that the API key is valid.');
		}
		return { sessionToken: response.access_token };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.sessionToken}}',
				'Service-CRN': '={{$credentials.instanceCrn}}',
				'IBM-API-Version': '={{$credentials.apiVersion}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				"={{$credentials.region === 'eu-de' ? 'https://eu-de.quantum.cloud.ibm.com' : 'https://quantum.cloud.ibm.com'}}/api/v1",
			url: '/backends',
		},
	};
}
