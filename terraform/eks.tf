module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  # Managed node group with autoscaling, the Cluster Autoscaler adjusts
  # desired_size between min and max as HPA schedules more pods.
  eks_managed_node_groups = {
    default = {
      instance_types = ["m6i.large"]
      min_size       = 3
      max_size       = 20
      desired_size   = 3
    }
  }

  # Add-ons needed by the platform.
  cluster_addons = {
    coredns    = {}
    kube-proxy = {}
    vpc-cni    = {}
    aws-ebs-csi-driver = {}
  }
}

# NOTE: also install (via Helm, not shown): metrics-server, cluster-autoscaler,
# aws-load-balancer-controller, prometheus + prometheus-adapter (for HPA RPS),
# grafana, and external-secrets, see terraform/README.md.
