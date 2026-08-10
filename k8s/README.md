# Kubernetes deployment

These manifests deploy the WOW backend to a cluster such as EKS. They are a working starting point, and there are four real values you must fill in before applying them.

The first value is the container image. Set it in kustomization.yaml under images, using the address of your registry and the tag your pipeline built, for example an ECR address ending in wow-backend with the tag latest. Kustomize then rewrites the image in the deployment and in the migration job for you.

The second value is the ingress host. Open ingress.yaml and replace api.wow.example.com with the domain you will actually use.

The third value is the TLS certificate. In ingress.yaml replace the placeholder that reads ACM_CERT_ARN with the Amazon Resource Name of your certificate from AWS Certificate Manager.

The fourth value is the set of secrets. Do not apply secret.example.yaml as it is, because it only contains placeholders. In a real cluster you create the secret named wow-backend-secrets from your secret manager, for example with the External Secrets Operator, so the database password, the Redis password, and the token secrets come from a safe source rather than a file in the repository.

Once those are set you apply everything with kubectl apply and the k flag pointing at this folder. The database migration job runs first as a one time step, and the deployment rolls out with health checks, automatic scaling, and a disruption budget already configured. Neo4j and Kafka are optional and are expected to be managed services in production, so you enable them by setting the enabled flags and the connection details in the config map and the secret, not by running them inside this cluster.
