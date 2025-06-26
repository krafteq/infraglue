output "container_id" {
  description = "ID of the PostgreSQL container"
  value       = docker_container.postgres.id
}

output "container_name" {
  description = "Name of the PostgreSQL container"
  value       = docker_container.postgres.name
}

output "database_host" {
  description = "Database host (container name in the network)"
  value       = docker_container.postgres.name
}

output "database_port" {
  description = "Database port"
  value       = 5432
}

output "database_name" {
  description = "Database name"
  value       = var.database_name
}

output "database_user" {
  description = "Database user"
  value       = var.database_user
}

output "external_port" {
  description = "External port for database access"
  value       = var.external_port
} 

output "database_password" {
  description = "Database password"
  value       = var.database_password
  sensitive   = true
}