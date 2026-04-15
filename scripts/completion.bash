#!/usr/bin/env bash
# nxs bash completion
# Install: source <(nxs completion bash)
#      or: nxs completion bash >> ~/.bashrc

_nxs_completion() {
  local cur prev words cword
  _init_completion || return

  local commands="devops cloud k8s sec net db ci explain watch serve rbac status predict incident autopilot info test update config history report help"

  local devops_cmds="analyze history watch examples pipelines"
  local k8s_cmds="debug history events errors status pods"
  local sec_cmds="scan history cluster severities"
  local incident_cmds="start update close list view postmortem"
  local cloud_cmds="analyze history"
  local net_cmds="analyze history"
  local db_cmds="analyze history"
  local ci_cmds="analyze history"
  local rbac_cmds="scan history"

  local global_opts="--help --version"

  case "${words[1]}" in
    devops)   [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$devops_cmds" -- "$cur")) ;;
    k8s)      [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$k8s_cmds" -- "$cur")) ;;
    sec)      [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$sec_cmds" -- "$cur")) ;;
    incident) [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$incident_cmds" -- "$cur")) ;;
    cloud)    [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$cloud_cmds" -- "$cur")) ;;
    net)      [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$net_cmds" -- "$cur")) ;;
    db)       [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$db_cmds" -- "$cur")) ;;
    ci)       [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$ci_cmds" -- "$cur")) ;;
    rbac)     [[ $cword -eq 2 ]] && COMPREPLY=($(compgen -W "$rbac_cmds" -- "$cur")) ;;
    predict)
      COMPREPLY=($(compgen -W "--namespace --pod --deployment --watch --threshold --interval --json" -- "$cur"))
      ;;
    watch)
      COMPREPLY=($(compgen -W "--cooldown --context --severity --notify --redact" -- "$cur"))
      ;;
    config)
      COMPREPLY=($(compgen -W "--setup --show --reset" -- "$cur"))
      ;;
    history)
      COMPREPLY=($(compgen -W "--limit --tool --json" -- "$cur"))
      ;;
    status)
      COMPREPLY=($(compgen -W "--namespace --watch --interval" -- "$cur"))
      ;;
    autopilot)
      COMPREPLY=($(compgen -W "--namespace --interval --dry-run" -- "$cur"))
      ;;
    *)
      if [[ $cword -eq 1 ]]; then
        COMPREPLY=($(compgen -W "$commands" -- "$cur"))
      fi
      ;;
  esac
}

complete -F _nxs_completion nxs
