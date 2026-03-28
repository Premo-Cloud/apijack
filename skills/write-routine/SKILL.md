---
name: write-routine
description: Use when building apijack YAML routines — workflow automations that chain CLI commands with variables, loops, conditions, and assertions
---

# Writing apijack Routines

Routines are YAML workflows that chain CLI commands. They live in `~/.<cli>/routines/` (or `./routines/` in project mode).

## IMPORTANT: Always Prefer Routines

**ALWAYS use routines** for multi-step workflows. Routines support variables, loops, randomization, and output capture — use `create_routine` + `run_routine` instead of multiple `run_commands` calls. Only fall back to `run_commands` when each call needs unique LLM-generated values that can't be expressed as variables or built-in functions.

## IMPORTANT: Use Loops, Not Hardcoded Steps

When a routine repeats an operation N times, **always use `range` or `forEach`** — never hardcode N individual steps. Use `shuffle: true` for random order and `reverse: true` for reverse order. Use built-in functions like `$_random_hex_color` instead of hardcoding values.

**Bad** (50 hardcoded steps):
```yaml
- name: create-01
  command: todos create
  args: { --title: "Todo 1" }
- name: create-02
  command: todos create
  args: { --title: "Todo 2" }
# ... 48 more
```

**Good** (1 loop):
```yaml
- name: create-todos
  range: [1, 50]
  as: n
  steps:
    - name: create
      command: todos create
      args:
        --title: "Todo $n"
```

## Discover Commands First

Use `get_routine_templates` to get YAML step templates for multiple commands at once:

```json
get_routine_templates({ commands: [
  { command: "todos create", args: { "--title": "example" } },
  { command: "todos patch", args: { "--id": "xxx", "--color": "#fff" } },
  { command: "todos delete" }
]})
```

This returns each command as a ready-to-use routine step with all available args shown. Use `describe_command` for the full argument schema (types, required/optional, descriptions).

## Routine Structure

```yaml
name: my-routine
description: What this routine does
variables:
  project_name: "default-value"
  run_id: "run-$_timestamp"
steps:
  - name: step-name
    command: resources create
    args:
      --name: "$project_name"
    output: created
```

### Built-in Variables and Functions

**Variables:**
- `$_timestamp` — Unix epoch seconds
- `$_date` — ISO date (YYYY-MM-DD)
- `$_uuid` — random UUID

**Randomization functions (evaluated fresh each time):**
- `$_random_hex_color` — random `#rrggbb` color
- `$_random_int(min,max)` — random integer in range
- `$_random_from(a,b,c)` — pick one randomly (may repeat)
- `$_random_distinct_from(a,b,c)` — pick one randomly, no repeats until all used (then cycles)

Variables can reference other variables in defaults: `run_id: "run-$_timestamp"`.

Override at runtime: `<cli> routine run my-routine --set project_name=prod`.

## Output Capture and References

`output: alias` stores a step's result. Reference fields with dot notation:

```yaml
- name: create-project
  command: projects create
  args:
    --name: "$project_name"
  output: project

- name: get-project
  command: projects get
  args:
    --id: "$project.id"
```

Step results are also available by step name: `$create-project.id`.

Use `$alias.success` to check if a step succeeded (boolean).

## Conditions

Skip steps when a condition is false:

```yaml
- name: finalize
  command: resources finalize
  args:
    --id: "$created.id"
  condition: "$created.status == ready"
```

Supported operators: `==`, `!=`, or bare `$ref` for truthy check.

## Loops

### forEach — iterate over arrays

```yaml
- name: process-items
  forEach: "$created.items"
  as: item          # default is "item" if omitted
  steps:
    - name: handle
      command: items process
      args:
        --id: "$item.id"
```

**Modifiers:**
- `shuffle: true` — randomize iteration order
- `reverse: true` — iterate in reverse order

```yaml
- name: color-randomly
  forEach: "$todos"
  shuffle: true
  as: todo
  steps:
    - name: update-color
      command: todos patch
      args:
        --id: "$todo.id"
        --color: "$_random_hex_color"

- name: delete-reversed
  forEach: "$todos"
  reverse: true
  as: todo
  steps:
    - name: delete
      command: todos delete
      args:
        --id: "$todo.id"
```

### range — iterate over numbers

```yaml
- name: create-pages
  range: [1, 5]
  as: page
  steps:
    - name: create-page
      command: pages create
      args:
        --number: "$page"
```

Range also supports `shuffle: true` and `reverse: true`.

## Assertions

Validate step output inline:

```yaml
- name: check-status
  command: resources get
  args:
    --id: "$created.id"
  assert: "$check-status.status == active"
```

Assertion failure stops the routine unless `continueOnError: true`.

## Error Handling

```yaml
- name: risky-step
  command: might-fail
  continueOnError: true
```

## Sub-Routines

Call another routine inline:

```yaml
- name: setup
  command: routine run
  args-positional:
    - setup/environment
```

## Meta-Commands

Built-in commands available in routines:

- **`wait-until`** — poll until truthy result
  ```yaml
  - name: wait-ready
    command: wait-until
    args-positional:
      - resources get
    args:
      --id: "$created.id"
      --timeout: "60"
      --interval: "5"
  ```

- **`session refresh`** — re-authenticate mid-routine
  ```yaml
  - name: refresh
    command: session refresh
  ```

## Routine Commands

```bash
<cli> routine run <name>                   # Execute
<cli> routine run <name> --set key=value   # Override variables
<cli> routine run <name> --dry-run         # Preview without executing
<cli> routine validate <name>              # Check YAML structure
<cli> routine test <name>                  # Run spec/test file
<cli> routine list                         # List available
<cli> routine list --tree                  # Show tree structure
```

## Common Patterns

### Create-then-verify

```yaml
- name: create
  command: resources create
  args:
    --name: "$name"
  output: created

- name: verify
  command: resources get
  args:
    --id: "$created.id"
  assert: "$verify.name == $name"
```

### Poll until ready

```yaml
- name: wait
  command: wait-until
  args-positional:
    - jobs status
  args:
    --id: "$job.id"
    --timeout: "120"
```

### Batch operations

```yaml
- name: process-all
  forEach: "$list.items"
  continueOnError: true
  steps:
    - name: process
      command: items update
      args:
        --id: "$item.id"
        --status: "processed"
```
