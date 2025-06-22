# Docker Network Module

This Terraform module creates a Docker network for connecting containers.

## Usage

```hcl
module "docker_network" {
  source = "./docker-network"

  network_name = "my-app-network"
  project_name = "my-project"
}
```

## Variables

| Name         | Description                | Type     | Default               | Required |
| ------------ | -------------------------- | -------- | --------------------- | :------: |
| network_name | Name of the Docker network | `string` | `"app-network"`       |    no    |
| project_name | Project name for labeling  | `string` | `"terraform-example"` |    no    |

## Outputs

| Name         | Description                        |
| ------------ | ---------------------------------- |
| network_id   | ID of the created Docker network   |
| network_name | Name of the created Docker network |
