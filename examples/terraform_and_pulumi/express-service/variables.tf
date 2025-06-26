variable "network_name" {
  description = "Name of the Docker network to connect to"
  type        = string
  default     = "app-network"
}

variable "container_name" {
  description = "Name of the Express.js container"
  type        = string
  default     = "express-app"
}

variable "database_host" {
  description = "Database host"
  type        = string
}

variable "database_port" {
  description = "Database port"
  type        = number
  default     = 5432
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
  default     = 3000
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