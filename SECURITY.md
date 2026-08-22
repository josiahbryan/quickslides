# Security policy

## Supported versions

This is a small personal project. Fixes land on `main`. There are no long-lived
release branches.

## How to report a vulnerability

Please **do not** open a public issue for anything that could be abused
(unauthenticated writes, path traversal, XSS on a shared host, etc.).

1. Open a private report at
   [github.com/josiahbryan/quickslides/security/advisories/new](https://github.com/josiahbryan/quickslides/security/advisories/new)
2. Include:
   - What you did (high-level; no exploit PoC required)
   - What you expected vs what happened
   - Affected commit / tag if you know it
   - Whether you have already told anyone else

You should hear back within a week. If the report is accepted, a fix will be
worked on before any public write-up.

## What this app assumes

QuickSlides is a **local operator tool**. The HTTP/WebSocket server has **no
authentication**. Anyone who can reach the port can edit the deck, black out
the projector, and upload a background image.

That is fine on a trusted LAN or localhost. It is **not** fine on the public
internet. Do not put this behind a port-forward or unauthenticated tunnel
without adding your own access control.

## Enabling private reporting

Repo owner: in GitHub, **Settings → Code security → Private vulnerability
reporting** should be turned on before this repo is made public.
