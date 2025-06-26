variable "network_name" {
  description = "Name of the Docker network to connect to"
  type        = string
}

variable "container_name" {
  description = "Name of the PostgreSQL container"
  type        = string
  default     = "postgres"
}

variable "postgres_version" {
  description = "PostgreSQL version to use"
  type        = string
  default     = "15"
}

variable "database_name" {
  description = "Name of the database to create"
  type        = string
  default     = "appdb"
}

variable "database_user" {
  description = "Database user"
  type        = string
  default     = "postgres"
}

variable "database_password" {
  description = "Database password"
  type        = string
  default     = "postgres"
  sensitive   = true
}

variable "external_port" {
  description = "External port to expose PostgreSQL"
  type        = number
  default     = 5432
}

variable "project_name" {
  description = "Project name for labeling"
  type        = string
  default     = "terraform-example"
} 