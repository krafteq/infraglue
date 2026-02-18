variable "instance_count" {
  type = number
}

variable "port" {
  type = number
}

resource "null_resource" "service" {}
