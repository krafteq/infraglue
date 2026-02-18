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

export const TERRAFORM_OUTPUT_JSON = JSON.stringify({
  network_name: { value: 'dev-network', type: 'string', sensitive: false },
  db_host: { value: 'localhost:5432', type: 'string', sensitive: false },
})

// Pulumi preview JSON fixtures (single JSON object)

export const PULUMI_PREVIEW_CREATE = JSON.stringify({
  steps: [
    {
      op: 'create',
      urn: 'urn:pulumi:dev::network::docker:index/network:Network::dev-network',
      resource: { properties: { name: 'dev-network', driver: 'bridge' } },
    },
    {
      op: 'create',
      urn: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
      resource: { properties: { name: 'app', image: 'node:18' } },
    },
  ],
})

export const PULUMI_PREVIEW_UPDATE = JSON.stringify({
  steps: [
    {
      op: 'update',
      urn: 'urn:pulumi:dev::network::docker:index/container:Container::app-container',
      resource: { properties: { name: 'app', image: 'node:20' } },
    },
  ],
})

export const PULUMI_PREVIEW_MIXED = JSON.stringify({
  steps: [
    {
      op: 'create',
      urn: 'urn:pulumi:dev::myproject::aws:s3/bucket:Bucket::new-bucket',
      resource: { properties: { bucketName: 'my-new-bucket' } },
    },
    {
      op: 'update',
      urn: 'urn:pulumi:dev::myproject::aws:ec2/instance:Instance::web-server',
      resource: { properties: { instanceType: 't3.medium' } },
    },
    {
      op: 'delete',
      urn: 'urn:pulumi:dev::myproject::aws:s3/bucket:Bucket::old-bucket',
      resource: {},
    },
    {
      op: 'replace',
      urn: 'urn:pulumi:dev::myproject::aws:rds/instance:Instance::database',
      resource: { properties: { engineVersion: '15.0' } },
    },
    {
      op: 'same',
      urn: 'urn:pulumi:dev::myproject::pulumi:pulumi:Stack::myproject-dev',
      resource: {},
    },
  ],
})

export const PULUMI_PREVIEW_NO_CHANGES = JSON.stringify({
  steps: [
    {
      op: 'same',
      urn: 'urn:pulumi:dev::myproject::pulumi:pulumi:Stack::myproject-dev',
      resource: {},
    },
  ],
})

export const PULUMI_PREVIEW_WITH_OUTPUTS = JSON.stringify({
  steps: [
    {
      op: 'create',
      urn: 'urn:pulumi:dev::network::docker:index/network:Network::dev-network',
      resource: { properties: { name: 'dev-network' } },
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
