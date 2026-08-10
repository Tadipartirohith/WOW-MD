output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "db_writer_endpoint" {
  value = module.aurora_postgres.cluster_endpoint
}

output "db_reader_endpoint" {
  value = module.aurora_postgres.cluster_reader_endpoint
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}
