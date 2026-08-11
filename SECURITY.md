# Security policy

## Supported versions

Security fixes are applied to the latest published version and the current `main` branch.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Earlier versions | No |

## Report a vulnerability privately

Use **Security → Report a vulnerability** in the GitHub repository. Do not open a public issue for a
security vulnerability or suspected credential leak.

Include:

- the affected version or commit;
- a concise description and potential impact;
- the minimum steps needed to reproduce the issue;
- a suggested fix, if you have one.

Do not include real X cookies, passwords, OTP seeds, proxy credentials, npm tokens, or data belonging
to another person. Use synthetic values and redact request and response captures. Do not perform
destructive testing, service stress, broad account testing, or access data you are not authorized to
access.

The maintainer will coordinate validation and disclosure through the private advisory. Please allow
time for a fix before publishing details.

## Scope

Security reports may cover the npm package, CLI, authentication boundary, secret redaction, local
SQLite state, proxy handling, output paths, dependency chain, or GitHub Actions configuration.
Platform behavior and vulnerabilities in X itself should be reported to X through its own security
process.
