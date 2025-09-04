variable "network_name" {
  description = "Name of the Docker network to connect to"
  type        = string
}

variable "image_name" {
  description = "Name of the Docker image to use"
  type = string
}

variable "container_name" {
  description = "Name of the Express.js container"
  type        = string
}

variable "database_host" {
  description = "Database host"
  type        = string
}

variable "database_port" {
  description = "Database port"
  type        = number
}

variable "database_name" {
  description = "Database name"
  type        = string
}

variable "database_user" {
  description = "Database user"
  type        = string
}

variable "database_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "app_port" {
  description = "Internal port for the Express.js application"
  type        = number
  default     = 3000
}

variable "external_port" {
  description = "External port to expose the Express.js application"
  type        = number
}

variable "node_env" {
  description = "Node.js environment"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Project name for labeling"
  type        = string
  default     = "terraform-example"
}

variable "redis_connection_string" {
  description = "Connection string to redis"
  type        = string
}
