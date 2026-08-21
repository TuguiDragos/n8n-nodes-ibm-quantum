import type { ICredentialDataDecryptedObject, IHttpRequestHelper } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { IbmQuantumApi } from '../credentials/IbmQuantumApi.credentials';
import { CURRENT_API_VERSION, REGION_HOSTS } from '../nodes/IbmQuantum/transport';

const cred = new IbmQuantumApi();

describe('credential region/host sync (MAINT-01)', () => {
	it('keeps the region options and the test host mapping in sync with REGION_HOSTS', () => {
		const region = cred.properties.find((p) => p.name === 'region');
		const values = ((region?.options ?? []) as Array<{ value: string }>).map((o) => o.value).sort();
		expect(values).toEqual(Object.keys(REGION_HOSTS).sort());

		// The test request must reference every host, so a host change in one place cannot drift.
		const baseURL = (cred.test.request as { baseURL: string }).baseURL;
		for (const host of Object.values(REGION_HOSTS)) {
			expect(baseURL).toContain(host);
		}
	});

	// The credential ships the version as a literal default and the guard compares against its own
	// constant. Without this, a new IBM version could be adopted in one place and warn in the other.
	it('offers the version the guard treats as current', () => {
		const apiVersion = cred.properties.find((p) => p.name === 'apiVersion');
		expect(apiVersion?.default).toBe(CURRENT_API_VERSION);
		expect(apiVersion?.placeholder).toBe(CURRENT_API_VERSION);
	});
});

function preAuth(httpRequest: (options: unknown) => Promise<unknown>) {
	const ctx = { helpers: { httpRequest } } as unknown as IHttpRequestHelper;
	const credentials = {
		apiKey: 'SECRET_KEY_VALUE',
		instanceCrn: 'crn:v1:bluemix',
	} as unknown as ICredentialDataDecryptedObject;
	return cred.preAuthentication.call(ctx, credentials);
}

describe('preAuthentication token exchange and safe diagnostics (SEC-01)', () => {
	it('returns the access token as sessionToken on success', async () => {
		await expect(preAuth(async () => ({ access_token: 'tok-abc' }))).resolves.toEqual({
			sessionToken: 'tok-abc',
		});
	});

	it('throws when no access token comes back', async () => {
		await expect(preAuth(async () => ({}))).rejects.toThrow(/did not return an access token/);
	});

	it('adds an allowlisted hint for rate limiting, rejection and outage', async () => {
		await expect(
			preAuth(async () => {
				throw { response: { status: 429 } };
			}),
		).rejects.toThrow(/rate limited/);
		await expect(
			preAuth(async () => {
				throw { httpCode: 401 };
			}),
		).rejects.toThrow(/the API key was rejected/);
		await expect(
			preAuth(async () => {
				throw { response: { status: 503 } };
			}),
		).rejects.toThrow(/temporarily unavailable/);
	});

	it('surfaces IBM error code but never leaks the API key from the error', async () => {
		let message = '';
		try {
			await preAuth(async () => {
				// A real axios error can carry the request body (with the key) in message/config.
				throw {
					message: 'Request failed: apikey=SECRET_KEY_VALUE',
					response: { status: 400, data: { errorCode: 'BXNIM0415E' } },
				};
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('BXNIM0415E');
		expect(message).toContain('the API key was rejected');
		expect(message).not.toContain('SECRET_KEY_VALUE');
	});
});

// The authenticate block, the test request and the IAM call options were all executed by the suite
// but never asserted, so any of them could be deleted or mistyped and every test stayed green.
describe('the credential wires n8n up correctly (SEC-01)', () => {
	it('sends the three headers IBM requires on every request', () => {
		const headers = (cred.authenticate.properties as { headers: Record<string, string> }).headers;
		expect(headers.Authorization).toBe('=Bearer {{$credentials.sessionToken}}');
		expect(headers['Service-CRN']).toBe('={{$credentials.instanceCrn}}');
		expect(headers['IBM-API-Version']).toBe('={{$credentials.apiVersion}}');
	});

	it('declares generic authentication, which is what triggers header injection', () => {
		expect(cred.authenticate.type).toBe('generic');
	});

	// Without the expirable flag n8n skips preAuthentication entirely and the token stays empty,
	// so every request goes out as "Bearer " and IBM rejects it.
	it('keeps the session token hidden, secret and expirable', () => {
		const token = cred.properties.find((p) => p.name === 'sessionToken');
		expect(token?.type).toBe('hidden');
		expect(token?.typeOptions?.password).toBe(true);
		expect(token?.typeOptions?.expirable).toBe(true);
	});

	it('marks the API key as a password field so n8n masks it', () => {
		const apiKey = cred.properties.find((p) => p.name === 'apiKey');
		expect(apiKey?.typeOptions?.password).toBe(true);
		expect(apiKey?.required).toBe(true);
	});

	it('tests the connection against a real read-only endpoint', () => {
		const request = cred.test.request as { baseURL: string; url: string };
		expect(request.url).toBe('/backends');
		expect(request.baseURL).toContain('/api/v1');
	});

	it('exchanges the key at IBM IAM with the documented grant type', async () => {
		let sent: Record<string, unknown> = {};
		await preAuth(async (options) => {
			sent = options as Record<string, unknown>;
			return { access_token: 'tok' };
		});
		expect(sent.method).toBe('POST');
		expect(sent.url).toBe('https://iam.cloud.ibm.com/identity/token');
		expect((sent.headers as Record<string, string>)['Content-Type']).toBe(
			'application/x-www-form-urlencoded',
		);
		const body = new URLSearchParams(sent.body as string);
		expect(body.get('grant_type')).toBe('urn:ibm:params:oauth:grant-type:apikey');
		expect(body.get('apikey')).toBe('SECRET_KEY_VALUE');
	});

	it('never lets an unrecognised IBM error code into the message', async () => {
		let message = '';
		try {
			await preAuth(async () => {
				throw { response: { status: 400, data: { errorCode: 'not a code; drop table users' } } };
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('the API key was rejected');
		expect(message).not.toContain('drop table');
	});
});
