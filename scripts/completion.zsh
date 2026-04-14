#compdef nxs
# nxs zsh completion
# Install: source <(nxs completion zsh)
#      or: nxs completion zsh >> ~/.zshrc
#      or: nxs completion zsh > "${fpath[1]}/_nxs"

_nxs() {
  local context state state_descr line
  typeset -A opt_args

  _arguments \
    '(-v --version)'{-v,--version}'[show version]' \
    '(-h --help)'{-h,--help}'[show help]' \
    '1: :_nxs_commands' \
    '*:: :->args'

  case $state in
    args)
      case $words[1] in
        devops)   _nxs_devops ;;
        k8s)      _nxs_k8s ;;
        sec)      _nxs_sec ;;
        incident) _nxs_incident ;;
        cloud)    _arguments '1: :(analyze history)' ;;
        net)      _arguments '1: :(analyze history)' ;;
        db)       _arguments '1: :(analyze history)' ;;
        ci)       _arguments '1: :(analyze history)' ;;
        rbac)     _arguments '1: :(scan history)' ;;
        predict)  _nxs_predict ;;
        watch)    _nxs_watch ;;
        config)   _arguments '(--setup --show --reset)' ;;
        status)   _arguments '(--namespace --watch --interval)' ;;
        autopilot) _arguments '(--namespace --interval --dry-run)' ;;
        history)  _arguments '(--limit --tool --json)' ;;
      esac
      ;;
  esac
}

_nxs_commands() {
  local commands
  commands=(
    'devops:Debug CI/CD pipelines, Docker builds, Terraform errors'
    'cloud:Diagnose AWS, GCP, and Azure errors'
    'k8s:Deep-dive Kubernetes debugging'
    'sec:Analyze security scan output'
    'net:Diagnose network errors'
    'db:Analyze database errors'
    'ci:Analyze CI/CD pipeline failure logs'
    'explain:Explain any DevOps term or error'
    'watch:Tail a log file or live command'
    'serve:Start the nxs REST API server'
    'rbac:Scan Kubernetes RBAC'
    'status:Live cluster dashboard'
    'predict:Predict pod failures before they happen'
    'incident:Full incident commander'
    'autopilot:Watch cluster and auto-apply safe fixes'
    'info:What is nxs?'
    'test:Run a built-in test scenario'
    'update:Check for latest version'
    'config:Manage API keys and settings'
    'history:Show past analyses'
    'report:Generate a digest of past analyses'
  )
  _describe 'nxs commands' commands
}

_nxs_devops() {
  local subcmds
  subcmds=(
    'analyze:Analyze a DevOps log'
    'history:Show past DevOps analyses'
    'watch:Tail a live log file'
    'examples:Show example error logs'
    'pipelines:GitHub Actions pipeline status'
  )
  _arguments '1: :->subcmd' '*:: :->args'
  case $state in
    subcmd) _describe 'devops subcommands' subcmds ;;
    args)
      case $words[1] in
        analyze) _arguments '(--stdin --interactive --redact --namespace --pod --deployment --notify --json --fast)' ;;
        watch)   _arguments '(--interval --cooldown --context --severity --notify)' ;;
        pipelines) _arguments '(--repo --limit --json)' ;;
      esac
      ;;
  esac
}

_nxs_k8s() {
  local subcmds
  subcmds=(
    'debug:Debug a Kubernetes error or pod log'
    'history:Show past Kubernetes analyses'
    'events:Fetch and AI-triage cluster events'
    'errors:Quick reference for common Kubernetes errors'
    'status:Cluster overview'
    'pods:Pod counts and health by namespace'
  )
  _arguments '1: :->subcmd' '*:: :->args'
  case $state in
    subcmd) _describe 'k8s subcommands' subcmds ;;
    args)
      case $words[1] in
        debug)  _arguments '(--stdin --interactive --redact --namespace -n --pod --deployment --notify --json --fast)' ;;
        events) _arguments '(--namespace -n --json)' ;;
        status) _arguments '(--namespace -n)' ;;
        pods)   _arguments '(--namespace -n --json)' ;;
      esac
      ;;
  esac
}

_nxs_sec() {
  local subcmds
  subcmds=(
    'scan:Analyze a security scan report'
    'history:Show past security scan analyses'
    'cluster:Scan all cluster images with trivy'
    'severities:CVE severity reference card'
  )
  _arguments '1: :->subcmd' '*:: :->args'
  case $state in
    subcmd) _describe 'sec subcommands' subcmds ;;
    args)
      case $words[1] in
        scan)    _arguments '(--stdin --image --pod --namespace -n --redact --json --fast)' ;;
        cluster) _arguments '(--namespace -n --severity --json)' ;;
      esac
      ;;
  esac
}

_nxs_incident() {
  local subcmds
  subcmds=(
    'start:Start a new incident'
    'update:Add an update to an open incident'
    'close:Close and resolve an incident'
    'list:List all incidents'
    'view:View full timeline of an incident'
    'postmortem:AI-generated postmortem'
  )
  _arguments '1: :->subcmd' '*:: :->args'
  case $state in
    subcmd) _describe 'incident subcommands' subcmds ;;
    args)
      case $words[1] in
        start)     _arguments '(--severity --notify --json)' ;;
        postmortem) _arguments '(--json --fast)' ;;
      esac
      ;;
  esac
}

_nxs_predict() {
  _arguments \
    '(--namespace -n)'{--namespace,-n}'[Kubernetes namespace]:namespace' \
    '--pod[Pod name]:pod' \
    '--deployment[Deployment name]:deployment' \
    '--watch[Watch mode — re-check every interval]' \
    '--threshold[Risk score threshold (0-100)]:threshold' \
    '--interval[Watch interval in seconds]:interval' \
    '--json[Output as JSON]'
}

_nxs_watch() {
  _arguments \
    '--cooldown[Min seconds between analyses]:seconds' \
    '--context[Lines of context per analysis]:lines' \
    '--severity[Min severity: critical|warning]:severity:(critical warning)' \
    '--notify[Alert target]:target:(slack)' \
    '--redact[Scrub secrets before sending to AI]' \
    '1:source:_files'
}

_nxs "$@"
