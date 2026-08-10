variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "cluster_name" {
  type    = string
  default = "wow-eks"
}

variable "kubernetes_version" {
  type    = string
  default = "1.29"
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "db_password" {
  type      = string
  sensitive = true
  # Supply via TF_VAR_db_password or a secrets backend, never hardcode.
}

variable "redis_node_type" {
  type    = string
  default = "cache.r6g.large"
}

# Values you must supply for a real deployment. Put them in terraform.tfvars
# (copy terraform.tfvars.example) or pass them with TF_VAR_ environment variables.
variable "container_registry" {
  type        = string
  description = "Registry that holds the wow-backend image, for example an ECR address."
  default     = ""
}

variable "domain_name" {
  type        = string
  description = "Public domain the API and app are served on, for example wow.example.com."
  default     = ""
}

variable "acm_certificate_arn" {
  type        = string
  description = "ARN of the TLS certificate in AWS Certificate Manager for the domain."
  default     = ""
}
