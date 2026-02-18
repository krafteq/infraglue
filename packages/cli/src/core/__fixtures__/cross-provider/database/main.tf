variable "network_name" {
  type = string
}

resource "null_resource" "db" {}

output "db_host" {
  value = "localhost:5432"
}
