# Docker Network Module

This Pulumi module creates a Docker network for connecting containers.

## Usage

```typescript
import * as pulumi from '@pulumi/pulumi'
import * as docker from '@pulumi/docker'

const network = new docker.Network('network', {
  name: 'app-network',
  driver: 'bridge',
})
```

## Configuration

| Name         | Description                | Type     | Default               | Required |
| ------------ | -------------------------- | -------- | --------------------- | -------- |
| network_name | Name of the Docker network | `string` | `"app-network"`       | no       |
| project_name | Project name for labeling  | `string` | `"terraform-example"` | no       |

## Outputs

| Name         | Description                 |
| ------------ | --------------------------- |
| network_name | Name of the created network |

## Commands

```bash
# Preview changes
pulumi preview

# Deploy
pulumi up

# Destroy
pulumi destroy
```
