# Run Script Example - Usage Guide

This document provides detailed usage information for the run-script-example skill.

## Overview

The run-script-example skill demonstrates the Agent Skills specification by providing working examples of:
- NodeJS script execution
- PowerShell script execution
- Reference documentation
- Asset files

## Script Details

### NodeJS Script (hello.js)

**Location**: `scripts/hello.js`

**Purpose**: Demonstrates a simple NodeJS script that can be executed by an agent.

**Requirements**:
- Node.js runtime (v18 LTS or higher recommended)

**Usage**:
```bash
node scripts/hello.js
node scripts/hello.js "Your Name"
```

**Output**: Displays a greeting message with the provided name or "World" as default.

### PowerShell Script (hello.ps1)

**Location**: `scripts/hello.ps1`

**Purpose**: Demonstrates a simple PowerShell script that can be executed by an agent.

**Requirements**:
- PowerShell 5.1 or higher (Windows)
- PowerShell Core 7+ (cross-platform via pwsh)

**Usage**:
```powershell
# Using PowerShell Core (cross-platform)
pwsh scripts/hello.ps1 -Name "Your Name"

# Using Windows PowerShell
.\scripts\hello.ps1 -Name "Your Name"

# Using default name
pwsh scripts/hello.ps1
```

**Output**: Displays a colorized greeting message with the provided name or "World" as default.

## Advanced Examples

### Chaining Scripts

You can chain both scripts together for demonstration:

```bash
# Run NodeJS script first, then PowerShell
node scripts/hello.js "Agent" && pwsh scripts/hello.ps1 -Name "Agent"
```

### Integration with Other Tools

These scripts can be integrated into larger workflows:

1. **CI/CD Pipelines**: Use as part of build or deployment scripts
2. **Agent Workflows**: Call from agent tasks that need script execution
3. **Testing**: Use as examples for testing script execution capabilities

## Asset Usage

The `assets/template.txt` file can be used as a starting point for:
- Configuration files
- Output templates
- Example content

Read the file and modify it programmatically or manually as needed.

## Troubleshooting

### NodeJS Script Issues

- **Error**: "command not found: node"
  - **Solution**: Install Node.js from nodejs.org

- **Permission denied**
  - **Solution**: On Unix-like systems, run `chmod +x scripts/hello.js`

### PowerShell Script Issues

- **Error**: "command not found: pwsh"
  - **Solution**: Install PowerShell Core from microsoft.com/powershell

- **Execution policy error** (Windows)
  - **Solution**: Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

## Best Practices

1. **Script Portability**: These scripts are designed to work cross-platform
2. **Error Handling**: Both scripts include proper exit codes
3. **Documentation**: Each script includes inline comments explaining functionality
4. **Parameter Validation**: PowerShell script demonstrates parameter handling

## Further Reading

- [Node.js Documentation](https://nodejs.org/en/docs/)
- [PowerShell Documentation](https://learn.microsoft.com/en-us/powershell/)
- [Agent Skills Specification](https://agentskills.io/specification)
