terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

resource "docker_network" "app_network" {
  name = var.network_name
  driver = "bridge"
  
  labels {
    label = "project"
    value = var.project_name
  }
} 