#!/usr/bin/env python3
"""Moodle Hoarder native messaging host — performs the on-disk update.

A Chrome extension cannot write its own files, so it can't update itself.
This tiny host (registered once via install.bat) lets the extension trigger a
`git pull` of the extension folder. The extension then reloads itself.

Protocol: Chrome native messaging — each message is a 4-byte little-endian
length prefix followed by a UTF-8 JSON body, over stdin/stdout (binary).

Accepted commands:
  {"cmd": "ping"}    -> {"ok": true, "pong": true, "version": "x.y.z"}
  {"cmd": "update"}  -> {"ok": true, "before": "..", "after": "..", "updated": bool, "log": ".."}
"""
import sys
import os
import json
import struct
import subprocess


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack('<I', raw_len)[0]
    data = sys.stdin.buffer.read(msg_len)
    try:
        return json.loads(data.decode('utf-8'))
    except Exception:
        return None


def send_message(obj):
    data = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def get_version(repo_dir):
    try:
        with open(os.path.join(repo_dir, 'manifest.json'), encoding='utf-8') as f:
            return json.load(f).get('version')
    except Exception:
        return None


def git(repo_dir, *args):
    return subprocess.run(
        ['git', '-C', repo_dir, *args],
        capture_output=True, text=True, encoding='utf-8', errors='replace',
    )


def do_update(repo_dir):
    before = get_version(repo_dir)
    try:
        inside = git(repo_dir, 'rev-parse', '--is-inside-work-tree')
        if inside.returncode != 0:
            return {'ok': False, 'error': 'not-a-git-repo'}
        git(repo_dir, 'fetch', 'origin')
        reset = git(repo_dir, 'reset', '--hard', 'origin/main')
        # Keep local virtualenvs of the transcriber tool.
        git(repo_dir, 'clean', '-fd', '-e', '.venv/', '-e', 'transcriber/.venv/')
        after = get_version(repo_dir)
        log = (reset.stdout + reset.stderr).strip()
        return {
            'ok': reset.returncode == 0,
            'before': before,
            'after': after,
            'updated': before != after,
            'log': log[-600:],
        }
    except FileNotFoundError:
        return {'ok': False, 'error': 'git-not-found'}
    except Exception as e:  # noqa: BLE001
        return {'ok': False, 'error': str(e)}


def main():
    host_dir = os.path.dirname(os.path.abspath(__file__))
    repo_dir = os.path.dirname(host_dir)
    msg = read_message()
    if not msg:
        return
    cmd = msg.get('cmd')
    if cmd == 'ping':
        send_message({'ok': True, 'pong': True, 'version': get_version(repo_dir)})
    elif cmd == 'update':
        send_message(do_update(repo_dir))
    else:
        send_message({'ok': False, 'error': 'unknown-cmd'})


if __name__ == '__main__':
    main()
