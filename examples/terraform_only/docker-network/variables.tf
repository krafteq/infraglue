variable "network_name" {
  description = "Name of the Docker network"
  type        = string
  default     = "app-network"
}

variable "project_name" {
  description = "Project name for labeling"
  type        = string
  default     = "terraform-example"
} 