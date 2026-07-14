# Security Policy

Kronos is preview software with a deliberately narrow runtime boundary. Security reports that could expose credentials, private provider evidence, local paths, or terminal data should never be filed as public issues.

## Reporting a Vulnerability

If this repository's **Security** tab offers **Report a vulnerability**, use it to start a private security advisory. Include:

- the affected Kronos version or commit;
- the operating system and VS Code version;
- a minimal reproduction using synthetic data;
- the expected and observed boundary;
- impact and any safe mitigation you have already tested.

Do not include real tokens, provider payloads, terminal transcripts, employer identifiers, or private repository content. Replace them with clearly synthetic values before sending the report.

If private reporting is unavailable, open a public issue containing only a request for a private contact channel. Do not disclose vulnerability details, affected paths, reproduction steps, or suspected secrets in that issue.

## Security Boundary

Kronos is designed to:

- send authenticated requests only to the configured provider origin;
- use bounded read-only provider operations;
- redact credential-shaped values from normalized evidence;
- store local artifacts with private per-user permissions where the platform supports them;
- treat fetched provider content as untrusted data;
- reject generic shell execution and permission-escalating Claude flags;
- insert reviewed terminal text with execution disabled.

The complete contract is in [docs/terminal-first-product-contract.md](docs/terminal-first-product-contract.md). A report that demonstrates behavior outside that contract is security-relevant even when no credential has been exposed.

## Supported Version

Only the latest source revision of the `0.1.x` preview is evaluated for fixes. No production support, SLA, or Marketplace update channel is currently offered.
