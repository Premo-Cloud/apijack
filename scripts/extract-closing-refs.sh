#!/usr/bin/env bash
# extract-closing-refs.sh
#
# Read a markdown body (PR or issue) and print the issue number of every
# GitHub closing reference it contains — one per line, deduped, ascending.
#
# The single extraction implementation shared by:
#   .claude/skills/final-review/scripts/label-merged-issues.sh
#   scripts/promote-shipped-issues.sh
#   scripts/collect-closes-refs.sh
#
# Each of those used to carry its own copy of the regex, which drifted apart
# and — more seriously — matched closing keywords written inside code. A PR
# body that documents the `Closes #N` convention, or pastes a regex fixture
# into a fenced block, is not making five closing references. Before #129 the
# scripts read it as if it were: running label-merged-issues.sh against #126,
# whose body contained exactly such a fixture, applied `merged to dev` to five
# unrelated release PRs from months earlier.
#
# So: strip code before matching.
#   - fenced blocks (``` and ~~~, per CommonMark: 3+ delimiters, up to 3
#     spaces of indent, closing fence at least as long as the opening one)
#   - inline code spans (`x`, ``x``, ...), scanned by matching delimiter-run
#     length so ``Closes #10`` isn't half-stripped into a live reference
#
# Known and deliberate gaps — all of them leave a reference VISIBLE (a possible
# false positive), never hide a real one, which is the safer direction to err:
#   - indented code blocks and blockquotes are not stripped (per #129: a
#     blockquote can legitimately carry a real reference)
#   - a fence indented 4+ spaces is not recognized, so a fence nested inside a
#     list item leaks its contents (#134). Allowing any indent would be worse:
#     an indented-code-block fence marker would open a phantom fence and
#     swallow every real reference after it.
#   - code spans are scanned per line, so a span that wraps across a newline
#     leaks its contents
#
# Network-free by design: it takes text, not a PR number. Callers do their own
# fetching, which differs between them for good reasons (the label scripts hit
# `gh api repos/.../pulls/N`; collect-closes-refs.sh uses `gh pr view` so it can
# skip numbers that turn out to be issues rather than PRs).
#
# Usage:
#   extract-closing-refs.sh --body-file <file>
#   extract-closing-refs.sh -            # read stdin
#   cat body.md | extract-closing-refs.sh
#
# Output: issue numbers, one per line. Empty output and exit 0 when a body has
# no closing references — that is a normal case (a chore PR opened outside the
# template), not a failure. Callers run under `set -euo pipefail`, so getting
# this wrong here would abort them; #127 was exactly that bug.
#
# Empty-output-exit-0 is the contract for "no references", so an INTERNAL
# failure must never look like one: the tolerance below is scoped to grep's
# exit 1 (no match) specifically, and awk runs outside the pipeline so `set -e`
# catches it. Otherwise a broken extractor would read as "this release closes
# nothing" and every issue in it would silently never auto-close.

set -euo pipefail

body_file=""
case "${1-}" in
    --body-file)
        body_file="${2:?--body-file requires a path}"
        ;;
    -|"")
        body_file="/dev/stdin"
        ;;
    *)
        echo "usage: extract-closing-refs.sh [--body-file <file> | -]" >&2
        exit 1
        ;;
esac

# -r rather than -f so `--body-file <(...)` process substitution works.
if [ "$body_file" != "/dev/stdin" ] && [ ! -r "$body_file" ]; then
    echo "extract-closing-refs: body file not found: $body_file" >&2
    exit 1
fi

# Match GitHub's recognized closing keywords:
#   close / closes / closed
#   fix / fixes / fixed
#   resolve / resolves / resolved
# followed by whitespace, `#`, and a number. Case-insensitive on the keyword.
#
# The leading word boundary matters: without it, "discloses #15" would match and
# promote-shipped-issues.sh would strip `ready-for-implement` off an unrelated
# open issue. Spelled `(^|[^[:alnum:]_])` rather than `\b` for portability — GNU
# grep honors `\b` in ERE but BSD/macOS grep uses `[[:<:]]`, where `\b` degrades
# to a literal `b` and silently matches nothing. The captured leading character
# is harmless; the second grep keeps only the digits.
KEYWORD_RE='(^|[^[:alnum:]_])(close[sd]?|fix(es|ed)?|resolve[sd]?)[[:space:]]+#[0-9]+'

AWK_STRIP='
# Scan a line and drop every inline code span. Runs of backticks open a span
# that only a run of the SAME length closes, so `` `` `` and ``` ` ``` nest
# the way CommonMark says they do. An unmatched run is literal text and stays.
function strip_spans(s,   out, i, n, run, j, closerun, found) {
    out = ""
    i = 1
    n = length(s)
    while (i <= n) {
        if (substr(s, i, 1) != "`") {
            out = out substr(s, i, 1)
            i++
            continue
        }
        run = 0
        while (i + run <= n && substr(s, i + run, 1) == "`") run++
        j = i + run
        found = 0
        while (j <= n) {
            if (substr(s, j, 1) == "`") {
                closerun = 0
                while (j + closerun <= n && substr(s, j + closerun, 1) == "`") closerun++
                if (closerun == run) { found = 1; break }
                j += closerun
            } else {
                j++
            }
        }
        if (found) {
            i = j + run
        } else {
            out = out substr(s, i, run)
            i += run
        }
    }
    return out
}

BEGIN { in_fence = 0; fence_char = ""; fence_len = 0 }
{
    probe = $0
    # Up to 3 spaces of indent still opens a fence; a 4th makes it an indented
    # code block. Trimmed with a loop rather than /^ {0,3}/ because interval
    # expressions are not portable across awk implementations.
    indent = 0
    while (indent < 3 && substr(probe, 1, 1) == " ") {
        probe = substr(probe, 2)
        indent++
    }
    if (match(probe, /^(```+|~~~+)/)) {
        marker = substr(probe, 1, RLENGTH)
        ch = substr(marker, 1, 1)
        len = RLENGTH
        rest = substr(probe, RLENGTH + 1)
        if (in_fence == 0) {
            # A backtick info string cannot itself contain a backtick, so
            # ```` `a` ```` opens nothing — it is an inline span.
            if (ch == "`" && index(rest, "`") > 0) {
                print strip_spans($0)
                next
            }
            in_fence = 1; fence_char = ch; fence_len = len
            next
        }
        if (ch == fence_char && len >= fence_len && rest ~ /^[[:space:]]*$/) {
            in_fence = 0; fence_char = ""; fence_len = 0
            next
        }
    }
    if (in_fence == 0) print strip_spans($0)
}

# A closing fence cannot carry a trailing info string, so one stray character on
# it leaves the fence open and everything after it is treated as code. That is
# CommonMark-correct but it silently drops real references — say so.
END {
    if (in_fence) print "extract-closing-refs: warning: unterminated code fence" > "/dev/stderr"
}
'

# Deliberately outside the pipeline: an awk failure must abort under `set -e`
# rather than be swallowed by the no-match tolerance below.
stripped=$(awk "$AWK_STRIP" "$body_file")

printf '%s\n' "$stripped" \
    | grep -oiE "$KEYWORD_RE" \
    | grep -oE '[0-9]+' \
    | sort -un \
    || [ $? -eq 1 ]   # grep exit 1 == no closing references. Any other status propagates.
