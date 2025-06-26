# Express Service Module

This Terraform module creates an Express.js application container that connects to PostgreSQL.

## Usage

```hcl
module "express_service" {
  source = "./express-service"

  network_name      = module.docker_network.network_name
  database_host     = module.postgres.database_host
  database_port     = module.postgres.database_port
  database_name     = module.postgres.database_name
  database_user     = module.postgres.database_user
  database_password = module.postgres.database_password
  external_port     = 3000
}
```

## Variables

| Name              | Description                                        | Type     | Default               | Required |
| ----------------- | -------------------------------------------------- | -------- | --------------------- | :------: |
| network_name      | Name of the Docker network to connect to           | `string` | n/a                   |   yes    |
| container_name    | Name of the Express.js container                   | `string` | `"express-app"`       |    no    |
| database_host     | Database host                                      | `string` | n/a                   |   yes    |
| database_port     | Database port                                      | `number` | `5432`                |    no    |
| database_name     | Database name                                      | `string` | n/a                   |   yes    |
| database_user     | Database user                                      | `string` | n/a                   |   yes    |
| database_password | Database password                                  | `string` | n/a                   |   yes    |
| app_port          | Internal port for the Express.js application       | `number` | `3000`                |    no    |
| external_port     | External port to expose the Express.js application | `number` | `3000`                |    no    |
| node_env          | Node.js environment                                | `string` | `"production"`        |    no    |
| project_name      | Project name for labeling                          | `string` | `"terraform-example"` |    no    |

## Outputs

| Name           | Description                                  |
| -------------- | -------------------------------------------- |
| container_id   | ID of the Express.js container               |
| container_name | Name of the Express.js container             |
| app_url        | URL to access the Express.js application     |
| app_port       | External port for the Express.js application |

## API Endpoints

The Express.js application provides the following endpoints:

- `GET /` - Application status
- `GET /health` - Health check with database connectivity
- `GET /users` - List all users
- `POST /users` - Create a new user (requires `name` and `email` in JSON body)
