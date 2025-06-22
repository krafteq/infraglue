output "container_id" {
  description = "ID of the Express.js container"
  value       = docker_container.express_app.id
}

output "container_name" {
  description = "Name of the Express.js container"
  value       = docker_container.express_app.name
}

output "app_url" {
  description = "URL to access the Express.js application"
  value       = "http://localhost:${var.external_port}"
}

output "app_port" {
  description = "External port for the Express.js application"
  value       = var.external_port
} 