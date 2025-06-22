# PostgreSQL Module

This Terraform module creates a PostgreSQL container in a Docker network.

## Usage

```hcl
module "postgres" {
  source = "./postgres"

  network_name      = module.docker_network.network_name
  container_name    = "my-postgres"
  database_name     = "myapp"
  database_user     = "appuser"
  database_password = "securepassword"
  external_port     = 5433
}
```

## Variables

| Name              | Description                              | Type     | Default               | Required |
| ----------------- | ---------------------------------------- | -------- | --------------------- | :------: |
| network_name      | Name of the Docker network to connect to | `string` | n/a                   |   yes    |
| container_name    | Name of the PostgreSQL container         | `string` | `"postgres"`          |    no    |
| postgres_version  | PostgreSQL version to use                | `string` | `"15"`                |    no    |
| database_name     | Name of the database to create           | `string` | `"appdb"`             |    no    |
| database_user     | Database user                            | `string` | `"postgres"`          |    no    |
| database_password | Database password                        | `string` | `"postgres"`          |    no    |
| external_port     | External port to expose PostgreSQL       | `number` | `5432`                |    no    |
| project_name      | Project name for labeling                | `string` | `"terraform-example"` |    no    |

## Outputs

| Name           | Description                                   |
| -------------- | --------------------------------------------- |
| container_id   | ID of the PostgreSQL container                |
| container_name | Name of the PostgreSQL container              |
| database_host  | Database host (container name in the network) |
| database_port  | Database port                                 |
| database_name  | Database name                                 |
| database_user  | Database user                                 |
| external_port  | External port for database access             |
