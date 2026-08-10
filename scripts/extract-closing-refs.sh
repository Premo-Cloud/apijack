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
#   - fenced blocks (``` and ~~~, per CommonMark: 3+ delimiters, closing fence
#     at least as long as the opening one)
#   - inline code spans (`x`, ``x``, ...), scanned by matching delimiter-run
#     length so ``Closes #10`` isn't half-stripped into a live reference
#
# Fence indent is measured from the content column of the enclosing list item,
# not from column 0 (#134): a fence nested in a list legitimately sits at 4+
# spaces, and reading it as prose leaked everything inside it. The awk pre-pass
# therefore tracks open list items and allows a fence within 3 of that column.
# List markers are capped the same way, and that cap is what makes the rule
# safe: base + 4 is by definition an indented code block, so a fence marker or
# a `- item` line inside indented code opens nothing. Recognizing a fence at any
# indent instead was rejected — a stray fence marker in indented code would open
# a phantom fence and swallow every real reference after it, and a swallowed
# reference is the one failure nothing flags.
#
# The one rule that can hide a reference is the flip side of that: a fence still
# open when its list item ends is closed with the item, so an unterminated nested
# fence cannot swallow the rest of the body. But if the item did not really end,
# the fence's own closing line is then read as a NEW opener and everything after
# it is swallowed instead — and when that second fence gets closed too, silently,
# with no unterminated-fence warning. Anything that makes a line inside a fence
# look shallower than the fence's container walks into this; the tab exemption in
# the state machine is there for exactly that reason. Weigh it before touching
# the escape.
#
# An empty list marker right after open paragraph text pushes no container
# (#142): for `-` that's a setext heading underline, for `*`/`+`/ordered
# markers a lazy paragraph continuation ("an empty list item cannot interrupt
# a paragraph"). The one exception is a marker that dedents back to a sibling
# position — `- foo` then `-` at column 0 — which pops a container on its way
# in and still pushes; that pop is how the state machine tells a real empty
# item apart from the underline.
#
# Known and deliberate gaps. Most leave a reference VISIBLE (a possible false
# positive) rather than hiding a real one, which is the safer direction to err —
# the two that can hide one, the early-close reopen above and the empty-marker
# suppression below, say so where they are described:
#   - indented code blocks and blockquotes are not stripped (per #129: a
#     blockquote can legitimately carry a real reference)
#   - code spans are scanned per line, so a span that wraps across a newline
#     leaks its contents
#   - tabs are not expanded to tab stops, so a tab-indented fence reads as
#     indent 0 and a tab-indented list item as a marker at column 0. A tab in
#     column 1 is exempt from the fence early-close above while the fence sits
#     at container column 4 or less — that is as far as a tab reaches, and it is
#     the shape of this that hid references. A tab after leading spaces gets no
#     exemption and lands wherever its space count puts it
#   - a lazy paragraph continuation dedented out of its list item pops the
#     container early, which only lowers the column a fence must beat
#   - a fence opener sharing a line with its list marker (`- ```) is not seen,
#     because the opener is looked for at the line indent, not past the marker
#   - a line that opens no paragraph but reads as one here (an ATX heading, a
#     thematic break, an HTML block, an indented code line) suppresses the empty
#     marker under it, so a fence indented into what CommonMark calls that list
#     item keeps its lower fence_base and does not end at a dedent — the second
#     rule that can hide a reference, and unlike the reopen above it is silent
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

# How far past its own indent the content of a list item starts — the marker width
# plus the spaces after it. 0 when the line is not a list item. A marker at end
# of line still opens an item whose content column is one past the marker, and so
# does one followed by 5+ spaces: per CommonMark those extra spaces are indented
# code inside the item, so counting them would raise the column and let a fence
# open where code was meant — swallowing a reference, the direction #134 avoids.
function list_offset(p,   w, n, c, t) {
    # A thematic break wears a marker character but is not a list item, and the
    # container it would push raises the column enough to open the indented code
    # under it as a fence. Spaces are allowed between the dashes, so compare the
    # whitespace-stripped line: 3+ of one character and nothing else. `- ---`
    # lands here too and should: a thematic break outranks a list item when a
    # line could be read as either, so four dashes with a space among them are
    # a break, and returning 0 matches CommonMark rather than merely erring safe.
    t = p
    gsub(/[[:space:]]/, "", t)
    c = substr(t, 1, 1)
    if (c == "-" || c == "*" || c == "_") {
        n = 0
        while (substr(t, n + 1, 1) == c) n++
        if (n >= 3 && n == length(t)) return 0
    }
    w = 0
    c = substr(p, 1, 1)
    if (c == "-" || c == "*" || c == "+") {
        w = 1
    } else {
        # CommonMark caps an ordered marker at 9 digits; a longer run is a
        # paragraph, and treating it as an item would raise the column for
        # everything under it — the unsafe direction.
        n = 0
        while (substr(p, n + 1, 1) ~ /^[0-9]$/) n++
        if (n > 0 && n <= 9) {
            c = substr(p, n + 1, 1)
            if (c == "." || c == ")") w = n + 1
        }
    }
    if (w == 0) return 0
    # Nothing but whitespace after the marker is an empty item, whose content
    # column CommonMark also puts one past the marker.
    if (substr(p, w + 1) ~ /^[[:space:]]*$/) return w + 1
    if (substr(p, w + 1, 1) != " ") return 0
    n = 0
    while (substr(p, w + n + 1, 1) == " ") n++
    if (n > 4) n = 1
    return w + n
}

BEGIN {
    in_fence = 0; fence_char = ""; fence_len = 0; fence_indent = 0; fence_base = 0
    depth = 0; base = 0; prev_text = 0
}
{
    # Leading spaces, counted with a loop rather than /^ */ because the count is
    # needed and interval expressions are not portable across awk implementations.
    indent = 0
    while (substr($0, indent + 1, 1) == " ") indent++
    probe = substr($0, indent + 1)
    blank = ($0 ~ /^[[:space:]]*$/)

    if (in_fence) {
        # A tab-led line is exempt from the dedent escape below: indent counts
        # spaces only, so it reads as column 0, but CommonMark expands the tab
        # to column 4 and keeps the line inside the fence. Without the exemption
        # the fence ends here and its real closer opens a second one, swallowing
        # every reference after it — silently, when that second fence is closed.
        # Column 4 is also where the exemption stops: in a container deeper than
        # that the tab really does land short, so the line is out of the fence
        # and its reference is prose. Holding it in would swallow that reference
        # the same silent way, just deeper.
        if (blank || indent >= fence_base || (substr($0, 1, 1) == "\t" && fence_base <= 4)) {
            if (match(probe, /^(```+|~~~+)/)) {
                ch = substr(probe, 1, 1)
                # The closer is measured against the opener rather than the
                # container: the lenient reading, which closes sooner.
                if (ch == fence_char && RLENGTH >= fence_len && indent <= fence_indent + 3 &&
                    substr(probe, RLENGTH + 1) ~ /^[[:space:]]*$/) {
                    in_fence = 0; fence_char = ""; fence_len = 0
                    fence_indent = 0; fence_base = 0
                }
            }
            prev_text = 0
            next
        }
        # Dedented out of the list item holding the fence, so the fence ended
        # with it. Fall through and process this line normally — an unclosed
        # nested fence must not swallow the rest of the body.
        in_fence = 0; fence_char = ""; fence_len = 0
        fence_indent = 0; fence_base = 0
    }

    no_para = 0
    if (!blank) {
        # A list item may contain blank lines, so only a non-blank line closes
        # containers. Popping eagerly lowers base, which makes a deep fence
        # LESS likely to be recognized — the false-positive direction.
        popped = 0
        while (depth > 0 && indent < stack[depth]) { depth--; popped = 1 }
        base = 0
        if (depth > 0) base = stack[depth]

        # Both markers below are capped at 3 past the content column of the
        # container. base + 4 is by definition an indented code block, so a fence
        # marker there is inert without tracking indented code separately — and
        # the cap on list markers is what keeps a `- item` line inside indented
        # code from opening a container that would re-enable deep fences.
        if (indent <= base + 3) {
            off = list_offset(probe)
            if (off > 0) {
                # An empty marker right after open paragraph text never starts
                # a list item (#142): for `-` it is a setext underline, for the
                # rest a lazy continuation ("an empty list item cannot
                # interrupt a paragraph"). The one exception is a marker that
                # dedented to pop a container on its way in — that is a real
                # sibling empty item (`- foo` then `-` at column 0), told
                # apart here by `popped`. The digit run below is unbounded,
                # unlike the 9-digit cap in list_offset — safe only because
                # off > 0 already excludes a 10+-digit marker; keep the two
                # coupled.
                empty_marker = (probe ~ /^([-*+]|[0-9]+[.)])[[:space:]]*$/)
                if (empty_marker && prev_text && !popped) {
                    no_para = 1
                } else {
                    depth++
                    stack[depth] = indent + off
                    base = stack[depth]
                    if (empty_marker) no_para = 1
                }
            } else if (match(probe, /^(```+|~~~+)/)) {
                ch = substr(probe, 1, 1)
                # A backtick info string cannot itself contain a backtick, so
                # ```` `a` ```` opens nothing — it is an inline span.
                if (ch != "`" || index(substr(probe, RLENGTH + 1), "`") == 0) {
                    in_fence = 1; fence_char = ch; fence_len = RLENGTH
                    fence_indent = indent; fence_base = base
                    prev_text = 0
                    next
                }
            }
        }
    }
    print strip_spans($0)
    prev_text = (!blank && !no_para)
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
