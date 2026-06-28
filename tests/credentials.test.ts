import type { ICredentialDataDecryptedObject, IHttpRequestHelper } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { IbmQuantumApi } from '../credentials/IbmQuantumApi.credentials';
import { REGION_HOSTS } from '../nodes/IbmQuantum/transport';

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
