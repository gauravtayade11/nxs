export const EXAMPLE_LOGS = [
  {
    label: 'Kubernetes',
    tool: 'kubernetes',
    log: `Warning  Failed     2m    kubelet  Failed to pull image "myrepo/web-app:v2.1.0": rpc error: code = Unknown desc = failed to pull and unpack image "docker.io/myrepo/web-app:v2.1.0": failed to resolve reference "docker.io/myrepo/web-app:v2.1.0": pull access denied, repository does not exist or may require 'docker login': denied: requested access to the resource is denied
Warning  Failed     2m    kubelet  Error: ErrImagePull
Warning  BackOff    90s   kubelet  Back-off pulling image "myrepo/web-app:v2.1.0"
Warning  Failed     90s   kubelet  Error: ImagePullBackOff
  Normal   Scheduled  3m    default-scheduler  Successfully assigned default/web-deployment-7d4b5c6f9-xk2p8 to node-1
  Normal   Pulling    3m    kubelet  Pulling image "myrepo/web-app:v2.1.0"`
  },
  {
    label: 'Docker',
    tool: 'docker',
    log: `#12 [build 6/9] RUN npm install
#12 2.341 npm warn deprecated inflight@1.0.6: This module is not supported
#12 58.123 npm error code EACCES
#12 58.124 npm error syscall mkdir
#12 58.125 npm error path /root/.npm/_cacache
#12 58.126 npm error errno -13
#12 58.127 npm error
#12 58.128 npm error Your cache folder contains root-owned files, due to a bug in
#12 58.129 npm error previous versions of npm which has since been addressed.
#12 58.130 npm error
#12 58.131 npm error To permanently fix this problem, please run:
#12 58.132 npm error   sudo chown -R 1000:1000 "/root/.npm"
#12 58.133 npm error A complete log of this run can be found in: /root/.npm/_logs/2024-01-15T10_22_45_123Z-debug-0.log
------
executor failed running [/bin/sh -c npm install]: exit code: 243`
  },
  {
    label: 'Terraform',
    tool: 'terraform',
    log: `╷
│ Error: Invalid resource type
│
│   on main.tf line 14, in resource "aws_s3_buckets" "app_storage":
│   14: resource "aws_s3_buckets" "app_storage" {
│
│ The provider hashicorp/aws does not support resource type "aws_s3_buckets".
│ Did you mean "aws_s3_bucket"?
╵
╷
│ Error: Unsupported argument
│
│   on main.tf line 22, in resource "aws_s3_bucket" "logs":
│   22:   region = "us-east-1"
│
│ An argument named "region" is not expected here. The AWS provider infers
│ the region from the provider configuration.
╵`
  },
  {
    label: 'CI/CD',
    tool: 'ci',
    log: `Run npm install --frozen-lockfile
npm warn config frozen-lockfile
npm error code ENOTFOUND
npm error errno ENOTFOUND
npm error network request to https://registry.npmjs.org/react failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
npm error network
npm error network If you are behind a proxy, please make sure that the
npm error network 'proxy' config is set properly. See: 'npm help config'
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2024-01-15T10_22_45_123Z-debug-0.log
Error: Process completed with exit code 1.`
  }
];
