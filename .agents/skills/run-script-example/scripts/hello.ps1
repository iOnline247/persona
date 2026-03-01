#!/usr/bin/env pwsh

<#
.SYNOPSIS
    Hello World PowerShell Script

.DESCRIPTION
    This is an example script that demonstrates:
    - Parameter handling
    - Basic output
    - Exit codes

.PARAMETER Name
    The name to greet (default: "World")

.EXAMPLE
    .\hello.ps1 -Name "Alice"
    Greets Alice

.EXAMPLE
    pwsh hello.ps1
    Greets "World" (default)
#>

param(
    [string]$Name = "World"
)

# Display a greeting
Write-Host "Hello, $Name!" -ForegroundColor Green
Write-Host "This is a PowerShell script running from the run-script-example skill."
Write-Host "Script executed at: $(Get-Date -Format 'o')"

# Return success exit code
exit 0
