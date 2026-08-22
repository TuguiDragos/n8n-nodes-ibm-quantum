import type { INodeProperties } from 'n8n-workflow';

const GATE_OPTIONS = [
	{ name: 'Barrier', value: 'barrier' },
	{ name: 'CCX / Toffoli', value: 'ccx' },
	{ name: 'CNOT / CX', value: 'cx' },
	{ name: 'Controlled RX', value: 'crx' },
	{ name: 'Controlled RY', value: 'cry' },
	{ name: 'Controlled RZ', value: 'crz' },
	{ name: 'CZ', value: 'cz' },
	{ name: 'Hadamard', value: 'h' },
	{ name: 'Identity', value: 'id' },
	{ name: 'Measure', value: 'measure' },
	{ name: 'Phase', value: 'p' },
	{ name: 'Reset', value: 'reset' },
	{ name: 'RX', value: 'rx' },
	{ name: 'RY', value: 'ry' },
	{ name: 'RZ', value: 'rz' },
	{ name: 'S', value: 's' },
	{ name: 'S Dagger', value: 'sdg' },
	{ name: 'Swap', value: 'swap' },
	{ name: 'T', value: 't' },
	{ name: 'T Dagger', value: 'tdg' },
	{ name: 'U', value: 'u' },
	{ name: 'X', value: 'x' },
	{ name: 'Y', value: 'y' },
	{ name: 'Z', value: 'z' },
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
				name: 'Get Usage',
				value: 'getUsage',
				action: 'Get instance usage and allocation',
				description: 'Read seconds consumed against the quota for the current period',
			},
			{
				name: 'Get Usage Analytics',
				value: 'getAnalytics',
				action: 'Get usage analytics',
				description: 'Totals for jobs, sessions and seconds over a date range',
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
				description: 'The same totals split by backend, plan, instance or user',
			},
			{
				name: 'Get Usage Analytics Grouped by Date',
				value: 'getAnalyticsByDate',
				action: 'Get usage analytics grouped by date',
				description: 'The same totals as a time series, one point per day',
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
				description: 'Stop a session from accepting further jobs and end it',
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
				description: 'Whether to count simulator usage as well as real hardware',
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
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		// IBM caps this listing at 50, unlike the jobs listing which allows 200.
		typeOptions: { minValue: 1, maxValue: 50 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['workload'], operation: ['list'] } },
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
					'Cursor from a previous response, to fetch the following page. This listing pages by cursor rather than by offset.',
			},
			{
				displayName: 'Previous Cursor',
				name: 'previous',
				type: 'string',
				default: '',
				description: 'Cursor from a previous response, to fetch the preceding page',
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
			'Name of the backend (a specific quantum device or simulator) to query. The status and queue shown in the list are read once when the node opens; use Refresh List in the field menu to update them. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				resource: ['backend'],
				operation: ['getConfiguration', 'getDefaults', 'getProperties', 'getStatus'],
			},
		},
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
		description: 'Whether to include simulators when selecting the least busy backend',
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
				values: [
					{
						displayName: 'Gate',
						name: 'gate',
						type: 'options',
						default: 'h',
						options: GATE_OPTIONS,
						description:
							'Gate or instruction to append. Identity is accepted but emits nothing, because the OpenQASM 3 standard library defines it through the builtin U gate, which IBM hardware rejects.',
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
					{
						displayName: 'Parameters',
						name: 'params',
						type: 'string',
						default: '',
						placeholder: 'e.g. 1.5708 or 0.1,0.2,0.3',
						description:
							'Comma-separated angles in radians. One value for RX/RY/RZ/Phase/Controlled-R gates; exactly three (theta, phi, lambda) for the U gate.',
						displayOptions: {
							show: { gate: ['rx', 'ry', 'rz', 'p', 'crx', 'cry', 'crz', 'u'] },
						},
					},
					{
						displayName: 'Classical Bit',
						name: 'clbit',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 0,
						description: 'Target classical bit for the measure instruction',
						displayOptions: { show: { gate: ['measure'] } },
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
			'Backend that will run the circuit. The circuit must already be transpiled (ISA) for this backend; the Qiskit Runtime API does not transpile and rejects non-native circuits. The status and queue shown in the list are read once when the node opens; use Refresh List in the field menu to update them. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
			'Optional bindings for a parametrized circuit, as a JSON object mapping parameter names to values (or arrays of values). Leave empty for a fixed circuit.',
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
		displayName: 'Session ID',
		name: 'submitSessionId',
		type: 'string',
		default: '',
		description:
			'Optional session or batch ID (from Session Create) to run this job inside, for low-latency consecutive execution',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'Max Cost (Seconds)',
		name: 'maxCost',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 10800 },
		default: 0,
		description:
			'Maximum runtime seconds this job may consume before IBM cancels it. Zero lets the program decide. IBM allows at most 10800 (three hours) and caps anything higher. On the Open plan, where the whole allowance is 600 seconds per 28 days, this stops one runaway job from spending it.',
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
			'Whether to mark the job private, hiding its input and results from other collaborators on the instance. Requires a plan that supports private jobs.',
		displayOptions: { show: { resource: ['job'], operation: ALL_SUBMIT_OPS } },
	},
	{
		displayName: 'Additional Options',
		name: 'additionalOptions',
		type: 'json',
		default: '{}',
		description:
			'Advanced JSON options passed straight to the primitive, for example {"default_shots": 4096}. Most workflows can leave this as {}. See the IBM Qiskit Runtime primitive options documentation.',
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
			'Maximum seconds to wait for the job to finish. Real hardware queues can be long, so raise this for production runs or poll separately with Get Status.',
		displayOptions: { show: { resource: ['job'], operation: ['getResults'] } },
	},
	{
		displayName: 'Register Name',
		name: 'registerName',
		type: 'string',
		default: '',
		description:
			'Optional classical register name to read counts from. Detected automatically when empty.',
		displayOptions: { show: { resource: ['job'], operation: ['getResults'] } },
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
		displayOptions: { show: { resource: ['job'], operation: ['list'] } },
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
					{ name: 'Sampler', value: 'sampler' },
				],
				default: '',
				description: 'Only jobs submitted to this primitive',
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
		description: 'Maximum session lifetime in seconds. The default is 28800 (8 hours).',
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
