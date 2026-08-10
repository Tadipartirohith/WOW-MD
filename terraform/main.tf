terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # Configure a remote backend (S3 + DynamoDB lock) before use:
  # backend "s3" { bucket = "wow-tfstate" key = "prod/terraform.tfstate" region = "ap-south-1" dynamodb_table = "wow-tf-lock" }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "wow-platform"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
