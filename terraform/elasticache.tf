# ElastiCache Redis (replication group), cache, sessions, rate-limit counters,
# and the Socket.io pub/sub adapter for cross-pod real-time delivery.
resource "aws_elasticache_subnet_group" "redis" {
  name       = "wow-redis-subnets"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "wow-redis"
  description          = "WOW Redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  port                       = 6379
}
