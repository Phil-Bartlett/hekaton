#!/usr/bin/env bash
# Hekaton statusline relay. Claude Code pipes its statusline JSON in; this
# forwards a copy to the app and then runs the user's own statusline command
# on the same input, so the status bar inside the terminal is unchanged.
#
# usage: statusline-relay.sh <status-url> [user-statusline-command]
input=$(cat)

# Fire and forget: the status bar must never wait on the app. Claude Code sets
# CLAUDE_CODE_BRIDGE_SESSION_ID in this environment only while the session is
# connected to Remote Control, so the app learns of it from the header.
printf '%s' "$input" | curl -s -m 1 -H "X-Hekaton-Rc: ${CLAUDE_CODE_BRIDGE_SESSION_ID:-}" --data-binary @- "$1" >/dev/null 2>&1 &

if [ -n "${2:-}" ]; then
    printf '%s' "$input" | bash -c "$2"
fi
