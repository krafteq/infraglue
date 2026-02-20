export function generateBashCompletion(): string {
  return `
_ig_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="apply destroy plan drift refresh import export config env provider completion"

  case "\${prev}" in
    ig)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
    env)
      COMPREPLY=( $(compgen -W "select current" -- "\${cur}") )
      return 0
      ;;
    config)
      COMPREPLY=( $(compgen -W "init show" -- "\${cur}") )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      return 0
      ;;
  esac

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "--env --format --integration --approve --verbose --quiet --strict --directory --help --json --project --no-deps --detailed" -- "\${cur}") )
  fi
}
complete -F _ig_completions ig
`.trim()
}

export function generateZshCompletion(): string {
  return `
#compdef ig

_ig() {
  local -a commands
  commands=(
    'apply:Apply infrastructure changes'
    'destroy:Destroy infrastructure'
    'plan:Preview infrastructure changes without applying'
    'drift:Detect infrastructure drift'
    'refresh:Refresh infrastructure state'
    'import:Import cloud resource into state'
    'export:Generate code for cloud resources'
    'config:Manage configuration'
    'env:Manage environments'
    'provider:Run provider CLI commands'
    'completion:Output shell completion script'
  )

  _arguments -C \\
    '(-v --verbose)'{-v,--verbose}'[Show verbose output]' \\
    '(-q --quiet)'{-q,--quiet}'[Show quiet output]' \\
    '--strict[Fail on most warnings]' \\
    '(-d --directory)'{-d,--directory}'[Root directory]:dir:_directories' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        apply|destroy)
          _arguments \\
            '(-e --env)'{-e,--env}'[Environment name]:env:' \\
            '(-f --format)'{-f,--format}'[Output format]:format:(default)' \\
            '(-i --integration)'{-i,--integration}'[Integration mode]:mode:(cli no-tty-cli)' \\
            '(-a --approve)'{-a,--approve}'[Auto-approve level]:level:' \\
            '(-p --project)'{-p,--project}'[Project name]:project:' \\
            '--no-deps[Ignore dependencies]'
          ;;
        plan)
          _arguments \\
            '(-e --env)'{-e,--env}'[Environment name]:env:' \\
            '(-f --format)'{-f,--format}'[Output format]:format:(default)' \\
            '(-p --project)'{-p,--project}'[Project name]:project:' \\
            '--no-deps[Ignore dependencies]' \\
            '--detailed[Show attribute-level diffs]'
          ;;
        drift)
          _arguments \\
            '(-e --env)'{-e,--env}'[Environment name]:env:' \\
            '(-f --format)'{-f,--format}'[Output format]:format:(default)' \\
            '(-p --project)'{-p,--project}'[Project name]:project:' \\
            '--no-deps[Ignore dependencies]' \\
            '(-j --json)'{-j,--json}'[JSON output]'
          ;;
        refresh)
          _arguments \\
            '(-e --env)'{-e,--env}'[Environment name]:env:' \\
            '(-f --format)'{-f,--format}'[Output format]:format:(default)' \\
            '(-p --project)'{-p,--project}'[Project name]:project:' \\
            '--no-deps[Ignore dependencies]'
          ;;
        import|export)
          _arguments \\
            '(-e --env)'{-e,--env}'[Environment name]:env:' \\
            '(-p --project)'{-p,--project}'[Project name]:project:' \\
            '*:args:'
          ;;
        env)
          local -a env_commands
          env_commands=(
            'select:Select an environment'
            'current:Show current environment'
          )
          _describe 'env command' env_commands
          ;;
        config)
          local -a config_commands
          config_commands=(
            'init:Initialize configuration'
            'show:Show configuration'
          )
          _describe 'config command' config_commands
          ;;
        completion)
          _arguments '1:shell:(bash zsh fish)'
          ;;
      esac
      ;;
  esac
}

_ig "$@"
`.trim()
}

export function generateFishCompletion(): string {
  return `
# ig fish completions
complete -c ig -n '__fish_use_subcommand' -a apply -d 'Apply infrastructure changes'
complete -c ig -n '__fish_use_subcommand' -a destroy -d 'Destroy infrastructure'
complete -c ig -n '__fish_use_subcommand' -a plan -d 'Preview infrastructure changes without applying'
complete -c ig -n '__fish_use_subcommand' -a config -d 'Manage configuration'
complete -c ig -n '__fish_use_subcommand' -a env -d 'Manage environments'
complete -c ig -n '__fish_use_subcommand' -a provider -d 'Run provider CLI commands'
complete -c ig -n '__fish_use_subcommand' -a drift -d 'Detect infrastructure drift'
complete -c ig -n '__fish_use_subcommand' -a refresh -d 'Refresh infrastructure state'
complete -c ig -n '__fish_use_subcommand' -a import -d 'Import cloud resource into state'
complete -c ig -n '__fish_use_subcommand' -a export -d 'Generate code for cloud resources'
complete -c ig -n '__fish_use_subcommand' -a completion -d 'Output shell completion script'

# apply/destroy options
complete -c ig -n '__fish_seen_subcommand_from apply destroy' -s e -l env -d 'Environment name' -r
complete -c ig -n '__fish_seen_subcommand_from apply destroy' -s f -l format -d 'Output format' -r
complete -c ig -n '__fish_seen_subcommand_from apply destroy' -s i -l integration -d 'Integration mode' -r
complete -c ig -n '__fish_seen_subcommand_from apply destroy' -s a -l approve -d 'Auto-approve level' -r
complete -c ig -n '__fish_seen_subcommand_from apply destroy' -s p -l project -d 'Project name' -r
complete -c ig -n '__fish_seen_subcommand_from apply destroy' -l no-deps -d 'Ignore dependencies'

# plan options
complete -c ig -n '__fish_seen_subcommand_from plan' -s e -l env -d 'Environment name' -r
complete -c ig -n '__fish_seen_subcommand_from plan' -s f -l format -d 'Output format' -r
complete -c ig -n '__fish_seen_subcommand_from plan' -s p -l project -d 'Project name' -r
complete -c ig -n '__fish_seen_subcommand_from plan' -l no-deps -d 'Ignore dependencies'
complete -c ig -n '__fish_seen_subcommand_from plan' -l detailed -d 'Show attribute-level diffs'

# drift options
complete -c ig -n '__fish_seen_subcommand_from drift' -s e -l env -d 'Environment name' -r
complete -c ig -n '__fish_seen_subcommand_from drift' -s f -l format -d 'Output format' -r
complete -c ig -n '__fish_seen_subcommand_from drift' -s p -l project -d 'Project name' -r
complete -c ig -n '__fish_seen_subcommand_from drift' -l no-deps -d 'Ignore dependencies'
complete -c ig -n '__fish_seen_subcommand_from drift' -s j -l json -d 'JSON output'

# refresh options
complete -c ig -n '__fish_seen_subcommand_from refresh' -s e -l env -d 'Environment name' -r
complete -c ig -n '__fish_seen_subcommand_from refresh' -s f -l format -d 'Output format' -r
complete -c ig -n '__fish_seen_subcommand_from refresh' -s p -l project -d 'Project name' -r
complete -c ig -n '__fish_seen_subcommand_from refresh' -l no-deps -d 'Ignore dependencies'

# import options
complete -c ig -n '__fish_seen_subcommand_from import' -s e -l env -d 'Environment name' -r
complete -c ig -n '__fish_seen_subcommand_from import' -s p -l project -d 'Project name' -r

# export options
complete -c ig -n '__fish_seen_subcommand_from export' -s e -l env -d 'Environment name' -r
complete -c ig -n '__fish_seen_subcommand_from export' -s p -l project -d 'Project name' -r

# env subcommands
complete -c ig -n '__fish_seen_subcommand_from env; and not __fish_seen_subcommand_from select current' -a select -d 'Select an environment'
complete -c ig -n '__fish_seen_subcommand_from env; and not __fish_seen_subcommand_from select current' -a current -d 'Show current environment'

# config subcommands
complete -c ig -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from init show' -a init -d 'Initialize configuration'
complete -c ig -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from init show' -a show -d 'Show configuration'
complete -c ig -n '__fish_seen_subcommand_from show' -s j -l json -d 'Output in JSON format'

# completion shells
complete -c ig -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'

# global options
complete -c ig -s v -l verbose -d 'Show verbose output'
complete -c ig -s q -l quiet -d 'Show quiet output'
complete -c ig -l strict -d 'Fail on most warnings'
complete -c ig -s d -l directory -d 'Root directory' -r -a '(__fish_complete_directories)'
`.trim()
}
