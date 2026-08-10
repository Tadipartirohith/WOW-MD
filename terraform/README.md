# WOW infrastructure with Terraform

This folder provisions the cloud foundation for the platform on AWS. It creates the network, the Kubernetes cluster with an autoscaling node group, an Aurora PostgreSQL database with a writer and a reader across availability zones, and an ElastiCache Redis replication group.

## How to use it

First copy the example variables file to terraform.tfvars and fill in your real values, then supply the database password through the environment so it never sits in a file. After that you initialise, review the plan, and apply.

```
cd terraform
cp terraform.tfvars.example terraform.tfvars
export TF_VAR_db_password='a-strong-password'
terraform init
terraform plan
terraform apply
```

Once the cluster exists you point kubectl at it and deploy the application from the k8s folder. The k8s readme explains the four real values you fill in there, which are the image, the domain, the certificate, and the secret.

```
aws eks update-kubeconfig --name wow-eks --region ap-south-1
kubectl apply -k ../k8s/
```

## Cluster add ons

After the cluster is created you install a few standard components with Helm. You need the metrics server so the autoscaler can read processor use, the cluster autoscaler so nodes are added and removed automatically, the AWS load balancer controller so the ingress works, Prometheus and its adapter so the autoscaler can also scale on request rate, Grafana for dashboards, and the external secrets operator so the application secret is filled from AWS Secrets Manager.

## Notes

The Terraform state should live in a remote backend such as an S3 bucket with a DynamoDB lock table, and the settings for that are shown in the main file. Deletion protection is turned on for the database, so you must turn it off on purpose before you tear the environment down. This is a production shaped starting point, so review the sizing, the network ranges, and the permissions before you use it for real.
