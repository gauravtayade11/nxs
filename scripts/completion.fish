# nxs fish completion
# Install: nxs completion fish > ~/.config/fish/completions/nxs.fish

# Top-level commands
set -l nxs_cmds devops cloud k8s sec net db ci explain watch serve rbac status predict incident autopilot info test update config history report

function __nxs_no_subcommand
  set -l cmd (commandline -poc)
  set -l found 0
  for c in $nxs_cmds
    if contains -- $c $cmd
      set found 1
      break
    end
  end
  test $found -eq 0
end

# Top-level completions
complete -c nxs -f -n '__nxs_no_subcommand' -a devops   -d 'Debug CI/CD pipelines, Docker builds, Terraform errors'
complete -c nxs -f -n '__nxs_no_subcommand' -a cloud    -d 'Diagnose AWS, GCP, and Azure errors'
complete -c nxs -f -n '__nxs_no_subcommand' -a k8s      -d 'Deep-dive Kubernetes debugging'
complete -c nxs -f -n '__nxs_no_subcommand' -a sec      -d 'Analyze security scan output'
complete -c nxs -f -n '__nxs_no_subcommand' -a net      -d 'Diagnose network errors'
complete -c nxs -f -n '__nxs_no_subcommand' -a db       -d 'Analyze database errors'
complete -c nxs -f -n '__nxs_no_subcommand' -a ci       -d 'Analyze CI/CD pipeline failure logs'
complete -c nxs -f -n '__nxs_no_subcommand' -a explain  -d 'Explain any DevOps term or error'
complete -c nxs -f -n '__nxs_no_subcommand' -a watch    -d 'Tail a log file or live command'
complete -c nxs -f -n '__nxs_no_subcommand' -a serve    -d 'Start the nxs REST API server'
complete -c nxs -f -n '__nxs_no_subcommand' -a rbac     -d 'Scan Kubernetes RBAC'
complete -c nxs -f -n '__nxs_no_subcommand' -a status   -d 'Live cluster dashboard'
complete -c nxs -f -n '__nxs_no_subcommand' -a predict  -d 'Predict pod failures before they happen'
complete -c nxs -f -n '__nxs_no_subcommand' -a incident -d 'Full incident commander'
complete -c nxs -f -n '__nxs_no_subcommand' -a autopilot -d 'Watch cluster and auto-apply safe fixes'
complete -c nxs -f -n '__nxs_no_subcommand' -a info     -d 'What is nxs?'
complete -c nxs -f -n '__nxs_no_subcommand' -a test     -d 'Run a built-in test scenario'
complete -c nxs -f -n '__nxs_no_subcommand' -a update   -d 'Check for latest version'
complete -c nxs -f -n '__nxs_no_subcommand' -a config   -d 'Manage API keys and settings'
complete -c nxs -f -n '__nxs_no_subcommand' -a history  -d 'Show past analyses'
complete -c nxs -f -n '__nxs_no_subcommand' -a report   -d 'Generate digest of past analyses'

# k8s subcommands
complete -c nxs -f -n '__fish_seen_subcommand_from k8s' -a debug     -d 'Debug a Kubernetes error or pod log'
complete -c nxs -f -n '__fish_seen_subcommand_from k8s' -a history   -d 'Show past Kubernetes analyses'
complete -c nxs -f -n '__fish_seen_subcommand_from k8s' -a events    -d 'Fetch and AI-triage cluster events'
complete -c nxs -f -n '__fish_seen_subcommand_from k8s' -a errors    -d 'Common Kubernetes errors reference'
complete -c nxs -f -n '__fish_seen_subcommand_from k8s' -a status    -d 'Cluster overview'
complete -c nxs -f -n '__fish_seen_subcommand_from k8s' -a pods      -d 'Pod counts and health by namespace'

# k8s flags
complete -c nxs -n '__fish_seen_subcommand_from k8s' -l namespace -s n -d 'Kubernetes namespace'
complete -c nxs -n '__fish_seen_subcommand_from k8s' -l pod       -d 'Pod name'
complete -c nxs -n '__fish_seen_subcommand_from k8s' -l deployment -d 'Deployment name'
complete -c nxs -n '__fish_seen_subcommand_from k8s' -l stdin     -d 'Read input from stdin'
complete -c nxs -n '__fish_seen_subcommand_from k8s' -l redact    -d 'Scrub secrets before AI'
complete -c nxs -n '__fish_seen_subcommand_from k8s' -l json      -d 'Output as JSON'

# devops subcommands
complete -c nxs -f -n '__fish_seen_subcommand_from devops' -a analyze   -d 'Analyze a DevOps log'
complete -c nxs -f -n '__fish_seen_subcommand_from devops' -a history   -d 'Show past DevOps analyses'
complete -c nxs -f -n '__fish_seen_subcommand_from devops' -a watch     -d 'Tail a live log file'
complete -c nxs -f -n '__fish_seen_subcommand_from devops' -a examples  -d 'Show example error logs'
complete -c nxs -f -n '__fish_seen_subcommand_from devops' -a pipelines -d 'GitHub Actions pipeline status'

# sec subcommands
complete -c nxs -f -n '__fish_seen_subcommand_from sec' -a scan       -d 'Analyze a security scan report'
complete -c nxs -f -n '__fish_seen_subcommand_from sec' -a history    -d 'Show past security analyses'
complete -c nxs -f -n '__fish_seen_subcommand_from sec' -a cluster    -d 'Scan all cluster images with trivy'
complete -c nxs -f -n '__fish_seen_subcommand_from sec' -a severities -d 'CVE severity reference card'

# sec flags
complete -c nxs -n '__fish_seen_subcommand_from sec' -l image     -d 'Docker image to scan'
complete -c nxs -n '__fish_seen_subcommand_from sec' -l pod       -d 'Pod name'
complete -c nxs -n '__fish_seen_subcommand_from sec' -l namespace -s n -d 'Kubernetes namespace'
complete -c nxs -n '__fish_seen_subcommand_from sec' -l severity  -d 'Min severity filter'
complete -c nxs -n '__fish_seen_subcommand_from sec' -l json      -d 'Output as JSON'

# incident subcommands
complete -c nxs -f -n '__fish_seen_subcommand_from incident' -a start      -d 'Start a new incident'
complete -c nxs -f -n '__fish_seen_subcommand_from incident' -a update     -d 'Add an update to an incident'
complete -c nxs -f -n '__fish_seen_subcommand_from incident' -a close      -d 'Close and resolve an incident'
complete -c nxs -f -n '__fish_seen_subcommand_from incident' -a list       -d 'List all incidents'
complete -c nxs -f -n '__fish_seen_subcommand_from incident' -a view       -d 'View incident timeline'
complete -c nxs -f -n '__fish_seen_subcommand_from incident' -a postmortem -d 'AI-generated postmortem'

# predict flags
complete -c nxs -n '__fish_seen_subcommand_from predict' -l namespace  -s n -d 'Kubernetes namespace'
complete -c nxs -n '__fish_seen_subcommand_from predict' -l pod        -d 'Pod name'
complete -c nxs -n '__fish_seen_subcommand_from predict' -l deployment -d 'Deployment name'
complete -c nxs -n '__fish_seen_subcommand_from predict' -l watch      -d 'Watch mode'
complete -c nxs -n '__fish_seen_subcommand_from predict' -l threshold  -d 'Risk score threshold (0-100)'
complete -c nxs -n '__fish_seen_subcommand_from predict' -l json       -d 'Output as JSON'

# watch flags
complete -c nxs -n '__fish_seen_subcommand_from watch' -l cooldown  -d 'Min seconds between analyses'
complete -c nxs -n '__fish_seen_subcommand_from watch' -l context   -d 'Lines of context per analysis'
complete -c nxs -n '__fish_seen_subcommand_from watch' -l severity  -d 'Min severity (critical|warning)'
complete -c nxs -n '__fish_seen_subcommand_from watch' -l notify    -d 'Alert target (slack)'
complete -c nxs -n '__fish_seen_subcommand_from watch' -l redact    -d 'Scrub secrets before AI'

# config flags
complete -c nxs -n '__fish_seen_subcommand_from config' -l setup  -d 'Interactive setup wizard'
complete -c nxs -n '__fish_seen_subcommand_from config' -l show   -d 'Show current config'
complete -c nxs -n '__fish_seen_subcommand_from config' -l reset  -d 'Reset all settings'

# global flags
complete -c nxs -s v -l version -d 'Show version'
complete -c nxs -s h -l help    -d 'Show help'
