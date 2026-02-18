variable "out1" {
  type = string
}

resource "null_resource" "b" {}

output "out2" {
  value = "value-from-b"
}
