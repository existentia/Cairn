# Security Policy

## Supported versions

Cairn is a single-maintainer project. Only the latest release on `main` receives fixes.

## Threat model

Cairn is designed to run on a **trusted local network** — a home LAN or a private VLAN, behind
your own firewall. It is a single-user app with one admin account and no multi-tenancy. The
security controls in place (hashed passwords, SQLite-backed bearer tokens with 7-day expiry,
per-IP login rate limiting, strict CSP and related response headers, a 5 MB request cap) are
sized for that setting.

It is **not** hardened for direct exposure to the public internet. If you must reach it
remotely, put it behind a VPN (WireGuard/Tailscale) or a reverse proxy with HTTPS and a separate
authentication layer such as Authelia or Authentik.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**), or email the address on the maintainer's GitHub
profile. Include the affected version or commit, reproduction steps, and the impact you
believe it has.

I'll acknowledge reports as soon as I reasonably can. This is a spare-time project, so please
expect days rather than hours, and coordinate disclosure with me before publishing.

## Data handling

- All financial data stays in a local SQLite file (`data/cairn.db`); nothing is sent to a
  third-party service by default.
- The optional AI Copilot sends **numerical summaries only** to the Claude API — never account
  names, dates of birth, or other identifiers — and is disabled entirely unless
  `ANTHROPIC_API_KEY` is set.
- The Bank of England base-rate lookup fetches a public statistical CSV and sends no user data.
