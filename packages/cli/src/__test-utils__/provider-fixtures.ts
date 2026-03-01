// Terraform plan JSON fixtures (one JSON object per line, as terraform outputs)

export const TERRAFORM_PLAN_CREATE = [
  '{"@level":"info","@message":"Plan: 2 to add, 0 to change, 0 to destroy.","type":"change_summary","changes":{"add":2,"change":0,"import":0,"remove":0,"operation":"plan"}}',
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_network.main","module":"","resource":"docker_network.main","resource_type":"docker_network","resource_name":"main","resource_key":null},"action":"create","before":null,"after":{"name":"dev-network"}}}',
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_container.app","module":"","resource":"docker_container.app","resource_type":"docker_container","resource_name":"app","resource_key":null},"action":"create","before":null,"after":{"image":"node:18","name":"app"}}}',
].join('\n')

export const TERRAFORM_PLAN_UPDATE = [
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_container.app","module":"","resource":"docker_container.app","resource_type":"docker_container","resource_name":"app","resource_key":null},"action":"update","before":{"image":"node:18"},"after":{"image":"node:20"}}}',
  '{"@level":"info","@message":"Plan: 0 to add, 1 to change, 0 to destroy.","type":"change_summary","changes":{"add":0,"change":1,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

export const TERRAFORM_PLAN_NO_CHANGES = [
  '{"@level":"info","@message":"No changes. Infrastructure is up-to-date.","type":"change_summary","changes":{"add":0,"change":0,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

export const TERRAFORM_PLAN_WITH_OUTPUTS = [
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_network.main","module":"","resource":"docker_network.main","resource_type":"docker_network","resource_name":"main","resource_key":null},"action":"create","before":null,"after":{"name":"dev-network"}}}',
  '{"@level":"info","type":"outputs","outputs":{"network_name":{"value":"dev-network","action":"create","sensitive":false},"network_id":{"action":"create","sensitive":false}}}',
  '{"@level":"info","@message":"Plan: 1 to add, 0 to change, 0 to destroy.","type":"change_summary","changes":{"add":1,"change":0,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

export const TERRAFORM_PLAN_WITH_DIAGNOSTICS = [
  '{"@level":"warn","type":"diagnostic","diagnostic":{"severity":"warning","summary":"Deprecated attribute","detail":"The attribute \\"foo\\" is deprecated.","address":"docker_network.main"}}',
  '{"@level":"info","@message":"No changes. Infrastructure is up-to-date.","type":"change_summary","changes":{"add":0,"change":0,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

// Terraform plan where "update" has identical before/after (metadata-only drift)
export const TERRAFORM_PLAN_METADATA_ONLY = [
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_container.app","module":"","resource":"docker_container.app","resource_type":"docker_container","resource_name":"app","resource_key":null},"action":"update","before":{"image":"node:18","name":"app","ports":[{"internal":3000,"external":3000}]},"after":{"image":"node:18","name":"app","ports":[{"internal":3000,"external":3000}]}}}',
  '{"@level":"info","@message":"Plan: 0 to add, 1 to change, 0 to destroy.","type":"change_summary","changes":{"add":0,"change":1,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

// Terraform plan with a real change + a metadata-only change + a create
export const TERRAFORM_PLAN_MIXED_CHANGES = [
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_container.app","module":"","resource":"docker_container.app","resource_type":"docker_container","resource_name":"app","resource_key":null},"action":"update","before":{"image":"node:18","name":"app"},"after":{"image":"node:20","name":"app"}}}',
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_network.main","module":"","resource":"docker_network.main","resource_type":"docker_network","resource_name":"main","resource_key":null},"action":"update","before":{"name":"dev-network","driver":"bridge"},"after":{"name":"dev-network","driver":"bridge"}}}',
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_volume.data","module":"","resource":"docker_volume.data","resource_type":"docker_volume","resource_name":"data","resource_key":null},"action":"create","before":null,"after":{"name":"app-data"}}}',
  '{"@level":"info","@message":"Plan: 1 to add, 2 to change, 0 to destroy.","type":"change_summary","changes":{"add":1,"change":2,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

// terraform show -json <planfile> format — single JSON object with before/after
export const TERRAFORM_SHOW_JSON_MIXED = JSON.stringify({
  format_version: '1.2',
  terraform_version: '1.9.0',
  resource_changes: [
    {
      address: 'docker_container.app',
      mode: 'managed',
      type: 'docker_container',
      name: 'app',
      change: {
        actions: ['update'],
        before: { image: 'node:18', name: 'app', ports: [{ internal: 3000, external: 3000 }] },
        after: { image: 'node:20', name: 'app', ports: [{ internal: 3000, external: 3000 }] },
      },
    },
    {
      address: 'docker_network.main',
      mode: 'managed',
      type: 'docker_network',
      name: 'main',
      change: {
        actions: ['update'],
        before: { name: 'dev-network', driver: 'bridge' },
        after: { name: 'dev-network', driver: 'bridge' },
      },
    },
    {
      address: 'docker_volume.data',
      mode: 'managed',
      type: 'docker_volume',
      name: 'data',
      change: {
        actions: ['create'],
        before: null,
        after: { name: 'app-data' },
      },
    },
  ],
})

export const TERRAFORM_OUTPUT_JSON = JSON.stringify({
  network_name: { value: 'dev-network', type: 'string', sensitive: false },
  db_host: { value: 'localhost:5432', type: 'string', sensitive: false },
})

// Pulumi preview JSON fixtures (single JSON object)
// Uses the real `pulumi preview --json` format: steps have oldState/newState (ResourceV3 with inputs/outputs)

export const PULUMI_PREVIEW_CREATE = JSON.stringify({
  steps: [
    {
      op: 'create',
      urn: 'urn:pulumi:dev::network::docker:index/network:Network::dev-network',
      newState: { inputs: { name: 'dev-network', driver: 'bridge' } },
    },
    {
      op: 'create',
      urn: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
      newState: { inputs: { name: 'app', image: 'node:18' } },
    },
  ],
})

export const PULUMI_PREVIEW_UPDATE = JSON.stringify({
  steps: [
    {
      op: 'update',
      urn: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
      oldState: { inputs: { name: 'app', image: 'node:18' } },
      newState: { inputs: { name: 'app', image: 'node:20' } },
      detailedDiff: { image: { kind: 'UPDATE' } },
    },
  ],
})

// Pulumi update where oldState and newState inputs are identical (metadata-only drift)
export const PULUMI_PREVIEW_METADATA_ONLY = JSON.stringify({
  steps: [
    {
      op: 'update',
      urn: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
      oldState: { inputs: { name: 'app', image: 'node:18', ports: [{ internal: 3000, external: 3000 }] } },
      newState: { inputs: { name: 'app', image: 'node:18', ports: [{ internal: 3000, external: 3000 }] } },
    },
  ],
})

export const PULUMI_PREVIEW_MIXED = JSON.stringify({
  steps: [
    {
      op: 'create',
      urn: 'urn:pulumi:dev::myproject::aws:s3/bucket:Bucket::new-bucket',
      newState: { inputs: { bucketName: 'my-new-bucket' } },
    },
    {
      op: 'update',
      urn: 'urn:pulumi:dev::myproject::aws:ec2/instance:Instance::web-server',
      oldState: { inputs: { instanceType: 't2.micro' } },
      newState: { inputs: { instanceType: 't3.medium' } },
      detailedDiff: { instanceType: { kind: 'UPDATE' } },
    },
    {
      op: 'delete',
      urn: 'urn:pulumi:dev::myproject::aws:s3/bucket:Bucket::old-bucket',
      oldState: { inputs: { bucketName: 'my-old-bucket' } },
    },
    {
      op: 'replace',
      urn: 'urn:pulumi:dev::myproject::aws:rds/instance:Instance::database',
      oldState: { inputs: { engineVersion: '14.0' } },
      newState: { inputs: { engineVersion: '15.0' } },
    },
    {
      op: 'same',
      urn: 'urn:pulumi:dev::myproject::pulumi:pulumi:Stack::myproject-dev',
      oldState: { inputs: {} },
      newState: { inputs: {} },
    },
  ],
})

export const PULUMI_PREVIEW_NO_CHANGES = JSON.stringify({
  steps: [
    {
      op: 'same',
      urn: 'urn:pulumi:dev::myproject::pulumi:pulumi:Stack::myproject-dev',
      oldState: { inputs: {} },
      newState: { inputs: {} },
    },
  ],
})

export const PULUMI_PREVIEW_WITH_OUTPUTS = JSON.stringify({
  steps: [
    {
      op: 'create',
      urn: 'urn:pulumi:dev::network::docker:index/network:Network::dev-network',
      newState: { inputs: { name: 'dev-network' } },
    },
  ],
  outputs: {
    network_name: 'dev-network',
    config: { host: 'localhost', port: 5432 },
  },
})

export const PULUMI_STACK_OUTPUT_JSON = JSON.stringify({
  network_name: 'dev-network',
  db_host: 'localhost:5432',
})

// Drift detection fixtures
// terraform plan -refresh-only --json output format is identical to regular plan output

export const TERRAFORM_DRIFT_DETECTED = [
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"docker_container.app","module":"","resource":"docker_container.app","resource_type":"docker_container","resource_name":"app","resource_key":null},"action":"update","before":{"image":"node:18","name":"app"},"after":{"image":"node:20","name":"app"}}}',
  '{"@level":"info","@message":"Plan: 0 to add, 1 to change, 0 to destroy.","type":"change_summary","changes":{"add":0,"change":1,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

export const TERRAFORM_DRIFT_NONE = [
  '{"@level":"info","@message":"No changes. Infrastructure is up-to-date.","type":"change_summary","changes":{"add":0,"change":0,"import":0,"remove":0,"operation":"plan"}}',
].join('\n')

// pulumi refresh --preview-only --json output format is identical to preview --json output
// (same steps array with op, urn, oldState, newState)

export const PULUMI_DRIFT_DETECTED = JSON.stringify({
  steps: [
    {
      op: 'update',
      urn: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
      oldState: { inputs: { name: 'app', image: 'node:18' } },
      newState: { inputs: { name: 'app', image: 'node:20' } },
      detailedDiff: { image: { kind: 'UPDATE' } },
    },
  ],
})

export const PULUMI_DRIFT_NONE = JSON.stringify({
  steps: [
    {
      op: 'same',
      urn: 'urn:pulumi:dev::myproject::pulumi:pulumi:Stack::myproject-dev',
      oldState: { inputs: {} },
      newState: { inputs: {} },
    },
  ],
})

// Error output fixtures

export const TERRAFORM_ERROR_OUTPUT = [
  '{"@level":"info","type":"planned_change","change":{"resource":{"addr":"aws_s3_bucket.main","module":"","resource":"aws_s3_bucket.main","resource_type":"aws_s3_bucket","resource_name":"main","resource_key":null},"action":"create","before":null,"after":{"bucket":"my-bucket"}}}',
  '{"@level":"error","type":"diagnostic","diagnostic":{"severity":"error","summary":"error creating S3 Bucket: BucketAlreadyExists","detail":"The requested bucket name is not available.","address":"aws_s3_bucket.main"}}',
].join('\n')

export const TERRAFORM_ERROR_WITH_WARNINGS = [
  '{"@level":"warn","type":"diagnostic","diagnostic":{"severity":"warning","summary":"Deprecated attribute","detail":"The attribute \\"foo\\" is deprecated.","address":"aws_instance.web"}}',
  '{"@level":"error","type":"diagnostic","diagnostic":{"severity":"error","summary":"error creating S3 Bucket: BucketAlreadyExists","detail":"The requested bucket name is not available.","address":"aws_s3_bucket.main"}}',
  '{"@level":"error","type":"diagnostic","diagnostic":{"severity":"error","summary":"failed to create container: image not found","detail":"","address":null}}',
].join('\n')

export const TERRAFORM_ERROR_NO_DIAGNOSTICS = [
  '{"@level":"info","@message":"Initializing...","type":"init_output"}',
  '{"@level":"info","@message":"Planning...","type":"log"}',
].join('\n')

export const PULUMI_ERROR_STREAMING = [
  '{"sequence":1,"timestamp":"2024-01-15T10:00:00Z","diagnosticEvent":{"severity":"info#err","message":"Updating resources..."}}',
  '{"sequence":2,"timestamp":"2024-01-15T10:00:01Z","diagnosticEvent":{"severity":"error","message":"error creating S3 Bucket: BucketAlreadyExists"}}',
  '{"sequence":3,"timestamp":"2024-01-15T10:00:02Z","diagnosticEvent":{"severity":"error","message":"failed to create container: image not found"}}',
].join('\n')

export const PULUMI_ERROR_BLOB = JSON.stringify({
  diagnostics: [
    { severity: 'warning', message: 'Deprecated resource type' },
    { severity: 'error', message: 'error creating S3 Bucket: BucketAlreadyExists' },
  ],
})

export const PULUMI_ERROR_NO_DIAGNOSTICS = JSON.stringify({
  steps: [],
})

export const MALFORMED_NDJSON = [
  '{"@level":"error","type":"diagnostic","diagnostic":{"severity":"error","summary":"real error","detail":"","address":null}}',
  'this is not json at all',
  '{"incomplete": true',
  '{"@level":"info","type":"log","@message":"some log"}',
].join('\n')

// Streaming apply/destroy fixtures (NDJSON lines as Terraform emits during apply --json)

export const TERRAFORM_APPLY_START =
  '{"@level":"info","@message":"docker_network.main: Creating...","type":"apply_start","hook":{"resource":{"addr":"docker_network.main","module":"","resource":"docker_network.main","resource_type":"docker_network","resource_name":"main","resource_key":null},"action":"create"}}'

export const TERRAFORM_APPLY_PROGRESS =
  '{"@level":"info","@message":"docker_network.main: Still creating... [10s elapsed]","type":"apply_progress","hook":{"resource":{"addr":"docker_network.main","module":"","resource":"docker_network.main","resource_type":"docker_network","resource_name":"main","resource_key":null},"action":"create","elapsed_seconds":10}}'

export const TERRAFORM_APPLY_COMPLETE =
  '{"@level":"info","@message":"docker_network.main: Creation complete after 12s","type":"apply_complete","hook":{"resource":{"addr":"docker_network.main","module":"","resource":"docker_network.main","resource_type":"docker_network","resource_name":"main","resource_key":null},"action":"create","elapsed_seconds":12}}'

export const TERRAFORM_APPLY_ERRORED =
  '{"@level":"error","@message":"docker_container.app: Error creating...","type":"apply_errored","hook":{"resource":{"addr":"docker_container.app","module":"","resource":"docker_container.app","resource_type":"docker_container","resource_name":"app","resource_key":null}},"diagnostic":{"severity":"error","summary":"error creating container: image not found","detail":"The specified image does not exist.","address":"docker_container.app"}}'

export const TERRAFORM_STREAM_DIAGNOSTIC =
  '{"@level":"warn","type":"diagnostic","diagnostic":{"severity":"warning","summary":"Deprecated attribute","detail":"The attribute \\"foo\\" is deprecated.","address":"docker_network.main"}}'

export const TERRAFORM_STREAM_SUMMARY =
  '{"@level":"info","@message":"Apply complete! Resources: 2 added, 0 changed, 0 destroyed.","type":"change_summary","changes":{"add":2,"change":0,"remove":0,"operation":"apply"}}'

// Pulumi streaming event fixtures (NDJSON lines as Pulumi emits during up --json)

export const PULUMI_RESOURCE_PRE =
  '{"sequence":1,"timestamp":"2024-01-15T10:00:00Z","resourcePreEvent":{"metadata":{"urn":"urn:pulumi:dev::network::docker:index/network:Network::dev-network","type":"docker:index/network:Network","op":"create"}}}'

export const PULUMI_RES_OUTPUTS =
  '{"sequence":2,"timestamp":"2024-01-15T10:00:12Z","resOutputsEvent":{"metadata":{"urn":"urn:pulumi:dev::network::docker:index/network:Network::dev-network","type":"docker:index/network:Network","op":"create","durationSeconds":12}}}'

export const PULUMI_RES_OP_FAILED =
  '{"sequence":3,"timestamp":"2024-01-15T10:00:05Z","resOpFailedEvent":{"metadata":{"urn":"urn:pulumi:dev::network::docker:index/container:Container::app-container","type":"docker:index/container:Container","op":"create"},"status":1,"diagnostics":[{"message":"error creating container: image not found"}]}}'

export const PULUMI_STREAM_DIAGNOSTIC =
  '{"sequence":4,"timestamp":"2024-01-15T10:00:03Z","diagnosticEvent":{"severity":"warning","message":"Deprecated resource type","urn":"urn:pulumi:dev::network::docker:index/network:Network::dev-network"}}'

export const PULUMI_STREAM_SUMMARY =
  '{"sequence":5,"timestamp":"2024-01-15T10:00:15Z","summaryEvent":{"resourceChanges":{"create":2,"update":1,"delete":0}}}'
