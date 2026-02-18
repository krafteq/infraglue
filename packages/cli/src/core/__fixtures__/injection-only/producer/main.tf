resource "null_resource" "producer" {}

output "shared_value" {
  value = "produced-value"
}
