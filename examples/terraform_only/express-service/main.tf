terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

resource "docker_image" "express_app" {
  name = "express-app:latest"
  build {
    context = "${path.module}/app"
    dockerfile = "Dockerfile"
  }
  triggers = {
    dir_sha1 = sha1(join("", [for f in fileset("${path.module}/app", "**") : filesha1("${path.module}/app/${f}")]))
  }
}

resource "docker_container" "express_app" {
  name  = var.container_name
  image = docker_image.express_app.image_id
  
  networks_advanced {
    name = var.network_name
  }
  
  env = [
    "DB_HOST=${var.database_host}",
    "DB_PORT=${var.database_port}",
    "DB_NAME=${var.database_name}",
    "DB_USER=${var.database_user}",
    "DB_PASSWORD=${var.database_password}",
    "NODE_ENV=${var.node_env}",
    "PORT=${var.app_port}"
  ]
  
  ports {
    internal = var.app_port
    external = var.external_port
  }
  
  restart = "unless-stopped"
  
  labels {
    label = "project"
    value = var.project_name
  }
  
  labels {
    label = "service"
    value = "express"
  }
  
  depends_on = [docker_image.express_app]
} 