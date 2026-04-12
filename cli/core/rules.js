/**
 * Rule engine — fast pattern matching for the top 20 K8s + CI errors.
 * Runs before AI. High-confidence matches (>= 90) skip the AI call entirely.
 * Always returns: { ...result, confidence, via: 'rules' }  OR  null if no match.
 */

const RULES = [

  // ────────────────────── KUBERNETES ──────────────────────────────────────────

  {
    id: 'k8s-crashloop',
    test: /CrashLoopBackOff/i,
    result: {
      tool: 'kubernetes', severity: 'critical', confidence: 95,
      resource: 'Pod', namespace: 'unknown',
      summary: 'Pod is in CrashLoopBackOff — the container crashes repeatedly on startup.',
      rootCause: '1. Application exits with a non-zero code on startup.\n2. Missing required env vars, ConfigMap, or Secret.\n3. Liveness probe fires before app is ready (initialDelaySeconds too low).\n4. Port conflict inside the container.',
      impact: 'Pod is unavailable. Kubernetes applies exponential backoff (up to 5 min between restarts). Service is effectively down until fixed.',
      fixSteps: '- Check the actual crash reason: kubectl logs <pod> --previous\n- Verify all env vars, secrets, and config maps are mounted.\n- Increase initialDelaySeconds on the liveness probe.\n- Reproduce locally: docker run --env-file .env <image>',
      commands: 'kubectl logs <pod> --previous\nkubectl describe pod <pod>\nkubectl get pod <pod> -o yaml | grep -A10 livenessProbe',
      suggestions: [
        'Add a startupProbe so the liveness probe does not fire during slow initialization',
        'Set resource requests/limits to avoid the container being OOMKilled on startup',
        'Add a readiness probe so traffic is only sent when the app is truly ready',
      ],
    },
  },

  {
    id: 'k8s-oomkilled',
    test: /OOMKilled|exit(?:ed)?(?: with)?(?: code)? 137/i,
    result: {
      tool: 'kubernetes', severity: 'critical', confidence: 95,
      resource: 'Pod', namespace: 'unknown',
      summary: 'Container was OOMKilled — it exceeded its configured memory limit.',
      rootCause: '1. Memory limit set too low for the actual workload.\n2. Memory leak in the application (heap grows unbounded).\n3. Sudden traffic spike causing a memory burst.\n4. JVM / Node.js heap not configured to respect container limits.',
      impact: 'Container is killed immediately by the Linux OOM killer. Pod restarts. If this happens repeatedly it enters CrashLoopBackOff.',
      fixSteps: '- Check actual memory usage: kubectl top pod <pod>\n- Increase the memory limit in the deployment spec.\n- Profile the app for memory leaks.\n- For JVM: set -XX:MaxRAMPercentage=75.0 to respect container limits.',
      commands: 'kubectl top pod <pod>\nkubectl describe pod <pod> | grep -A5 OOM\nkubectl set resources deployment/<name> --limits=memory=512Mi',
      suggestions: [
        'Add a Horizontal Pod Autoscaler (HPA) to scale out under load instead of hitting limits',
        'Set up a VPA (Vertical Pod Autoscaler) to auto-tune memory limits over time',
        'Add a memory usage alert in Prometheus/Grafana at 80% of limit',
      ],
    },
  },

  {
    id: 'k8s-imagepull',
    test: /ImagePullBackOff|ErrImagePull|image pull failed|unauthorized.*registry|pull access denied/i,
    result: {
      tool: 'kubernetes', severity: 'critical', confidence: 95,
      resource: 'Pod', namespace: 'unknown',
      summary: 'Pod cannot pull its container image — registry authentication or image name issue.',
      rootCause: '1. Image name or tag is wrong / does not exist in the registry.\n2. Private registry requires authentication — imagePullSecrets not configured.\n3. Registry rate limit exceeded (DockerHub: 100 pulls/6h anonymous).\n4. Network policy blocking egress to the registry.',
      impact: 'Pod cannot start at all. Will remain in ImagePullBackOff indefinitely until the image or credentials are fixed.',
      fixSteps: '- Verify the image name and tag: docker pull <image:tag>\n- If private registry: create imagePullSecrets and attach to the pod/SA.\n- Check registry rate limits and use authenticated pulls.\n- Verify network policies allow egress to registry endpoints.',
      commands: 'kubectl describe pod <pod> | grep -A5 Events\nkubectl create secret docker-registry regcred --docker-server=<registry> --docker-username=<user> --docker-password=<pass>\nkubectl patch serviceaccount default -p \'{"imagePullSecrets": [{"name": "regcred"}]}\'',
      suggestions: [
        'Mirror frequently-used images to an internal registry to avoid rate limits',
        'Use image digests (sha256) instead of tags to guarantee immutable deployments',
        'Implement image pull policy: IfNotPresent to reduce registry calls',
      ],
    },
  },

  {
    id: 'k8s-pending',
    test: /pod.*pending|Pending.*pod|0\/\d+ nodes are available|insufficient (cpu|memory|pods)/i,
    result: {
      tool: 'kubernetes', severity: 'warning', confidence: 88,
      resource: 'Pod', namespace: 'unknown',
      summary: 'Pod is stuck in Pending — the scheduler cannot place it on any node.',
      rootCause: '1. Insufficient CPU or memory on all available nodes.\n2. Node selector or affinity rules not satisfied.\n3. Taint on all nodes without a matching toleration.\n4. PVC not bound — pod waits for storage.',
      impact: 'Pod never starts. Dependent services may be unavailable. HPA scale-up will be blocked.',
      fixSteps: '- Check node resource availability: kubectl top nodes\n- Review nodeSelector and affinity in the pod spec.\n- Check for taints on nodes: kubectl describe node <node> | grep Taints\n- Verify PVC is bound: kubectl get pvc',
      commands: 'kubectl describe pod <pod>\nkubectl top nodes\nkubectl get nodes -o wide\nkubectl describe pvc <pvc>',
      suggestions: [
        'Enable Cluster Autoscaler to automatically add nodes when resources are tight',
        'Use Pod Disruption Budgets (PDB) to prevent accidental over-eviction',
        'Review resource requests — over-requesting blocks scheduling',
      ],
    },
  },

  {
    id: 'k8s-create-container-error',
    test: /CreateContainerError|CreateContainerConfigError|configmap.*not found|secret.*not found/i,
    result: {
      tool: 'kubernetes', severity: 'critical', confidence: 92,
      resource: 'Pod', namespace: 'unknown',
      summary: 'Container cannot be created — missing ConfigMap or Secret reference.',
      rootCause: '1. A referenced ConfigMap does not exist in the namespace.\n2. A referenced Secret does not exist in the namespace.\n3. A volumeMount references a key that does not exist in the ConfigMap/Secret.\n4. Wrong namespace — resource exists but in a different namespace.',
      impact: 'Pod cannot start. All replicas in the deployment are affected.',
      fixSteps: '- Check what is missing: kubectl describe pod <pod> | grep -A5 Events\n- Create the missing ConfigMap or Secret.\n- Verify the namespace matches: kubectl get cm,secret -n <namespace>',
      commands: 'kubectl describe pod <pod> | grep -A10 Events\nkubectl get configmaps -n <namespace>\nkubectl get secrets -n <namespace>',
      suggestions: [
        'Use Helm or Kustomize to manage ConfigMaps/Secrets alongside deployments as a unit',
        'Add a pre-deploy check in CI that verifies all required config resources exist',
        'Consider using external-secrets-operator to sync secrets from a vault',
      ],
    },
  },

  {
    id: 'k8s-evicted',
    test: /Evicted|eviction|node.*pressure|DiskPressure|MemoryPressure/i,
    result: {
      tool: 'kubernetes', severity: 'warning', confidence: 90,
      resource: 'Pod', namespace: 'unknown',
      summary: 'Pod was evicted — node is under resource pressure (disk or memory).',
      rootCause: '1. Node disk usage above eviction threshold (default 85%).\n2. Node memory pressure — kubelet evicts lower-priority pods.\n3. No resource requests set — pod treated as BestEffort and evicted first.\n4. Log or temp file accumulation on the node.',
      impact: 'Pod is terminated and rescheduled. If all nodes are under pressure, pod stays in Pending.',
      fixSteps: '- Check node conditions: kubectl describe node <node> | grep -A5 Conditions\n- Free up disk: remove unused images on nodes.\n- Set resource requests on all pods to ensure QoS class is Burstable or Guaranteed.',
      commands: 'kubectl describe node <node> | grep -A10 Conditions\nkubectl get pods --field-selector=status.reason=Evicted --all-namespaces\nkubectl delete pods --field-selector=status.reason=Evicted --all-namespaces',
      suggestions: [
        'Set up node disk usage alerts at 75% to catch pressure before evictions occur',
        'Configure imagePullPolicy: IfNotPresent and run image cleanup CronJobs',
        'Assign proper resource QoS classes — avoid BestEffort pods in production',
      ],
    },
  },

  {
    id: 'k8s-rbac-forbidden',
    test: /forbidden|User.*cannot|RBAC.*denied|does not have.*permission|403/,
    result: {
      tool: 'kubernetes', severity: 'warning', confidence: 85,
      resource: 'ServiceAccount', namespace: 'unknown',
      summary: 'Kubernetes RBAC permission denied — a service account or user lacks required access.',
      rootCause: '1. ServiceAccount does not have a ClusterRole or Role bound.\n2. Role grants access but not in the right namespace.\n3. Resource name is correct but API group is wrong in the Role.\n4. User or group not mapped in the cluster\'s OIDC/auth config.',
      impact: 'The requesting pod/user cannot perform the operation. API calls fail with 403.',
      fixSteps: '- Check what permissions are missing: kubectl auth can-i <verb> <resource> --as=system:serviceaccount:<ns>:<sa>\n- Create a Role/ClusterRole with the required permissions.\n- Bind it with a RoleBinding/ClusterRoleBinding.',
      commands: 'kubectl auth can-i --list --as=system:serviceaccount:<namespace>:<sa-name>\nkubectl describe rolebinding,clusterrolebinding -A | grep <sa-name>\nkubectl create clusterrolebinding <name> --clusterrole=<role> --serviceaccount=<ns>:<sa>',
      suggestions: [
        'Follow least-privilege: grant only the specific verbs and resources needed',
        'Use nxs rbac scan to audit all RBAC misconfigurations in the cluster',
        'Audit RBAC bindings regularly — remove stale bindings from deleted SAs',
      ],
    },
  },

  {
    id: 'k8s-pvc-unbound',
    test: /PersistentVolumeClaim.*unbound|pvc.*pending|no persistent volumes available|storageclass.*not found/i,
    result: {
      tool: 'kubernetes', severity: 'warning', confidence: 88,
      resource: 'PersistentVolumeClaim', namespace: 'unknown',
      summary: 'PersistentVolumeClaim is not bound — no matching PersistentVolume available.',
      rootCause: '1. No PersistentVolume matches the PVC\'s storageClass and capacity request.\n2. StorageClass does not exist or has no provisioner configured.\n3. PVC access mode (ReadWriteMany) not supported by the storage backend.\n4. Volume reclaim policy: Retain — old PV is Released, not reusable.',
      impact: 'Any pod that mounts this PVC stays in Pending state and never starts.',
      fixSteps: '- Check PVC status: kubectl describe pvc <name>\n- Verify the StorageClass exists: kubectl get storageclass\n- Create a PV manually or ensure the dynamic provisioner is configured.',
      commands: 'kubectl describe pvc <name>\nkubectl get storageclass\nkubectl get pv\nkubectl get events --field-selector=involvedObject.name=<pvc-name>',
      suggestions: [
        'Use a dynamic provisioner (EBS CSI, GCE PD CSI) to avoid manual PV management',
        'Set a default StorageClass so PVCs without explicit class still get provisioned',
        'Monitor PVC capacity and set up alerts before volumes fill up',
      ],
    },
  },

  {
    id: 'k8s-node-not-ready',
    test: /NotReady|node.*not ready|node.*unreachable/i,
    result: {
      tool: 'kubernetes', severity: 'critical', confidence: 90,
      resource: 'Node', namespace: 'cluster',
      summary: 'Kubernetes node is NotReady — the kubelet is not responding or the node is unreachable.',
      rootCause: '1. Kubelet process crashed or stopped on the node.\n2. Network partition between the node and the API server.\n3. Node ran out of disk space or memory, causing kubelet to be killed.\n4. Node was terminated by the cloud provider (spot instance).',
      impact: 'All pods on the node are evicted after the tolerationSeconds (default 5 min). Workload is disrupted until pods reschedule.',
      fixSteps: '- Check node status: kubectl describe node <node>\n- SSH to the node and check kubelet: systemctl status kubelet\n- Review cloud provider console for instance health.\n- Cordon and drain the node if it cannot recover.',
      commands: 'kubectl describe node <node>\nkubectl cordon <node>\nkubectl drain <node> --ignore-daemonsets --delete-emptydir-data\nsystemctl status kubelet  # run on the node',
      suggestions: [
        'Use node auto-repair (GKE) or instance auto-recovery (AWS) to automatically replace unhealthy nodes',
        'Spread workloads with pod anti-affinity to avoid all replicas landing on one node',
        'Set up node health monitoring alerts at the infrastructure level',
      ],
    },
  },

  // ────────────────────── CI / CD ──────────────────────────────────────────────

  {
    id: 'ci-npm-test-fail',
    test: /npm test|jest|mocha|vitest.*fail|Tests? failed|FAIL .*test/i,
    result: {
      tool: 'github-actions', severity: 'critical', confidence: 80,
      pipeline: 'unknown', step: 'Run tests',
      summary: 'CI test suite failed — one or more tests are failing.',
      rootCause: '1. Test assertion failure — code behavior does not match expectation.\n2. Missing environment variable or secret not configured in CI.\n3. Database or service dependency not available in CI (missing service container).\n4. Flaky test caused by timing or state leakage between tests.',
      impact: 'Build blocked. PR cannot merge until tests pass.',
      fixSteps: '1. Run tests locally: npm test -- --verbose\n2. Check CI environment variables match local .env\n3. If test was passing before: check recent code changes with git diff\n4. If flaky: add retry logic or fix test isolation',
      commands: 'npm test -- --verbose 2>&1 | tail -50\ngit diff HEAD~1 -- "*.test.*"\nnpm test -- --testNamePattern "<failing test name>"',
      suggestions: [
        'Add test coverage threshold enforcement to catch regressions early',
        'Use test sharding to parallelize slow test suites in CI',
        'Tag flaky tests with @flaky and report them separately to avoid blocking builds',
      ],
    },
  },

  {
    id: 'ci-docker-auth',
    test: /unauthorized.*docker|denied.*registry|docker login|pull access denied|authentication required/i,
    result: {
      tool: 'github-actions', severity: 'critical', confidence: 92,
      pipeline: 'unknown', step: 'Docker build/push',
      summary: 'Docker registry authentication failed — credentials not configured or expired.',
      rootCause: '1. CI/CD registry credentials not set as secrets.\n2. Docker login step missing from the workflow.\n3. Personal access token expired.\n4. DockerHub rate limit reached for unauthenticated pulls.',
      impact: 'Docker build or push step fails. Deployment cannot proceed.',
      fixSteps: '1. Add registry credentials as CI secrets (DOCKER_USERNAME, DOCKER_PASSWORD)\n2. Add a docker login step before build/push\n3. For GitHub Actions: use docker/login-action\n4. Regenerate expired access tokens',
      commands: 'docker login -u $DOCKER_USERNAME -p $DOCKER_PASSWORD\n# GitHub Actions:\n# - uses: docker/login-action@v3\n#   with:\n#     username: ${{ secrets.DOCKER_USERNAME }}\n#     password: ${{ secrets.DOCKER_TOKEN }}',
      suggestions: [
        'Use GITHUB_TOKEN with ghcr.io (GitHub Container Registry) to avoid DockerHub rate limits',
        'Rotate registry credentials on a schedule and automate the secret update',
        'Cache Docker layers in CI to speed up builds and reduce registry pulls',
      ],
    },
  },

  {
    id: 'ci-module-not-found',
    test: /ModuleNotFoundError|Cannot find module|module not found|No module named/i,
    result: {
      tool: 'github-actions', severity: 'critical', confidence: 88,
      pipeline: 'unknown', step: 'Install / run',
      summary: 'A required module or package is missing — dependency not installed or not listed.',
      rootCause: '1. Package installed locally but not added to package.json / requirements.txt.\n2. Package installed in wrong environment or virtual env not activated.\n3. npm/pip install step failed silently in a previous step.\n4. Wrong Node.js or Python version with incompatible package.',
      impact: 'Build or test step fails immediately. Cannot proceed.',
      fixSteps: '1. Add the missing package: npm install <package> --save  OR  pip install <package>\n2. Commit the updated package.json / requirements.txt\n3. In CI: ensure install step runs before the failing step\n4. Pin versions to avoid "works locally" drift',
      commands: 'npm install\nnpm list <package>\npip install -r requirements.txt\npip freeze | grep <package>',
      suggestions: [
        'Use npm ci instead of npm install in CI for reproducible installs from lockfile',
        'Cache node_modules or pip cache in CI to speed up installs',
        'Add a pre-commit hook that checks package.json stays in sync with node_modules',
      ],
    },
  },

  {
    id: 'ci-syntax-error',
    test: /SyntaxError|syntax error|unexpected token|parse error|IndentationError/i,
    result: {
      tool: 'github-actions', severity: 'critical', confidence: 85,
      pipeline: 'unknown', step: 'Lint / build',
      summary: 'Syntax error in source code — build or lint step failed to parse the file.',
      rootCause: '1. Typo or invalid syntax in recently changed code.\n2. Wrong file encoding (BOM characters, mixed line endings).\n3. Template literal or JSX not supported without proper Babel/transpiler config.\n4. Python indentation error.',
      impact: 'Build fails immediately. No tests can run.',
      fixSteps: '1. Run linter locally: npm run lint  OR  flake8 .\n2. Check the file and line number in the error output\n3. Ensure editor auto-format settings match the project\'s ESLint/prettier config',
      commands: 'npm run lint\nnpx eslint --fix .\nflake8 . --statistics\npython -m py_compile <file.py>',
      suggestions: [
        'Add a pre-commit hook (husky + lint-staged) to catch syntax errors before push',
        'Enable format-on-save in your editor with the project\'s prettier config',
        'Add type checking (TypeScript strict mode or mypy) to catch more errors statically',
      ],
    },
  },

  {
    id: 'ci-connection-refused',
    test: /ECONNREFUSED|connection refused|connect ETIMEDOUT|getaddrinfo ENOTFOUND|could not connect to/i,
    result: {
      tool: 'github-actions', severity: 'critical', confidence: 82,
      pipeline: 'unknown', step: 'Test / integration',
      summary: 'Network connection refused — a required service is not reachable in CI.',
      rootCause: '1. Database or service container not started before the test step.\n2. Wrong hostname — localhost vs container service name.\n3. Service not ready (startup delay) — no health check wait.\n4. Firewall or network policy blocking the connection.',
      impact: 'Integration tests or service calls fail. Build is blocked.',
      fixSteps: '1. Add the service container to the CI job (services: section in GitHub Actions)\n2. Use the service name as hostname, not localhost\n3. Add a wait-for step: wait-for-it.sh or dockerize\n4. Check port numbers match the service config',
      commands: '# GitHub Actions service container:\n# services:\n#   postgres:\n#     image: postgres:15\n#     env:\n#       POSTGRES_PASSWORD: test\n#     ports:\n#       - 5432:5432\n#     options: >-\n#       --health-cmd pg_isready\n#       --health-interval 10s',
      suggestions: [
        'Use docker-compose for local parity with CI service containers',
        'Add explicit health checks and depends_on to service containers',
        'Consider contract testing (Pact) to test service interactions without live services',
      ],
    },
  },

  {
    id: 'ci-oom',
    test: /out of memory|Killed.*signal|heap out of memory|java\.lang\.OutOfMemoryError|Cannot allocate memory/i,
    result: {
      tool: 'github-actions', severity: 'critical', confidence: 88,
      pipeline: 'unknown', step: 'Build / test',
      summary: 'CI runner ran out of memory — build process was killed by the OS.',
      rootCause: '1. Build process (webpack, Java, etc.) exceeds the runner\'s memory limit.\n2. Node.js default heap (1.5GB) too small for large builds.\n3. Too many parallel Jest workers consuming memory simultaneously.\n4. Memory leak in a test or build tool.',
      impact: 'Build step killed mid-run. No artifacts produced.',
      fixSteps: '1. Increase Node.js heap: NODE_OPTIONS="--max-old-space-size=4096"\n2. Reduce Jest workers: --maxWorkers=2\n3. For Java: increase -Xmx in the build command\n4. Upgrade to a larger CI runner if available',
      commands: 'NODE_OPTIONS="--max-old-space-size=4096" npm run build\nnpx jest --maxWorkers=2\n# Java: mvn -T 1 -Xmx2g package',
      suggestions: [
        'Profile memory usage locally with --inspect and Chrome DevTools before hitting CI limits',
        'Split large builds into separate jobs with artifact passing',
        'Consider build caching to avoid rebuilding unchanged modules',
      ],
    },
  },

  {
    id: 'ci-permission-denied',
    test: /Permission denied|permission denied|EPERM|EACCES|not permitted|access denied/i,
    result: {
      tool: 'github-actions', severity: 'warning', confidence: 80,
      pipeline: 'unknown', step: 'Deploy / script',
      summary: 'Permission denied — the CI process lacks access to a file, directory, or resource.',
      rootCause: '1. Script not executable: missing chmod +x.\n2. Trying to write to a read-only directory.\n3. Cloud credentials (IAM role/key) lack required permissions.\n4. Docker socket not available to non-root CI process.',
      impact: 'Step fails. Deployment or artifact creation blocked.',
      fixSteps: '1. Add execute permission: chmod +x script.sh\n2. Check IAM role permissions for the deploy step\n3. For Docker: ensure CI user is in the docker group\n4. Use sudo only if absolutely needed and security is not a concern',
      commands: 'chmod +x scripts/*.sh\nls -la <file>\naws iam get-user\ngcloud auth list',
      suggestions: [
        'Commit scripts with the executable bit set: git update-index --chmod=+x script.sh',
        'Follow least-privilege for CI IAM roles — scope to the minimum required actions',
        'Document required IAM permissions in the repo so they can be reproduced',
      ],
    },
  },

  {
    id: 'ci-timeout',
    test: /timed? out|timeout exceeded|step.*exceeded.*timeout|cancell?ed.*timeout/i,
    result: {
      tool: 'github-actions', severity: 'warning', confidence: 78,
      pipeline: 'unknown', step: 'unknown',
      summary: 'CI step timed out — an operation took longer than the allowed duration.',
      rootCause: '1. Test suite is too slow — no parallelization.\n2. Waiting for a service that never became healthy.\n3. Infinite loop or deadlock in test code.\n4. Network request hung without a timeout.',
      impact: 'Build is cancelled. No result or artifacts from the timed-out step.',
      fixSteps: '1. Increase the timeout-minutes in the job/step config if justified\n2. Parallelize tests: use matrix strategy or jest --shard\n3. Add health check timeouts to service containers\n4. Add request timeouts to all external HTTP calls in tests',
      commands: '# Increase timeout in GitHub Actions:\n# jobs:\n#   build:\n#     timeout-minutes: 30\n\n# Parallel jest shards:\n# npx jest --shard=1/4  # run on 4 parallel runners',
      suggestions: [
        'Set explicit timeout-minutes on all jobs — the default (6h) hides slow regressions',
        'Track test suite duration over time and alert when it increases by >20%',
        'Profile the slowest tests: npx jest --verbose --testTimeout=5000',
      ],
    },
  },

  {
    id: 'ci-terraform-error',
    test: /terraform.*error|Error:.*resource|plan.*failed|apply.*failed|provider.*not found/i,
    result: {
      tool: 'github-actions', severity: 'critical', confidence: 82,
      pipeline: 'unknown', step: 'Terraform plan/apply',
      summary: 'Terraform operation failed — resource configuration or state issue.',
      rootCause: '1. Required provider not downloaded: run terraform init.\n2. State drift — resource exists in cloud but not in state.\n3. Invalid resource attribute or missing required argument.\n4. Cloud credentials expired or insufficient IAM permissions.',
      impact: 'Infrastructure changes blocked. Deployment cannot proceed.',
      fixSteps: '1. Run terraform init to download providers\n2. Run terraform plan first to see what would change\n3. For state drift: terraform import <resource> <id>\n4. Check cloud credentials: terraform providers lock',
      commands: 'terraform init\nterraform plan -out=plan.tfplan\nterraform apply plan.tfplan\nterraform state list',
      suggestions: [
        'Store Terraform state in a remote backend (S3, GCS) — never local in CI',
        'Add terraform fmt and terraform validate checks as separate CI steps before plan',
        'Use Atlantis or Spacelift for PR-based Terraform workflow with approvals',
      ],
    },
  },

  {
    id: 'ci-java-compile',
    test: /BUILD FAILED|cannot find symbol|error:.*\.java|compilation failed|mvn.*failed/i,
    result: {
      tool: 'jenkins', severity: 'critical', confidence: 85,
      pipeline: 'unknown', step: 'compile / mvn package',
      summary: 'Java compilation failed — source code has errors the compiler cannot resolve.',
      rootCause: '1. Importing a class or method that does not exist or is not on the classpath.\n2. Missing Maven dependency not declared in pom.xml.\n3. Wrong Java version — using Java 17+ syntax on older JDK.\n4. Generated code not present (annotation processor not run).',
      impact: 'Build produces no artifacts. All downstream steps are skipped.',
      fixSteps: '1. Run locally with full error output: mvn clean package -e\n2. Check the import causing "cannot find symbol" — add the dependency to pom.xml\n3. Verify Java version: java -version vs .mvn/wrapper/maven-wrapper.properties\n4. Run mvn generate-sources if using annotation processors',
      commands: 'mvn clean package -e 2>&1 | grep -A5 "ERROR"\nmvn dependency:tree | grep <missing-artifact>\nmvn generate-sources compile',
      suggestions: [
        'Add compiler warnings as errors (-Werror) to catch issues earlier',
        'Use dependabot or renovate to keep Maven dependencies up to date',
        'Pin the Maven wrapper version in .mvn/wrapper for reproducible builds',
      ],
    },
  },

];

/**
 * Test a log string against all rules. Returns the first match or null.
 * @param {string} logText
 * @returns {{ ...result, via: 'rules' } | null}
 */
export function matchRule(logText) {
  for (const rule of RULES) {
    if (rule.test.test(logText)) {
      return { ...rule.result, via: 'rules' };
    }
  }
  return null;
}

/**
 * Expose all rules for the test command and documentation.
 */
export { RULES };
