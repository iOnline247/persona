---
name: code-review
description: Comprehensive code review skill covering security vulnerabilities (OWASP Top 10), coding standards, performance, maintainability, and best practices. Use when reviewing code, pull requests, diffs, or when asked to analyze code for bugs, security issues, code quality, or improvements. Triggers on phrases like "review this code", "check for vulnerabilities", "code review", "security audit", "analyze this PR", or "what's wrong with this code".
---

# Code Review Skill

Perform thorough code reviews covering security, quality, performance, and maintainability.

## Review Process

1. **Understand context** - Identify language, framework, and purpose
2. **Security scan** - Check OWASP Top 10 vulnerabilities (see `references/owasp-top-10.md`)
3. **Code quality** - Assess readability, patterns, and standards (see `references/coding-standards.md`)
4. **Performance** - Identify bottlenecks and inefficiencies
5. **Synthesize findings** - Prioritize by severity and provide actionable feedback

## Output Format

Structure reviews as follows:

```
## Summary
[One paragraph overview: what the code does and overall assessment]

## Critical Issues
[Security vulnerabilities and bugs that must be fixed]

## Improvements
[Code quality, performance, and maintainability suggestions]

## Positive Observations
[What's done well - reinforce good practices]
```

## Severity Levels

- **Critical**: Security vulnerabilities, data loss risks, crashes
- **High**: Bugs affecting functionality, major performance issues
- **Medium**: Code smells, minor bugs, maintainability concerns
- **Low**: Style issues, minor optimizations, suggestions

## Review Checklist

### Security (Always Check)
- Input validation and sanitization
- Authentication/authorization flaws
- Injection vulnerabilities (SQL, XSS, command)
- Sensitive data exposure
- Hardcoded secrets/credentials
- Insecure dependencies

### Code Quality
- Clear naming and documentation
- Single responsibility principle
- DRY (Don't Repeat Yourself)
- Error handling coverage
- Edge case handling

### Performance
- N+1 queries
- Unnecessary iterations
- Memory leaks
- Blocking operations
- Caching opportunities

## Language-Specific Guidance

For detailed patterns, load the appropriate reference:
- Security vulnerabilities: `references/owasp-top-10.md`
- Coding standards by language: `references/coding-standards.md`

## Giving Feedback

- Be specific: cite line numbers and show fixes
- Be constructive: explain *why* something is problematic
- Prioritize: focus on critical issues first
- Be balanced: acknowledge good code alongside issues
