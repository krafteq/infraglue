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
