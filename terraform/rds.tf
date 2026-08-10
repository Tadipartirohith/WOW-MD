# Aurora PostgreSQL: Multi-AZ writer + reader replica. The app points DB_HOST at
# the cluster writer endpoint; read-heavy paths can use the reader endpoint.
module "aurora_postgres" {
  source  = "terraform-aws-modules/rds-aurora/aws"
  version = "~> 9.0"

  name              = "wow-db"
  engine            = "aurora-postgresql"
  engine_version    = "16.1"
  database_name     = "wow_db"
  master_username   = "wow_user"
  master_password   = var.db_password
  manage_master_user_password = false

  vpc_id               = module.vpc.vpc_id
  db_subnet_group_name = module.vpc.database_subnet_group_name

  instances = {
    writer = { instance_class = var.db_instance_class }
    reader = { instance_class = var.db_instance_class }
  }

  storage_encrypted   = true
  apply_immediately   = false
  skip_final_snapshot = false
  deletion_protection = true
}
