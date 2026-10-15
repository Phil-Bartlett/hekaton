#!/usr/bin/env bash
# Hekaton statusline relay. Claude Code pipes its statusline JSON in; this
# forwards a copy to the app and then runs the user's own statusline command
# on the same input, so the status bar inside the terminal is unchanged.
#
# usage: statusline-relay.sh <status-url> [user-statusline-command]
input=$(cat)

# Fire and forget: the status bar must never wait on the app.
printf '%s' "$input" | curl -s -m 1 --data-binary @- "$1" >/dev/null 2>&1 &

if [ -n "${2:-}" ]; then
    printf '%s' "$input" | bash -c "$2"
fi
