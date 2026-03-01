---
name: run-script-example
description: Demonstrates how to run scripts (NodeJS and PowerShell), use references, and utilize assets. Use this skill when you need an example of Agent Skills structure with executable scripts and supporting files.
license: MIT
metadata:
  author: accoutreai
  version: "1.0.0"
  tags:
    - example
    - scripts
    - nodejs
    - powershell
---

# Run Script Example Skill

This skill demonstrates the Agent Skills specification with executable scripts, references, and assets.

## Purpose

This example skill shows how to:
- Execute NodeJS scripts
- Execute PowerShell scripts
- Reference documentation files
- Use asset files

## Directory Structure

```
run-script-example/
├── SKILL.md           # This file - skill definition and instructions
├── scripts/           # Executable scripts
│   ├── hello.js       # NodeJS script example
│   └── hello.ps1      # PowerShell script example
├── references/        # Documentation and reference materials
│   └── usage-guide.md # Usage documentation
└── assets/            # Static files and templates
    └── template.txt   # Example template file
```

## How to Use

### Running the NodeJS Script

The `scripts/hello.js` file is a simple NodeJS script that demonstrates basic functionality:

```bash
node scripts/hello.js "Your Name"
```

### Running the PowerShell Script

The `scripts/hello.ps1` file is a PowerShell script that demonstrates basic functionality:

```powershell
pwsh scripts/hello.ps1 -Name "Your Name"
```

Or on Windows:
```powershell
.\scripts\hello.ps1 -Name "Your Name"
```

### Using References

The `references/usage-guide.md` file contains additional documentation and examples that can be referenced when using this skill.

### Using Assets

The `assets/template.txt` file is an example template that can be read, modified, or copied as needed for your tasks.

## Example Workflows

1. **Basic Script Execution**: Run either script to see a greeting message
2. **Reading References**: Check the usage guide for more detailed examples
3. **Using Templates**: Copy the template file and customize it for your needs

## Best Practices

- Scripts should be self-contained and well-documented
- References should provide context without duplicating SKILL.md content
- Assets should be ready-to-use files that don't require modification
- Always validate scripts work before committing them to the skill

## Notes

This is an example skill demonstrating the Agent Skills specification. It can be used as a template for creating your own skills with executable components.
