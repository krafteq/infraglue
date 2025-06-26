terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

resource "docker_volume" "postgres_data" {
  name = "${var.container_name}-data"
}

resource "docker_container" "postgres" {
  name  = var.container_name
  image = "postgres:${var.postgres_version}"
  
  networks_advanced {
    name = var.network_name
  }
  
  volumes {
    volume_name    = docker_volume.postgres_data.name
    container_path = "/var/lib/postgresql/data"
  }
  
  env = [
    "POSTGRES_DB=${var.database_name}",
    "POSTGRES_USER=${var.database_user}",
    "POSTGRES_PASSWORD=${var.database_password}"
  ]
  
  ports {
    internal = 5432
    external = var.external_port
  }
  
  restart = "unless-stopped"
  
  labels {
    label = "project"
    value = var.project_name
  }
  
  labels {
    label = "service"
    value = "postgres"
  }
} 