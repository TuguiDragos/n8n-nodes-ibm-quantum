import type { INodeProperties } from 'n8n-workflow';

// Every gate carries whether IBM runs it untouched. Qiskit Runtime does not transpile, so a
// circuit built only from the 'runs as-is' gates needs no toolchain, and anything else is
// accepted, queued and then failed minutes later. Saying so in the dropdown is cheaper than
// letting someone find out from a job. The 'runs as-is' claim is measured against the Heron basis
// (cz, id, rx, rz, rzz, sx, x, plus measure, reset, delay and barrier as instructions), read live
// from ibm_kingston, ibm_fez and ibm_marrakesh; the submit warning itself uses the chosen backend's
// own basis_gates, so a Nighthawk device is judged by its own list. rzz joined the palette in
// 0.6.0: stdgates.inc has no definition for it and a bare call fails the job naming
// `gate 'rzz' is not defined`, so the builder writes Qiskit's own `gate rzz` block ahead of the
// program, the form measured to run. The reason code is not stable, so do not match on it: the
// identical bare program returned 1506 in the morning and 1603 in the evening of the same day on
// the same device.
const GATE_OPTIONS = [
	{
		name: 'Barrier',
		value: 'barrier',
		description: 'Directive, always accepted; leave Qubits empty to span the whole register',
	},
	{
		name: 'CCX / Toffoli',
		value: 'ccx',
		description: 'Transpile first: the chip does not implement this two-qubit gate directly',
	},
	{
		name: 'CNOT / CX',
		value: 'cx',
		description: 'Transpile first: the chip does not implement this two-qubit gate directly',
	},
	{
		name: 'Controlled RX',
		value: 'crx',
		description: 'Transpile first: the chip does not implement this two-qubit gate directly',
	},
	{
		name: 'Controlled RY',
		value: 'cry',
		description: 'Transpile first: the chip does not implement this two-qubit gate directly',
	},
	{
		name: 'Controlled RZ',
		value: 'crz',
		description: 'Transpile first: the chip does not implement this two-qubit gate directly',
	},
	{
		name: 'CZ',
		value: 'cz',
		description: 'Runs as-is: in the IBM basis, so no transpiler pass is needed',
	},
	{
		name: 'Delay',
		value: 'delay',
		description: 'Runs as-is: a native instruction that idles the qubit for the Duration given',
	},
	{
		name: 'Hadamard',
		value: 'h',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'Identity',
		value: 'id',
		description:
			'Accepted but emits nothing: stdgates defines it as U(0, 0, 0) and a job carrying it failed on Heron although IBM lists it as native',
	},
	{
		name: 'Measure',
		value: 'measure',
		description: 'Runs as-is: in the IBM basis, so no transpiler pass is needed',
	},
	{
		name: 'Phase',
		value: 'p',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'Reset',
		value: 'reset',
		description: 'Runs as-is: in the IBM basis, so no transpiler pass is needed',
	},
	{
		name: 'RX',
		value: 'rx',
		description:
			'Runs as-is on Heron, but it is a fractional gate: no Nighthawk, no gate twirling, no resilience level 2',
	},
	{
		name: 'RY',
		value: 'ry',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'RZ',
		value: 'rz',
		description: 'Runs as-is: in the IBM basis, so no transpiler pass is needed',
	},
	{
		name: 'RZZ',
		value: 'rzz',
		description:
			'Runs as-is on Heron for an angle in (0, pi/2], definition block included; a fractional gate, so no Nighthawk, no gate twirling, no resilience level 2',
	},
	{
		name: 'S',
		value: 's',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'S Dagger',
		value: 'sdg',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'Swap',
		value: 'swap',
		description: 'Transpile first: the chip does not implement this two-qubit gate directly',
	},
	// Added in 0.5.0 after being verified on ibm_fez: two in a row read 249 of 256 shots as 1,
	// which is X, and one alone reads a 47/53 split. stdgates.inc defines it, so the emitted
	// line is the bare form Qiskit writes for a transpiled circuit.
	{
		name: 'SX',
		value: 'sx',
		description: 'Runs as-is: in the IBM basis, so no transpiler pass is needed',
	},
	{
		name: 'T',
		value: 't',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'T Dagger',
		value: 'tdg',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'U',
		value: 'u',
		description: 'Transpile first: emitted as the uppercase builtin U, which hardware rejects',
	},
	{
		name: 'X',
		value: 'x',
		description: 'Runs as-is: in the IBM basis, so no transpiler pass is needed',
	},
	{
		name: 'Y',
		value: 'y',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
	{
		name: 'Z',
		value: 'z',
		description:
			'Transpile first: stdgates defines it through the builtin U, which hardware rejects',
	},
];

// Sampler and Estimator share the PUB shape and the V2 error-suppression toggles.
const SUBMIT_OPS = ['submitSampler', 'submitEstimator'];
// The noise learner joins them only for the job envelope: backend, circuit and the job-level
// fields. Its own options object is additionalProperties:false, so the toggles above stay out.
const ALL_SUBMIT_OPS = [...SUBMIT_OPS, 'submitNoiseLearner'];

export const nodeProperties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Account', value: 'account' },
			{ name: 'Backend', value: 'backend' },
			{ name: 'Circuit', value: 'circuit' },
			{ name: 'Job', value: 'job' },
			{ name: 'Session', value: 'session' },
			{ name: 'Workload', value: 'workload' },
		],
		default: 'job',
	},

	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get Account Configuration',
				value: 'getAccountConfiguration',
				action: 'Get the account configuration',
				description:
					'Per plan on the account this instance belongs to: usage limits, allowed backends, session TTLs and functions',
			},
			{
				name: 'Get API Versions',
				value: 'getApiVersions',
				action: 'Get the API versions IBM currently serves',
				description: 'List every IBM-API-Version and which one is still live',
			},
			{
				name: 'Get Configuration',
				value: 'getConfiguration',
				action: 'Get the instance configuration',
				description: 'Read the cost limit set on this instance',
			},
			{
				name: 'Get Instance',
				value: 'getInstance',
				action: 'Get the current instance details',
				description: 'Read the plan, limits and backends attached to this instance',
			},
			{
				name: 'Get Many Instances',
				value: 'getManyInstances',
				action: 'Get many instances on the account',
				description:
					'Every IBM Quantum instance the API key can see, with the cost limit and allowed backends of each, read from the IBM Cloud Resource Controller',
			},
			{
				name: 'Get Usage',
				value: 'getUsage',
				action: 'Get instance usage and allocation',
				description: 'Read seconds consumed against the quota for the current period',
			},
			{
				name: 'Get Usage Analytics',
				value: 'getAnalytics',
				action: 'Get usage analytics',
				description:
					'Totals for jobs, sessions and usage over a date range, with every usage and queue-time figure in milliseconds',
			},
			{
				name: 'Get Usage Analytics Filters',
				value: 'getAnalyticsFilters',
				action: 'Get the filter values available for usage analytics',
				description: 'The backend, plan and instance values the analytics filters accept',
			},
			{
				name: 'Get Usage Analytics Grouped',
				value: 'getAnalyticsGrouped',
				action: 'Get usage analytics grouped by a key',
				description:
					'The same totals, in milliseconds, split by backend, instance, plan, subscription or user',
			},
			{
				name: 'Get Usage Analytics Grouped by Date',
				value: 'getAnalyticsByDate',
				action: 'Get usage analytics grouped by date',
				description: 'The same totals as a time series, one point per day, in milliseconds',
			},
			{
				name: 'Set Cost Limit',
				value: 'setCostLimit',
				action: 'Set the instance cost limit',
				description:
					'Cap the QPU seconds this instance may spend, or clear the cap, through the IBM Cloud Resource Controller',
			},
		],
		default: 'getUsage',
	},

	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['backend'] } },
		options: [
			{
				name: 'Get Configuration',
				value: 'getConfiguration',
				action: 'Get backend configuration',
				description: 'Static device data: basis gates, coupling map and qubit count',
			},
			{
				name: 'Get Defaults',
				value: 'getDefaults',
				action: 'Get backend default settings',
				description: 'Pulse level defaults; every IBM Cloud device returns an empty object',
			},
			{
				name: 'Get Least Busy',
				value: 'getLeastBusy',
				action: 'Get the least busy backend',
				description: 'Pick the online device with the shortest queue',
			},
			{
				name: 'Get Many',
				value: 'list',
				action: 'Get many backends',
				description: 'Every device on this instance, with status, qubits and queue',
			},
			{
				name: 'Get Properties',
				value: 'getProperties',
				action: 'Get backend properties',
				description: 'Calibration data: gate errors, readout errors and timings',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get backend status',
				description: 'Live availability, queue depth and any operator message',
			},
		],
		default: 'list',
	},

	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['circuit'] } },
		options: [
			{
				name: 'Build',
				value: 'build',
				action: 'Build a circuit from gates',
				description: 'Assemble an OpenQASM 3 program from a gate list, validated locally',
			},
			{
				name: 'Import OpenQASM 3',
				value: 'import',
				action: 'Import an existing OPENQASM 3 circuit',
				description: 'Pass an existing OpenQASM 3 program through, header checked',
			},
		],
		default: 'build',
	},

	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['job'] } },
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				action: 'Cancel a job',
				description: 'Stop a queued or running job; queued jobs cost nothing',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a job',
				description: 'Remove a job and its results permanently',
			},
			{
				name: 'Get Logs',
				value: 'getLogs',
				action: 'Get the logs of a job',
				description: 'Read whatever the program wrote to the job log',
			},
			{
				name: 'Get Many',
				value: 'list',
				action: 'Get many jobs',
				description: 'Recent jobs, newest first, without their circuit payloads',
			},
			{
				name: 'Get Many Tags',
				value: 'listTags',
				action: 'Get many job tags',
				description: 'Search the tags in use; the term must be 3 to 100 characters',
			},
			{
				name: 'Get Metrics',
				value: 'getMetrics',
				action: 'Get timing and usage metrics of a job',
				description: 'Timestamps, QPU seconds charged and execution time',
			},
			{
				name: 'Get Results',
				value: 'getResults',
				action: 'Poll until the job finishes and retrieve its results',
				description: 'Wait for a terminal state, then parse counts or expectation values',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get the status of a job',
				description: 'The current state of a job, with the failure reason when it has one',
			},
			{
				name: 'Submit to Estimator',
				value: 'submitEstimator',
				action: 'Submit an already transpiled ISA circuit to the estimator primitive',
				description: 'Run a circuit and read expectation values of observables',
			},
			{
				name: 'Submit to Noise Learner',
				value: 'submitNoiseLearner',
				action: 'Submit an already transpiled ISA circuit to the noise learner program',
				description: 'Characterise the noise of a circuit layer',
			},
			{
				name: 'Submit to Sampler',
				value: 'submitSampler',
				action: 'Submit an already transpiled ISA circuit to the sampler primitive',
				description: 'Run a circuit and read measurement counts',
			},
			{
				name: 'Update Tags',
				value: 'updateTags',
				action: 'Replace the tags of a job',
				description: 'Replace the whole tag list on a job',
			},
		],
		default: 'submitSampler',
	},

	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['session'] } },
		options: [
			{
				name: 'Close',
				value: 'close',
				action: 'Close a session',
				description:
					'End the session at once: it stops accepting new jobs, queued jobs will not run, and a running job finishes. To let queued jobs drain first, use Set Accepting Jobs instead.',
			},
			{
				name: 'Create',
				value: 'create',
				action: 'Create a session or batch',
				description: 'Open a batch or dedicated session on one backend',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a session',
				description: 'Read a session state and its remaining time',
			},
			{
				name: 'Set Accepting Jobs',
				value: 'setAccepting',
				action: 'Set whether the session accepts new jobs',
				description: 'Stop a session taking new jobs; that ends it and it cannot reopen',
			},
		],
		default: 'create',
	},

	{
		displayName: 'Plan ID',
		name: 'planId',
		type: 'string',
		default: '',
		placeholder: 'e.g. 850b21a7-71de-4e53-9441-1abdd202f35d',
		description:
			'Return only the plan with this Global Catalog plan ID, the value Get Instance reports as plan_id. Leave empty for every plan the account holds.',
		displayOptions: { show: { resource: ['account'], operation: ['getAccountConfiguration'] } },
	},
	{
		displayName: 'Group By',
		name: 'groupBy',
		type: 'options',
		options: [
			{ name: 'Backend', value: 'backend' },
			{ name: 'Instance', value: 'instance' },
			{ name: 'Plan', value: 'plan' },
			{ name: 'Subscription ID', value: 'subscription_id' },
			{ name: 'User', value: 'user_id' },
		],
		default: 'backend',
		description: 'Key the usage totals are grouped by',
		displayOptions: { show: { resource: ['account'], operation: ['getAnalyticsGrouped'] } },
	},
	{
		displayName: 'Filters',
		name: 'analyticsFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: {
				resource: ['account'],
				operation: ['getAnalytics', 'getAnalyticsByDate', 'getAnalyticsGrouped'],
			},
		},
		options: [
			{
				displayName: 'Backend',
				name: 'backend',
				type: 'string',
				default: '',
				placeholder: 'e.g. ibm_kingston, ibm_fez',
				description: 'Only usage on these backends, comma-separated for several',
			},
			{
				displayName: 'Instance',
				name: 'instance',
				type: 'string',
				default: '',
				description:
					'Only usage on these instances, comma-separated for several. Defaults to the instances the credential can see.',
			},
			{
				displayName: 'Interval End',
				name: 'intervalEnd',
				type: 'dateTime',
				default: '',
				description: 'End of the reporting window',
			},
			{
				displayName: 'Interval Start',
				name: 'intervalStart',
				type: 'dateTime',
				default: '',
				description: 'Start of the reporting window',
			},
			{
				displayName: 'Plan',
				name: 'plan',
				type: 'string',
				default: '',
				placeholder: 'e.g. open, standard',
				description: 'Only usage on these plans, comma-separated for several',
			},
			{
				displayName: 'Simulators',
				name: 'simulators',
				type: 'boolean',
				default: true,
				description:
					'Whether to count simulator usage as well as real hardware. IBM retired its cloud simulators on 15 May 2024 but still accepts the filter, so for usage since then it changes nothing. Leave it on; only the opt-out is sent.',
			},
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'string',
				default: '',
				description: 'Only usage under these subscriptions, comma-separated for several',
			},
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				description: 'Only usage by these users, comma-separated for several',
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['account'], operation: ['getManyInstances'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['account'], operation: ['getManyInstances'], returnAll: [false] },
		},
	},
	{
		displayName: 'Plan',
		name: 'plan',
		type: 'options',
		options: [
			{ name: 'Any', value: '' },
			{ name: 'Flex', value: 'flex' },
			{ name: 'Open', value: 'open' },
			{ name: 'Pay-As-You-Go', value: 'pay-as-you-go' },
			{ name: 'Premium', value: 'premium' },
		],
		default: '',
		description:
			'Only instances on this plan. Each choice maps to the plan ID IBM publishes for the Resource Controller; Any sends no plan filter.',
		displayOptions: { show: { resource: ['account'], operation: ['getManyInstances'] } },
	},
	{
		displayName: 'Instance CRN',
		name: 'instanceCrn',
		type: 'string',
		default: '',
		placeholder: 'e.g. crn:v1:bluemix:public:quantum-computing:us-east:a/...',
		description:
			'CRN of the instance to change. Leave empty to use the instance in the credential, or set it, usually from Get Many Instances, to change another instance the API key may manage.',
		displayOptions: { show: { resource: ['account'], operation: ['setCostLimit'] } },
	},
	{
		displayName: 'Clear Limit',
		name: 'clearLimit',
		type: 'boolean',
		default: false,
		description:
			'Whether to remove the limit instead of setting one. When on, Cost Limit (Seconds) is ignored and instance_limit_seconds is sent as null.',
		displayOptions: { show: { resource: ['account'], operation: ['setCostLimit'] } },
	},
	{
		displayName: 'Cost Limit (Seconds)',
		name: 'instanceLimit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 600,
		description:
			'Total QPU seconds the instance may spend before IBM stops its jobs; a job still running is cancelled with "Ran too long". A whole number of at least 1; turn on Clear Limit to remove the cap instead. Sent to the IBM Cloud Resource Controller with a fresh timestamp, because IBM ignores a request identical to the previous one.',
		displayOptions: {
			show: { resource: ['account'], operation: ['setCostLimit'], clearLimit: [false] },
		},
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workload'] } },
		options: [
			{
				name: 'Get Many',
				value: 'list',
				action: 'Get many workloads',
				description: 'Jobs and sessions in one listing, with richer filters',
			},
		],
		default: 'list',
	},

	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		hint: 'Follows the next link IBM sends, 50 workloads per request, and stops after 20 pages, adding truncated: true to the output when more remain',
		displayOptions: { show: { resource: ['workload'], operation: ['list'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		// IBM caps this listing at 50, unlike the jobs listing which allows 200.
		typeOptions: { minValue: 1, maxValue: 50 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['workload'], operation: ['list'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'workloadFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['workload'], operation: ['list'] } },
		options: [
			{
				displayName: 'Backend Name or ID',
				name: 'backend',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getBackends' },
				default: '',
				description:
					'Only workloads that ran on this backend. The status and queue shown in the list are read once when the node opens; use Refresh List in the field menu to update them. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: 'Only workloads created after this time',
			},
			{
				displayName: 'Created Before',
				name: 'createdBefore',
				type: 'dateTime',
				default: '',
				description: 'Only workloads created before this time',
			},
			{
				displayName: 'Mode',
				name: 'workloadMode',
				type: 'options',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Batch', value: 'batch' },
					{ name: 'Job', value: 'job' },
					{ name: 'Session', value: 'session' },
				],
				default: '',
				description: 'Keep only standalone jobs, sessions or batches',
			},
			{
				displayName: 'Next Cursor',
				name: 'next',
				type: 'string',
				default: '',
				description:
					'The nextCursor value from a previous Get Many response, to fetch the following page. This listing pages by cursor rather than by offset.',
			},
			{
				displayName: 'Previous Cursor',
				name: 'previous',
				type: 'string',
				default: '',
				description:
					'The previousCursor value from a previous Get Many response, to fetch the preceding page',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Free-text match against workload IDs and tags',
			},
			{
				displayName: 'Sort',
				name: 'sort',
				type: 'options',
				options: [
					{ name: 'Newest First', value: '-createdAt' },
					{ name: 'Oldest First', value: 'createdAt' },
				],
				default: '-createdAt',
				description:
					'Order of the returned workloads. The node asks for newest first, matching Job Get Many; the API on its own would return oldest first.',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'multiOptions',
				options: [
					{ name: 'Canceled', value: 'canceled' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'In Progress', value: 'in_progress' },
					{ name: 'Pending', value: 'pending' },
				],
				default: [],
				description: 'Keep only workloads in these states',
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'e.g. experiment-7, vqe',
				description: 'Only workloads carrying these tags, comma-separated for several',
			},
		],
	},

	{
		displayName: 'Backend Name or ID',
		name: 'backendName',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getBackends' },
		required: true,
		default: '',
		description:
			'Name of the backend (a specific quantum device) to query. The status and queue shown in the list are read once when the node opens; use Refresh List in the field menu to update them. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				resource: ['backend'],
				operation: ['getConfiguration', 'getDefaults', 'getProperties', 'getStatus'],
			},
		},
	},
	{
		displayName: 'Calibration ID',
		name: 'calibrationId',
		type: 'string',
		default: '',
		description:
			'Optional ID of a past calibration, sent as calibration_id. Every job reports the calibration it ran with as calibration_id in the Submit response and in Job Get Status, so passing that value here reads the device as IBM had it calibrated for that job. Leave empty for the current calibration.',
		displayOptions: {
			show: { resource: ['backend'], operation: ['getConfiguration', 'getProperties'] },
		},
	},
	{
		displayName: 'Updated Before',
		name: 'updatedBefore',
		type: 'dateTime',
		default: '',
		description:
			'Optional cut-off, sent as updated_before: IBM returns the properties whose last_update_date is before this time. Leave empty for the latest calibration.',
		displayOptions: { show: { resource: ['backend'], operation: ['getProperties'] } },
	},
	{
		displayName: 'Minimum Qubits',
		name: 'minQubits',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		description: 'Only consider backends with at least this many qubits. Zero disables the filter.',
		displayOptions: { show: { resource: ['backend'], operation: ['getLeastBusy'] } },
	},
	{
		displayName: 'Include Simulators',
		name: 'includeSimulators',
		type: 'boolean',
		default: false,
		description:
			'Whether to keep devices IBM flags as simulators when choosing the least busy backend. Deprecated: IBM retired its cloud simulators on 15 May 2024, every device in the listing is real hardware, and the is_simulator field this reads is marked deprecated by IBM and due for removal. The toggle stays so saved workflows keep loading; with no simulator left it changes nothing.',
		displayOptions: { show: { resource: ['backend'], operation: ['getLeastBusy'] } },
	},
	{
		displayName: 'Rank By',
		name: 'rankBy',
		type: 'options',
		options: [
			{
				name: 'Estimated Wait (Average)',
				value: 'waitAverage',
				description:
					'Mean wait in seconds before jobs start running on the device, as IBM reports it',
			},
			{
				name: 'Estimated Wait (P50)',
				value: 'waitP50',
				description:
					'Median wait in seconds before jobs start running on the device, as IBM reports it',
			},
			{
				name: 'Estimated Wait (P95)',
				value: 'waitP95',
				description:
					'Wait in seconds that 95 percent of jobs on the device stay under before they start running',
			},
			{
				name: 'Queue Length',
				value: 'queueLength',
				description: 'Number of jobs ahead of yours, regardless of how fast the device drains them',
			},
		],
		default: 'queueLength',
		description:
			'What "least busy" means. Queue Length counts the jobs ahead of yours; the Estimated Wait options use the wait_time_seconds figures IBM reports per device, the wait before jobs start running, so a short queue on a slow device no longer wins. A device without the chosen figure sorts last, and ties fall back to queue length.',
		displayOptions: { show: { resource: ['backend'], operation: ['getLeastBusy'] } },
	},
	{
		displayName: 'Processor Family',
		name: 'processorFamily',
		type: 'string',
		default: '',
		placeholder: 'e.g. Heron',
		description:
			'Only consider backends of this processor family, compared case-insensitively with the family IBM reports for each device (Heron, Nighthawk). Leave empty for any family. The family decides the native gate set: Heron runs the fractional rx and rzz gates and Nighthawk does not, so a circuit that uses them belongs on Heron.',
		displayOptions: { show: { resource: ['backend'], operation: ['getLeastBusy'] } },
	},

	{
		displayName: 'Number of Qubits',
		name: 'numQubits',
		type: 'number',
		typeOptions: { minValue: 1 },
		required: true,
		default: 2,
		description: 'Size of the quantum register',
		displayOptions: { show: { resource: ['circuit'], operation: ['build'] } },
	},
	{
		displayName: 'Number of Classical Bits',
		name: 'numClbits',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 2,
		description: 'Size of the classical register used for measurement',
		displayOptions: { show: { resource: ['circuit'], operation: ['build'] } },
	},
	{
		displayName: 'Circuit Parameters',
		name: 'circuitParameters',
		type: 'string',
		default: '',
		placeholder: 'e.g. theta or theta,phi',
		description:
			'Comma-separated names of symbolic angles, each declared as an input float[64] line so the circuit is bound at submit time through the Parameters field of Submit to Sampler or Submit to Estimator. A declared name can stand in for any angle in the Parameters field of a gate. Leave empty for a fixed circuit.',
		displayOptions: { show: { resource: ['circuit'], operation: ['build'] } },
	},
	{
		displayName: 'Gates',
		name: 'gates',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		default: {},
		placeholder: 'Add Gate',
		displayOptions: { show: { resource: ['circuit'], operation: ['build'] } },
		options: [
			{
				name: 'gate',
				displayName: 'Gate',
				// Alphabetical by displayName, which n8n's own linter requires of a collection with five
				// or more fields; the ones after Gate are each shown only for the gates they belong to.
				values: [
					{
						displayName: 'Classical Bit',
						name: 'clbit',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 0,
						description: 'Target classical bit for the measure instruction',
						displayOptions: { show: { gate: ['measure'] } },
					},
					{
						displayName: 'Duration',
						name: 'duration',
						type: 'string',
						required: true,
						default: '',
						placeholder: 'e.g. 100ns or 160dt',
						description:
							'How long the qubit idles, as a number followed by a unit: ns, us, ms, s, or dt for the backend sample time. A dt count must be a whole number.',
						displayOptions: { show: { gate: ['delay'] } },
					},
					{
						displayName: 'Gate',
						name: 'gate',
						type: 'options',
						default: 'h',
						options: GATE_OPTIONS,
						description:
							'Gate or instruction to append. Identity is accepted but emits nothing: the OpenQASM 3 standard library defines it as U(0, 0, 0), and a job carrying it failed on IBM hardware although IBM lists it as native, so it is dropped and instructionCount in the output counts what is emitted.',
					},
					{
						displayName: 'Parameters',
						name: 'params',
						type: 'string',
						default: '',
						placeholder: 'e.g. 1.5708 or theta or 0.1,0.2,0.3',
						description:
							'Comma-separated angles in radians, or names declared in Circuit Parameters. One value for RX/RY/RZ/RZZ/Phase/Controlled-R gates; exactly three (theta, phi, lambda) for the U gate.',
						displayOptions: {
							show: { gate: ['rx', 'ry', 'rz', 'rzz', 'p', 'crx', 'cry', 'crz', 'u'] },
						},
					},
					{
						displayName: 'Qubits',
						name: 'qubits',
						type: 'string',
						required: true,
						default: '',
						placeholder: 'e.g. 0 or 0,1 or 0,1,2',
						description:
							'Comma-separated qubit indices. For controlled gates the control comes first and the target last (e.g. 0,1 = control 0, target 1). Leave empty only for a full-width barrier.',
					},
				],
			},
		],
	},

	{
		displayName: 'OpenQASM 3 Circuit',
		name: 'qasm3Input',
		type: 'string',
		typeOptions: { rows: 8 },
		required: true,
		default: '',
		description: 'An existing OpenQASM 3 program to pass through',
		displayOptions: { show: { resource: ['circuit'], operation: ['import'] } },
	},

	{
		displayName: 'Backend Name or ID',
		name: 'backend',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getBackends' },
		required: true,
		default: '',
		description:
			'Backend that will run the circuit. The circuit must already be transpiled (ISA) for this backend; the Qiskit Runtime API does not transpile. It does not reject a non-native circuit either: it accepts the job, queues it, and fails it minutes later, charging about two seconds of QPU time. The status and queue shown in the list are read once when the node opens; use Refresh List in the field menu to update them. For an OpenQASM 3 circuit the node reads the configuration of this backend once per submit and warns, without blocking, about instructions outside its basis gates and supported instructions, and about two-qubit gates on pairs its coupling map does not connect. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'Circuit Format',
		name: 'circuitFormat',
		type: 'options',
		options: [
			{ name: 'OpenQASM 3', value: 'qasm3' },
			{ name: 'QPY (Base64)', value: 'qpy' },
		],
		default: 'qasm3',
		description:
			"Format the circuit is written in. OpenQASM 3 is the text form this node builds and most people paste. QPY is Qiskit's binary format, base64 encoded, which preserves circuits OpenQASM 3 cannot express.",
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'OpenQASM 3 Circuit',
		name: 'qasm3',
		type: 'string',
		typeOptions: { rows: 8 },
		required: true,
		default: '',
		description:
			'Circuit to submit, as an ISA (backend-native) OpenQASM 3 string. Use an expression to reference a Circuit node output.',
		displayOptions: {
			show: { resource: ['job'], operation: ALL_SUBMIT_OPS, circuitFormat: ['qasm3'] },
		},
	},
	{
		displayName: 'QPY Circuit',
		name: 'qpyCircuit',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		placeholder: 'e.g. eJwL9Az2...',
		description:
			'Circuit to submit, as QPY that is zlib compressed and then base64 encoded, which is the form IBM decompresses on arrival. In Python: dump with qiskit.qpy.dump(circuit, buffer), then base64.b64encode(zlib.compress(buffer.getvalue())). Base64 of the raw QPY bytes is rejected. The circuit must already be transpiled (ISA) for the chosen backend.',
		displayOptions: {
			show: { resource: ['job'], operation: ALL_SUBMIT_OPS, circuitFormat: ['qpy'] },
		},
	},
	{
		displayName: 'Parameters',
		name: 'parameters',
		type: 'json',
		default: '{}',
		placeholder: 'e.g. { "theta": 1.5708 }',
		description:
			'Optional bindings for a parametrized circuit. Either a JSON object mapping parameter names to values, such as {"theta": 3.14159}, or a bare array of values, such as [3.14159], matched to the parameter names sorted by name rather than to the order the program declares them. Both were verified to run on a circuit with one parameter; use the object form when the circuit declares more than one. Leave empty for a fixed circuit.',
		displayOptions: { show: { resource: ['job'], operation: SUBMIT_OPS } },
	},
	{
		displayName: 'Shots',
		name: 'shots',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 1024,
		description: 'Number of repetitions of the circuit',
		displayOptions: { show: { resource: ['job'], operation: ['submitSampler'] } },
	},
	{
		displayName: 'Observables',
		name: 'observables',
		type: 'json',
		default: '"ZZ"',
		description:
			'Quantity the Estimator measures, written as a Pauli string of the letters I, X, Y and Z (one per qubit, e.g. "ZZ"). Provide a single string or a JSON array of strings; each must match the number of qubits in the circuit (the length is validated by IBM at submit time).',
		displayOptions: { show: { resource: ['job'], operation: ['submitEstimator'] } },
	},
	{
		displayName: 'Resilience Level',
		name: 'resilienceLevel',
		type: 'options',
		options: [
			{ name: '0 (No Error Mitigation)', value: 0 },
			{ name: '1 (Minimal)', value: 1 },
			{ name: '2 (Medium)', value: 2 },
		],
		default: 1,
		description:
			'Error mitigation level applied by the Estimator. Higher levels reduce noise at the cost of more runtime.',
		displayOptions: { show: { resource: ['job'], operation: ['submitEstimator'] } },
	},
	{
		displayName: 'Precision',
		name: 'precision',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 6 },
		default: 0,
		description: 'Target precision for the Estimator. Leave at 0 to use the backend default.',
		displayOptions: { show: { resource: ['job'], operation: ['submitEstimator'] } },
	},
	{
		displayName: 'Default Precision',
		name: 'defaultPrecision',
		type: 'number',
		typeOptions: { minValue: 0, numberPrecision: 6 },
		default: 0,
		description:
			'Precision the Estimator applies to a PUB that sets none, sent as options.default_precision. Leave at 0 to omit it. Precision above, when set, travels with every PUB and overrides this.',
		displayOptions: { show: { resource: ['job'], operation: ['submitEstimator'] } },
	},
	{
		displayName: 'Seed Estimator',
		name: 'seedEstimator',
		type: 'string',
		default: '',
		placeholder: 'e.g. 42',
		description:
			'Whole number between 0 and 2147483647 that seeds the sampling inside the Estimator, sent as options.seed_estimator, so a run can be repeated. Leave empty to let IBM choose; 0 is a real seed and is sent.',
		displayOptions: { show: { resource: ['job'], operation: ['submitEstimator'] } },
	},
	{
		displayName: 'Dynamical Decoupling',
		name: 'dynamicalDecoupling',
		type: 'boolean',
		default: false,
		description: 'Whether to apply dynamical decoupling to idle qubits to reduce decoherence noise',
		displayOptions: { show: { resource: ['job'], operation: SUBMIT_OPS } },
	},
	{
		displayName: 'Gate Twirling',
		name: 'twirlingGates',
		type: 'boolean',
		default: false,
		description:
			'Whether to apply Pauli twirling to gates to suppress coherent errors. Leave this off for a circuit containing fractional gates such as a parametrised RX or RZZ, including anything Qiskit transpiles for a Heron processor: IBM rejects that combination with "gate twirling does not support fractional gates". Measurement twirling has no such restriction.',
		displayOptions: { show: { resource: ['job'], operation: SUBMIT_OPS } },
	},
	{
		displayName: 'Measurement Twirling',
		name: 'twirlingMeasure',
		type: 'boolean',
		default: false,
		description: 'Whether to apply twirling to measurements to suppress readout errors',
		displayOptions: { show: { resource: ['job'], operation: SUBMIT_OPS } },
	},
	{
		displayName: 'Dynamical Decoupling Options',
		name: 'dynamicalDecouplingOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		description:
			'Refines the Dynamical Decoupling toggle above and applies when dynamical decoupling is on. Each entry is sent under options.dynamical_decoupling.',
		displayOptions: { show: { resource: ['job'], operation: SUBMIT_OPS } },
		options: [
			{
				displayName: 'Extra Slack Distribution',
				name: 'extraSlackDistribution',
				type: 'options',
				options: [
					{ name: 'Edges', value: 'edges' },
					{ name: 'Middle', value: 'middle' },
				],
				default: 'middle',
				description:
					'Where the timing slack left over from rounding delays to the device clock is placed',
			},
			{
				displayName: 'Scheduling Method',
				name: 'schedulingMethod',
				type: 'options',
				options: [
					{ name: 'ALAP', value: 'alap' },
					{ name: 'ASAP', value: 'asap' },
				],
				default: 'alap',
				description:
					'Schedule gates as late as possible (ALAP) or as soon as possible (ASAP) before the decoupling sequence is inserted',
			},
			{
				displayName: 'Sequence Type',
				name: 'sequenceType',
				type: 'options',
				options: [
					{ name: 'XX', value: 'XX' },
					{ name: 'XpXm', value: 'XpXm' },
					{ name: 'XY4', value: 'XY4' },
				],
				default: 'XX',
				description: 'Pulse sequence inserted on idle qubits',
			},
			{
				displayName: 'Skip Reset Qubits',
				name: 'skipResetQubits',
				type: 'boolean',
				default: true,
				description:
					'Whether to leave alone the idle periods that immediately follow a reset or initialisation, since a qubit fresh in the ground state has nothing to protect',
			},
		],
	},
	{
		displayName: 'Twirling Options',
		name: 'twirlingOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		description:
			'Refines Gate Twirling and Measurement Twirling above, and matters wherever twirling is on, including at Estimator Resilience Level 2, where IBM turns it on itself. Each entry is sent under options.twirling.',
		displayOptions: { show: { resource: ['job'], operation: SUBMIT_OPS } },
		options: [
			{
				displayName: 'Number of Randomizations',
				name: 'numRandomizations',
				type: 'string',
				default: 'auto',
				placeholder: 'e.g. 32',
				description:
					'How many random twirled copies of each circuit to run: a whole number of at least 1, or the word auto to let IBM choose. Randomizations multiply the shots, so this is the quickest way to spend quota.',
			},
			{
				displayName: 'Shots per Randomization',
				name: 'shotsPerRandomization',
				type: 'string',
				default: 'auto',
				placeholder: 'e.g. 64',
				description:
					'Shots run for each twirled copy: a whole number of at least 1, or the word auto to let IBM choose',
			},
			{
				displayName: 'Strategy',
				name: 'strategy',
				type: 'options',
				options: [
					{ name: 'Active', value: 'active' },
					{ name: 'Active Accum', value: 'active-accum' },
					{ name: 'Active Circuit', value: 'active-circuit' },
					{ name: 'All', value: 'all' },
				],
				default: 'active-accum',
				description:
					'Which qubits are twirled in each layer of two-qubit gates: only those the layer touches, those touched so far, every qubit the circuit uses, or all qubits',
			},
		],
	},
	{
		displayName: 'Execution Options',
		name: 'executionOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		description: 'How the device runs each shot. Each entry is sent under options.execution.',
		displayOptions: { show: { resource: ['job'], operation: SUBMIT_OPS } },
		options: [
			{
				displayName: 'Initialize Qubits',
				name: 'initQubits',
				type: 'boolean',
				default: true,
				description:
					'Whether to reset every qubit to the ground state before each shot. IBM does this by default; turning it off is for experiments that deliberately start from the previous shot.',
			},
			{
				displayName: 'Measurement Type',
				name: 'measType',
				type: 'options',
				options: [
					{ name: 'Averaged Kerneled', value: 'avg_kerneled' },
					{ name: 'Classified', value: 'classified' },
					{ name: 'Kerneled', value: 'kerneled' },
				],
				default: 'classified',
				description:
					'How measurement results are processed before they are returned: classified into bits, kerneled into raw IQ values per shot, or kerneled and averaged over the shots. Sampler only; Get Results parses classified output.',
				displayOptions: { show: { '/operation': ['submitSampler'] } },
			},
			{
				displayName: 'Repetition Delay (Seconds)',
				name: 'repDelay',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 6 },
				default: 0.00025,
				description:
					'Delay in seconds between the end of one circuit and the start of the next within the shot loop, sent as options.execution.rep_delay. Adding this entry sends the value shown, so the default goes out unless you change it. IBM requires a value inside the rep_delay_range of the backend and uses its default_rep_delay when the entry is absent.',
			},
		],
	},
	{
		displayName: 'Resilience Options',
		name: 'resilienceOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		description:
			'Fine-tunes the error mitigation that Resilience Level switches on. Each entry is sent under options.resilience and wins over the same key in Additional Options.',
		displayOptions: { show: { resource: ['job'], operation: ['submitEstimator'] } },
		options: [
			{
				displayName: 'Measurement Mitigation',
				name: 'measureMitigation',
				type: 'boolean',
				default: true,
				description:
					'Whether to correct readout errors with measurement error mitigation (TREX), sent as resilience.measure_mitigation. Safe with fractional gates.',
			},
			{
				displayName: 'Noise Learning Layer Pair Depths',
				name: 'noiseLearningLayerPairDepths',
				type: 'string',
				default: '',
				placeholder: 'e.g. 0, 1, 2, 4, 16, 32',
				description:
					'Circuit depths, in gate pairs, used by the layer noise learning that PEC and PEA rely on, comma-separated whole numbers sent as resilience.layer_noise_learning.layer_pair_depths',
			},
			{
				displayName: 'Noise Learning Max Layers',
				name: 'noiseLearningMaxLayers',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Maximum number of unique entangling layers the noise learning characterises, sent as resilience.layer_noise_learning.max_layers_to_learn. Zero leaves the choice to IBM.',
			},
			{
				displayName: 'Noise Learning Randomizations',
				name: 'noiseLearningRandomizations',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Random circuits per learning configuration, sent as resilience.layer_noise_learning.num_randomizations. Zero leaves the choice to IBM.',
			},
			{
				displayName: 'Noise Learning Shots per Randomization',
				name: 'noiseLearningShotsPerRandomization',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Shots per random learning circuit, sent as resilience.layer_noise_learning.shots_per_randomization. Zero leaves the choice to IBM.',
			},
			{
				displayName: 'PEC Max Overhead',
				name: 'pecMaxOverhead',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 100,
				description:
					'Largest sampling overhead probabilistic error cancellation may spend, sent as resilience.pec.max_overhead. Zero removes the cap, which the schema spells as null.',
			},
			{
				displayName: 'PEC Mitigation',
				name: 'pecMitigation',
				type: 'boolean',
				default: false,
				description:
					'Whether to turn on probabilistic error cancellation, sent as resilience.pec_mitigation. IBM refuses it on a circuit containing fractional gates, meaning a parametrised RX or RZZ.',
			},
			{
				displayName: 'PEC Noise Gain',
				name: 'pecNoiseGain',
				type: 'string',
				default: 'auto',
				placeholder: 'e.g. 1',
				description:
					'Noise gain used by probabilistic error cancellation, sent as resilience.pec.noise_gain: a number of at least 0, or the word auto to let IBM choose',
			},
			{
				displayName: 'ZNE Amplifier',
				name: 'zneAmplifier',
				type: 'options',
				options: [
					{ name: 'Gate Folding', value: 'gate_folding' },
					{ name: 'Gate Folding Back', value: 'gate_folding_back' },
					{ name: 'Gate Folding Front', value: 'gate_folding_front' },
					{ name: 'PEA', value: 'pea' },
				],
				default: 'gate_folding',
				description:
					'How zero noise extrapolation amplifies the noise, sent as resilience.zne.amplifier. PEA (probabilistic error amplification) learns the noise first and is refused on a circuit containing fractional gates.',
			},
			{
				displayName: 'ZNE Extrapolator',
				name: 'zneExtrapolator',
				type: 'multiOptions',
				options: [
					{ name: 'Double Exponential', value: 'double_exponential' },
					{ name: 'Exponential', value: 'exponential' },
					{ name: 'Fallback', value: 'fallback' },
					{ name: 'Linear', value: 'linear' },
					{ name: 'Polynomial Degree 1', value: 'polynomial_degree_1' },
					{ name: 'Polynomial Degree 2', value: 'polynomial_degree_2' },
					{ name: 'Polynomial Degree 3', value: 'polynomial_degree_3' },
					{ name: 'Polynomial Degree 4', value: 'polynomial_degree_4' },
					{ name: 'Polynomial Degree 5', value: 'polynomial_degree_5' },
					{ name: 'Polynomial Degree 6', value: 'polynomial_degree_6' },
					{ name: 'Polynomial Degree 7', value: 'polynomial_degree_7' },
				],
				default: [],
				description:
					'Fits tried in order for zero noise extrapolation, sent as resilience.zne.extrapolator. Leave empty for the IBM default.',
			},
			{
				displayName: 'ZNE Mitigation',
				name: 'zneMitigation',
				type: 'boolean',
				default: false,
				description:
					'Whether to turn on zero noise extrapolation, sent as resilience.zne_mitigation. Resilience Level 2 already enables it together with gate twirling.',
			},
			{
				displayName: 'ZNE Noise Factors',
				name: 'zneNoiseFactors',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1, 3, 5',
				description:
					'Noise amplification factors zero noise extrapolation measures at, comma-separated numbers sent as resilience.zne.noise_factors',
			},
		],
	},
	{
		displayName: 'Session ID',
		name: 'submitSessionId',
		type: 'string',
		default: '',
		description:
			'Optional session or batch ID (from Session Create) to run this job inside, for low-latency consecutive execution',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'Calibration ID',
		name: 'submitCalibrationId',
		type: 'string',
		default: '',
		description:
			'Optional ID of the calibration the job should run with, sent as calibration_id. IBM accepts 1 to 100 characters; the node refuses a longer value before submitting. Leave empty to run on the current calibration. Either way the job reports the calibration it actually used as calibration_id in the response and in Job Get Status.',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'Max Cost (Seconds)',
		name: 'maxCost',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 10800 },
		default: 0,
		description:
			'Maximum runtime seconds this job may consume before IBM cancels it. IBM allows at most 10800 (three hours) and caps anything higher. Zero omits the field, and IBM then stamps the job with the plan maximum, which on the Open plan is the entire 600 second allowance for the 28 day window. Set a real number to stop one runaway job from spending all of it.',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'Tags',
		name: 'jobTags',
		type: 'string',
		default: '',
		placeholder: 'e.g. experiment-7, vqe',
		description:
			'Comma-separated tags stored on the job. Jobs can then be filtered by tag in the Get Many operation and the triggers. On Update Tags an empty value clears all tags.',
		displayOptions: { show: { resource: ['job'], operation: [...ALL_SUBMIT_OPS, 'updateTags'] } },
	},
	{
		displayName: 'Private',
		name: 'privateJob',
		type: 'boolean',
		default: false,
		description:
			'Whether to mark the job private, hiding its input and results from other collaborators on the instance. Requires a plan that supports private jobs. IBM deletes the input once the job completes and the results once they have been read, so Get Results carries the shots exactly once and a second read finds nothing.',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'Additional Options',
		name: 'additionalOptions',
		type: 'json',
		default: '{}',
		description:
			'Advanced JSON options merged into the primitive options block, for example {"execution": {"rep_delay": 0.00025}} on Sampler or Estimator. Most workflows can leave this as {}. Only the top-level keys IBM lists for the chosen program are accepted, and an unknown one is refused before the job is sent, with the allowed keys named. There is no environment key in the REST API: log_level, tags and private are the Log Level, Tags and Private fields of this operation. Anything a dedicated field controls wins over what is written here: the Shots field is sent with the circuit and overrides default_shots, the three error suppression toggles overwrite their own keys, and every entry of the option collections overwrites the same key inside this JSON while leaving its siblings alone. See the IBM Qiskit Runtime primitive options documentation.',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},

	{
		displayName: 'Search',
		name: 'tagSearch',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. experiment',
		description:
			'Substring the returned tags must contain, between 3 and 100 characters. IBM has no way to list every tag, so a term is always required.',
		displayOptions: { show: { resource: ['job'], operation: ['listTags'] } },
	},
	{
		displayName: 'Noise Learner Options',
		name: 'noiseLearnerOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['job'], operation: ['submitNoiseLearner'] } },
		options: [
			{
				displayName: 'Layer Pair Depths',
				name: 'layerPairDepths',
				type: 'string',
				default: '',
				placeholder: 'e.g. 0, 1, 2, 4, 16, 32',
				description:
					'Circuit depths, measured in number of gate pairs, to use in the learning experiments. Comma-separated.',
			},
			{
				displayName: 'Max Layers to Learn',
				name: 'maxLayersToLearn',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Maximum number of unique entangling layers to characterise. Zero leaves the choice to IBM.',
			},
			{
				displayName: 'Number of Randomizations',
				name: 'numRandomizations',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Number of random circuits per learning circuit configuration. Zero leaves the choice to IBM.',
			},
			{
				displayName: 'Shots per Randomization',
				name: 'shotsPerRandomization',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description:
					'Shots to use per random learning circuit. Zero leaves the choice to IBM. Raising this and the randomizations count is what makes a learning job expensive.',
			},
			{
				displayName: 'Twirling Strategy',
				name: 'twirlingStrategy',
				type: 'options',
				options: [
					{ name: 'Active', value: 'active' },
					{ name: 'Active Accum', value: 'active-accum' },
					{ name: 'Active Circuit', value: 'active-circuit' },
					{ name: 'All', value: 'all' },
				],
				default: 'active-accum',
				description: 'How qubits are twirled in the identified layers of two-qubit gates',
			},
		],
	},
	{
		displayName: 'Log Level',
		name: 'logLevel',
		type: 'options',
		options: [
			{ name: 'Critical', value: 'critical' },
			{ name: 'Debug', value: 'debug' },
			{ name: 'Default', value: '' },
			{ name: 'Error', value: 'error' },
			{ name: 'Info', value: 'info' },
			{ name: 'Warning', value: 'warning' },
		],
		default: '',
		description:
			'Verbosity IBM records for this job, readable afterwards with Get Logs. Leave on Default unless you are debugging a failure.',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},

	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		required: true,
		default: '',
		description:
			'ID of the job to act on, as returned by the Submit operation. Usually set with an expression referencing a previous IBM Quantum node.',
		displayOptions: {
			show: {
				resource: ['job'],
				operation: [
					'getStatus',
					'getResults',
					'getLogs',
					'getMetrics',
					'updateTags',
					'cancel',
					'delete',
				],
			},
		},
	},
	{
		displayName: 'Include Circuit Params',
		name: 'includeParams',
		type: 'boolean',
		default: true,
		description:
			"Whether to return the job's submitted params (the circuit) alongside its state, which is what this operation has always returned. Turn it off for a lighter read when only the status matters, for example inside a loop or from an AI Agent.",
		displayOptions: { show: { resource: ['job'], operation: ['getStatus'] } },
	},
	{
		displayName: 'Poll Interval (Seconds)',
		name: 'pollInterval',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 5,
		description: 'Seconds to wait between status checks while the job runs',
		displayOptions: { show: { resource: ['job'], operation: ['getResults'] } },
	},
	{
		displayName: 'Max Wait (Seconds)',
		name: 'maxWait',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 300,
		description:
			'Maximum seconds to wait for the job to finish. Reaching it is not an error: the node returns the item with timedOut set to true and the job keeps running on IBM, so read it later with Get Results. Real hardware queues can be long, so raise this for production runs or poll separately with Get Status.',
		displayOptions: { show: { resource: ['job'], operation: ['getResults'] } },
	},
	{
		displayName: 'Register Name',
		name: 'registerName',
		type: 'string',
		default: '',
		description:
			'Optional classical register name to read counts from. Detected automatically when empty. A name no pub in the result carries does not fail the item, because the results have been downloaded by then and IBM serves a private job once: the counts come back with registerError naming the registers that are there, and every pub that read another register is marked registerFallback. A plain result body carrying no classical register at all, an estimator result from a job submitted here for one, ignores the name and reports nothing; a job submitted from Qiskit comes back in the serialized encoding, where the names compared are the PUB field names.',
		displayOptions: { show: { resource: ['job'], operation: ['getResults'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		hint: 'Walks the listing 200 jobs per request from the Offset filter and stops after 50 pages, adding truncated: true to the output when more remain',
		displayOptions: { show: { resource: ['job'], operation: ['list'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		// IBM caps GET /jobs at 200 and silently substitutes its own default for anything outside
		// the range, so the ceiling is worth showing in the UI rather than hiding.
		typeOptions: { minValue: 1, maxValue: 200 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['job'], operation: ['list'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'listFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['job'], operation: ['list'] } },
		options: [
			{
				displayName: 'Backend Name or ID',
				name: 'backend',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getBackends' },
				default: '',
				description:
					'Only jobs that ran on this backend. The status and queue shown in the list are read once when the node opens; use Refresh List in the field menu to update them. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: 'Only jobs created after this time',
			},
			{
				displayName: 'Created Before',
				name: 'createdBefore',
				type: 'dateTime',
				default: '',
				description: 'Only jobs created before this time',
			},
			{
				displayName: 'Include Circuit Params',
				name: 'includeParams',
				type: 'boolean',
				default: false,
				description:
					"Whether to include each job's full submitted params (the circuit) in the response. Off keeps the listing small.",
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'Number of jobs to skip, for paging through older jobs',
			},
			{
				displayName: 'Program',
				name: 'program',
				type: 'options',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Estimator', value: 'estimator' },
					{ name: 'Noise Learner', value: 'noise-learner' },
					{ name: 'Sampler', value: 'sampler' },
				],
				default: '',
				description: 'Only jobs submitted to this program',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				description: 'Only jobs that ran inside this session or batch',
			},
			{
				displayName: 'Sort',
				name: 'sort',
				type: 'options',
				options: [
					{ name: 'Newest First', value: 'desc' },
					{ name: 'Oldest First', value: 'asc' },
				],
				default: 'desc',
				description: 'Order of the returned jobs',
			},
			{
				displayName: 'Status',
				name: 'pending',
				type: 'options',
				options: [
					{ name: 'All', value: 'all' },
					{ name: 'Only Finished', value: 'finished' },
					{ name: 'Only Pending', value: 'pending' },
				],
				default: 'all',
				description: 'Keep all jobs, only finished ones, or only queued and running ones',
			},
			{
				displayName: 'Tags',
				name: 'tag',
				type: 'string',
				default: '',
				placeholder: 'e.g. experiment-7, vqe',
				description:
					'Only jobs carrying these tags. Comma-separated for several, up to the eight the API accepts. A job must carry all of them to match.',
			},
		],
	},

	{
		displayName: 'Mode',
		name: 'mode',
		type: 'options',
		options: [
			{ name: 'Batch', value: 'batch' },
			{ name: 'Dedicated', value: 'dedicated' },
		],
		default: 'batch',
		description:
			'Batch queues jobs to run consecutively without interactive priority, and is the only mode the Open (free) plan allows. Dedicated reserves the QPU for back-to-back jobs (best for VQE and QAOA loops) and requires a paid plan.',
		// Kept for workflows saved on version 1, where this is the name their value sits under.
		displayOptions: { show: { resource: ['session'], operation: ['create'], '@version': [1] } },
	},
	{
		displayName: 'Mode',
		name: 'sessionMode',
		type: 'options',
		options: [
			{ name: 'Batch', value: 'batch' },
			{ name: 'Dedicated', value: 'dedicated' },
		],
		default: 'batch',
		description:
			'Batch queues jobs to run consecutively without interactive priority, and is the only mode the Open (free) plan allows. Dedicated reserves the QPU for back-to-back jobs (best for VQE and QAOA loops) and requires a paid plan.',
		displayOptions: { show: { resource: ['session'], operation: ['create'], '@version': [2] } },
	},
	{
		displayName: 'Backend Name or ID',
		name: 'sessionBackend',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getBackends' },
		required: true,
		default: '',
		description:
			'Backend the session reserves for its jobs. The status and queue shown in the list are read once when the node opens; use Refresh List in the field menu to update them. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['session'], operation: ['create'] } },
	},
	{
		displayName: 'Max TTL (Seconds)',
		name: 'maxTtl',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 28800,
		description:
			'Maximum session lifetime in seconds, sent as max_ttl. IBM caps it by plan: 10 minutes (600) on the Open plan, 8 hours (28800, the default here) on paid plans. Zero omits the field and lets IBM apply the plan default.',
		displayOptions: { show: { resource: ['session'], operation: ['create'] } },
	},
	{
		displayName: 'Session ID',
		name: 'sessionId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the session, as returned by Session Create',
		displayOptions: {
			show: { resource: ['session'], operation: ['get', 'setAccepting', 'close'] },
		},
	},
	{
		displayName: 'Accepting Jobs',
		name: 'acceptingJobs',
		type: 'boolean',
		default: true,
		description:
			'Whether the session keeps accepting new jobs. Set to false to stop it taking work; it closes once running jobs finish, and setting this back to true does not reopen it.',
		displayOptions: { show: { resource: ['session'], operation: ['setAccepting'] } },
	},
];
