# Coding Standards Reference

Language-agnostic and language-specific best practices for code quality.

## Universal Principles

### Naming
- Variables/functions: descriptive, reveal intent (`getUserById` not `getData`)
- Booleans: use `is`, `has`, `can`, `should` prefixes
- Constants: SCREAMING_SNAKE_CASE
- Avoid abbreviations except widely known ones (URL, HTTP, ID)

### Functions
- Single responsibility: one function, one purpose
- Keep small: ideally <20 lines
- Limit parameters: >3 suggests need for object/config
- Pure when possible: same inputs → same outputs, no side effects

### Error Handling
- Never swallow exceptions silently
- Fail fast with clear messages
- Use specific exception types
- Log with context (what, where, why)

### Code Smells to Flag
- Long functions (>50 lines)
- Deep nesting (>3 levels)
- Magic numbers/strings
- Duplicated code
- Large classes/modules
- Feature envy (class using another class's data excessively)
- God objects (one class doing too much)

## JavaScript/TypeScript

### Modern Syntax
```javascript
// Prefer
const items = [...array];
const { name, age } = user;
const merged = { ...defaults, ...options };
const result = items.map(x => x * 2);

// Avoid
var items = array.slice();
var name = user.name;
var merged = Object.assign({}, defaults, options);
```

### Async Patterns
```javascript
// Prefer async/await
async function fetchData() {
  try {
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    logger.error('Fetch failed', { url, error });
    throw error;
  }
}

// Avoid callback hell and unhandled promises
fetch(url).then(r => r.json());  // Missing error handling
```

### TypeScript Specific
- Avoid `any` - use `unknown` and type guards
- Prefer interfaces for object shapes
- Use strict mode
- Leverage union types over optional properties when appropriate

### Common Issues
- Missing `await` on async calls
- `==` instead of `===`
- Modifying function parameters
- Not handling Promise rejections
- Using `var` instead of `const`/`let`

## Python

### Style (PEP 8)
```python
# Naming
class MyClass:          # PascalCase
def my_function():      # snake_case
MY_CONSTANT = 42        # SCREAMING_SNAKE

# Imports - grouped and ordered
import os
import sys
from typing import Optional

import third_party

from myapp import module
```

### Modern Python
```python
# Type hints (3.9+)
def process(items: list[str]) -> dict[str, int]:
    return {item: len(item) for item in items}

# Dataclasses over manual __init__
from dataclasses import dataclass

@dataclass
class User:
    name: str
    email: str
    active: bool = True

# Context managers for resources
with open(path) as f:
    data = f.read()

# f-strings over .format()
message = f"Hello, {name}!"
```

### Common Issues
- Mutable default arguments: `def f(items=[])` → `def f(items=None)`
- Missing `with` for file/connection handling
- Bare `except:` clauses
- Not using `if __name__ == '__main__':`
- Global variables

## Java

### Modern Java
```java
// Use var for local variables when type is obvious
var users = new ArrayList<User>();
var name = user.getName();

// Prefer records for data classes (Java 14+)
public record User(String name, String email) {}

// Use Optional, not null
public Optional<User> findById(Long id) {
    return repository.findById(id);
}

// Stream API for collections
var names = users.stream()
    .filter(User::isActive)
    .map(User::getName)
    .toList();
```

### Common Issues
- Returning null instead of Optional or empty collections
- Catching Exception instead of specific types
- Missing `@Override` annotation
- Mutable data classes
- Not closing resources (use try-with-resources)

## Go

### Idiomatic Go
```go
// Error handling - always check
result, err := doSomething()
if err != nil {
    return fmt.Errorf("doSomething failed: %w", err)
}

// Naming: short, but clear
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request)

// Use defer for cleanup
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
```

### Common Issues
- Ignoring errors with `_`
- Not using `defer` for cleanup
- Goroutine leaks (no way to stop them)
- Race conditions (missing mutex/channels)
- Returning pointers to loop variables

## React/Frontend

### Component Patterns
```jsx
// Prefer functional components with hooks
function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    let cancelled = false;
    fetchUser(userId)
      .then(data => !cancelled && setUser(data))
      .catch(err => !cancelled && setError(err));
    return () => { cancelled = true; };
  }, [userId]);
  
  if (error) return <ErrorDisplay error={error} />;
  if (!user) return <Loading />;
  return <Profile user={user} />;
}
```

### Common Issues
- Missing dependency arrays in useEffect
- State updates on unmounted components
- Props drilling (use context or state management)
- Inline function definitions causing re-renders
- Missing keys on list items
- XSS via dangerouslySetInnerHTML

## SQL

### Best Practices
```sql
-- Use parameterized queries (ALWAYS)
-- Explicit column names, not SELECT *
SELECT id, name, email 
FROM users 
WHERE status = ?;

-- Use transactions for multi-step operations
BEGIN TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = ?;
UPDATE accounts SET balance = balance + 100 WHERE id = ?;
COMMIT;

-- Index columns used in WHERE/JOIN
CREATE INDEX idx_users_email ON users(email);
```

### Common Issues
- SELECT * (breaks when schema changes)
- Missing indexes on filtered columns
- N+1 queries in application code
- Not using transactions
- String concatenation (SQL injection)

## Rust

### Idiomatic Rust
```rust
// Use Result for recoverable errors, panic for unrecoverable
fn read_config(path: &str) -> Result<Config, ConfigError> {
    let content = fs::read_to_string(path)?;
    let config: Config = toml::from_str(&content)?;
    Ok(config)
}

// Prefer iterators over manual loops
let sum: i32 = numbers.iter().filter(|n| **n > 0).sum();

// Use Option for nullable values
fn find_user(id: u64) -> Option<User> {
    users.iter().find(|u| u.id == id).cloned()
}

// Ownership: prefer borrowing over cloning
fn process(data: &[u8]) -> Result<(), Error> { ... }  // Borrow
fn process(data: Vec<u8>) -> Result<(), Error> { ... } // Takes ownership
```

### Memory Safety Patterns
```rust
// Use Rc/Arc for shared ownership
use std::sync::Arc;
let shared = Arc::new(data);

// Mutex for thread-safe mutation
use std::sync::Mutex;
let counter = Arc::new(Mutex::new(0));

// RAII - resources cleaned up when dropped
{
    let file = File::open("test.txt")?;
    // file automatically closed at end of scope
}
```

### Common Issues
- Unnecessary `.clone()` calls
- Fighting the borrow checker with complex lifetimes (simplify design)
- Using `unwrap()` in production code (use `?` or proper error handling)
- Not using `#[derive(...)]` for common traits
- Ignoring clippy warnings

## Bash

### Best Practices
```bash
#!/usr/bin/env bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Always quote variables
filename="$1"
echo "Processing: ${filename}"

# Use [[ ]] for conditionals (more robust than [ ])
if [[ -f "$file" && -r "$file" ]]; then
    process "$file"
fi

# Arrays for multiple items
files=("file1.txt" "file2.txt" "file3.txt")
for f in "${files[@]}"; do
    echo "$f"
done

# Use functions
process_file() {
    local file="$1"  # Local variables
    [[ -f "$file" ]] || return 1
    cat "$file"
}

# Safe temporary files
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT
```

### Common Issues
- Missing quotes around variables (`$var` → `"$var"`)
- Using `[ ]` instead of `[[ ]]`
- Not using `set -euo pipefail`
- Parsing `ls` output (use globs or `find`)
- Missing `local` in functions
- Not handling spaces in filenames
- Using `eval` (security risk)

## PowerShell

### Modern PowerShell
```powershell
# Use approved verbs (Get, Set, New, Remove, etc.)
function Get-UserConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Username,
        
        [ValidateSet('Dev', 'Prod')]
        [string]$Environment = 'Dev'
    )
    
    # Use splatting for readability
    $params = @{
        Path = "C:\Config\$Username.json"
        ErrorAction = 'Stop'
    }
    Get-Content @params | ConvertFrom-Json
}

# Pipeline-friendly output
function Get-ProcessInfo {
    Get-Process | Where-Object { $_.CPU -gt 100 } |
        Select-Object Name, CPU, WorkingSet
}

# Error handling
try {
    $result = Invoke-RestMethod -Uri $apiUrl -ErrorAction Stop
} catch [System.Net.WebException] {
    Write-Error "Network error: $_"
} catch {
    Write-Error "Unexpected error: $_"
}
```

### Common Issues
- Using aliases in scripts (`gci` → `Get-ChildItem`)
- Not using `[CmdletBinding()]` for advanced functions
- Ignoring `-ErrorAction` parameter
- String concatenation instead of string interpolation
- Not validating parameters
- Using `Write-Host` instead of `Write-Output`/`Write-Verbose`

## C#

### Modern C# (.NET 6+)
```csharp
// File-scoped namespaces
namespace MyApp.Services;

// Records for immutable data
public record User(string Name, string Email);

// Nullable reference types - enable and respect
public string? FindName(int id) => 
    _users.FirstOrDefault(u => u.Id == id)?.Name;

// Pattern matching
var message = status switch
{
    Status.Active => "User is active",
    Status.Inactive => "User is inactive",
    _ => "Unknown status"
};

// Use async/await properly
public async Task<User> GetUserAsync(int id)
{
    await using var connection = new SqlConnection(_connectionString);
    return await connection.QueryFirstOrDefaultAsync<User>(
        "SELECT * FROM Users WHERE Id = @Id", new { Id = id });
}

// LINQ for collections
var activeUsers = users
    .Where(u => u.IsActive)
    .OrderBy(u => u.Name)
    .ToList();
```

### Common Issues
- Not using `async`/`await` correctly (blocking with `.Result`)
- Ignoring nullable warnings
- Not disposing IDisposable objects (use `using`)
- Catching `Exception` instead of specific types
- Mutable DTOs (use records or init-only properties)
- String concatenation in loops (use `StringBuilder`)

## HTML

### Semantic Structure
```html
<!-- Use semantic elements -->
<header>
    <nav aria-label="Main navigation">
        <ul>
            <li><a href="/">Home</a></li>
        </ul>
    </nav>
</header>

<main>
    <article>
        <h1>Article Title</h1>
        <section>
            <h2>Section Heading</h2>
            <p>Content...</p>
        </section>
    </article>
    
    <aside aria-label="Related content">
        <h2>Related Articles</h2>
    </aside>
</main>

<footer>
    <p>&copy; 2024 Company</p>
</footer>
```

### Accessibility (a11y)
```html
<!-- Images need alt text -->
<img src="chart.png" alt="Sales chart showing 20% growth in Q4">

<!-- Forms need labels -->
<label for="email">Email:</label>
<input type="email" id="email" name="email" required>

<!-- Buttons need accessible names -->
<button aria-label="Close dialog">×</button>

<!-- Use ARIA only when needed -->
<div role="alert" aria-live="polite">Form submitted!</div>
```

### Common Issues
- Missing `alt` attributes on images
- Using `<div>` for everything (use semantic elements)
- Missing `<label>` for form inputs
- Skipping heading levels (`<h1>` → `<h3>`)
- Inline styles (use CSS classes)
- Missing `lang` attribute on `<html>`
- Non-accessible click handlers on non-button elements

## CSS

### Modern CSS
```css
/* CSS Custom Properties (variables) */
:root {
    --color-primary: #3b82f6;
    --spacing-md: 1rem;
    --font-sans: system-ui, sans-serif;
}

/* Use logical properties for i18n */
.card {
    margin-block: var(--spacing-md);
    padding-inline: var(--spacing-md);
}

/* Modern layout with Grid/Flexbox */
.container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--spacing-md);
}

/* Prefer clamp() for responsive sizing */
.title {
    font-size: clamp(1.5rem, 4vw, 3rem);
}

/* Use :is() and :where() for cleaner selectors */
:is(h1, h2, h3):hover {
    color: var(--color-primary);
}
```

### Organization
```css
/* BEM naming convention */
.card { }
.card__header { }
.card__body { }
.card--featured { }

/* Logical property order */
.element {
    /* Positioning */
    position: relative;
    
    /* Box model */
    display: flex;
    width: 100%;
    padding: 1rem;
    
    /* Typography */
    font-size: 1rem;
    color: #333;
    
    /* Visual */
    background: white;
    border-radius: 4px;
    
    /* Animation */
    transition: transform 0.2s;
}
```

### Common Issues
- Using `!important` (specificity issues)
- Magic numbers without variables
- Not using CSS custom properties
- Overly specific selectors (`.header .nav .list .item a`)
- Fixed pixel widths (use relative units)
- Missing focus styles for accessibility
- Not considering reduced-motion preferences
