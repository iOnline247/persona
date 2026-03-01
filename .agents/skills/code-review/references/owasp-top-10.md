# OWASP Top 10 Security Vulnerabilities Reference

Quick reference for identifying and fixing the most critical web application security risks.

## A01: Broken Access Control

**What to look for:**
- Missing authorization checks on endpoints/functions
- IDOR (Insecure Direct Object References) - user can access others' data by changing IDs
- Missing function-level access control
- CORS misconfiguration
- JWT tokens without proper validation

**Vulnerable:**
```javascript
// No authorization check - any user can access any order
app.get('/api/orders/:id', (req, res) => {
  const order = db.getOrder(req.params.id);
  res.json(order);
});
```

**Secure:**
```javascript
app.get('/api/orders/:id', authenticate, (req, res) => {
  const order = db.getOrder(req.params.id);
  if (order.userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(order);
});
```

## A02: Cryptographic Failures

**What to look for:**
- Sensitive data transmitted in cleartext
- Weak/deprecated algorithms (MD5, SHA1 for passwords, DES)
- Hardcoded encryption keys
- Missing encryption for sensitive data at rest
- Weak password hashing (no salt, fast algorithms)

**Vulnerable:**
```python
# MD5 is cryptographically broken
import hashlib
password_hash = hashlib.md5(password.encode()).hexdigest()
```

**Secure:**
```python
import bcrypt
password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12))
```

## A03: Injection

**What to look for:**
- String concatenation in SQL/NoSQL queries
- User input in shell commands
- User input in LDAP/XPath queries
- Template injection
- Log injection

**Vulnerable (SQL):**
```python
query = f"SELECT * FROM users WHERE id = {user_id}"
cursor.execute(query)
```

**Secure:**
```python
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

**Vulnerable (Command):**
```javascript
const { exec } = require('child_process');
exec(`convert ${userInput}.png output.jpg`);  // Command injection
```

**Secure:**
```javascript
const { execFile } = require('child_process');
execFile('convert', [`${sanitizedFilename}.png`, 'output.jpg']);
```

## A04: Insecure Design

**What to look for:**
- Missing rate limiting on sensitive operations
- No account lockout after failed attempts
- Missing CAPTCHA on public forms
- Business logic flaws
- Missing fraud controls

**Vulnerable:**
```python
# No rate limiting - allows brute force
@app.route('/login', methods=['POST'])
def login():
    if check_password(request.form['password']):
        return create_session()
```

**Secure:**
```python
from flask_limiter import Limiter
limiter = Limiter(app, default_limits=["5 per minute"])

@app.route('/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    # Also implement account lockout after N failures
```

## A05: Security Misconfiguration

**What to look for:**
- Debug mode enabled in production
- Default credentials
- Unnecessary features enabled
- Missing security headers
- Verbose error messages exposing internals
- Outdated software

**Vulnerable:**
```python
app = Flask(__name__)
app.debug = True  # Never in production!
```

**Secure:**
```python
app = Flask(__name__)
app.debug = os.environ.get('FLASK_ENV') == 'development'

# Add security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response
```

## A06: Vulnerable and Outdated Components

**What to look for:**
- Outdated dependencies with known CVEs
- Unmaintained libraries
- Missing dependency scanning in CI/CD

**Actions:**
- Run `npm audit`, `pip-audit`, `snyk`, or similar
- Check dependencies against CVE databases
- Enable Dependabot/Renovate for automatic updates

## A07: Identification and Authentication Failures

**What to look for:**
- Weak password requirements
- Missing MFA on sensitive operations
- Session tokens in URLs
- Sessions that don't expire
- Session fixation vulnerabilities
- Credential stuffing susceptibility

**Vulnerable:**
```javascript
// Session never expires, stored insecurely
app.post('/login', (req, res) => {
  const token = generateToken();
  res.cookie('session', token);  // Missing security flags
});
```

**Secure:**
```javascript
app.post('/login', (req, res) => {
  const token = generateSecureToken();
  res.cookie('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 3600000  // 1 hour
  });
});
```

## A08: Software and Data Integrity Failures

**What to look for:**
- Deserialization of untrusted data
- CI/CD pipeline without integrity verification
- Auto-update without signature verification
- Unsigned/unverified dependencies

**Vulnerable:**
```python
import pickle
# Never unpickle untrusted data!
data = pickle.loads(user_input)
```

**Secure:**
```python
import json
# Use safe serialization formats
data = json.loads(user_input)
# Validate against schema
```

## A09: Security Logging and Monitoring Failures

**What to look for:**
- Missing logs for authentication events
- No logging of access control failures
- Sensitive data in logs
- Logs not protected from tampering
- No alerting on suspicious activity

**Vulnerable:**
```python
# Logs password in cleartext!
logger.info(f"Login attempt: user={username}, pass={password}")
```

**Secure:**
```python
logger.info(f"Login attempt: user={username}, success={success}, ip={request.remote_addr}")
# Never log passwords, tokens, or PII
```

## A10: Server-Side Request Forgery (SSRF)

**What to look for:**
- User-controlled URLs being fetched server-side
- URL parameters passed to HTTP clients
- Webhook URLs without validation

**Vulnerable:**
```python
@app.route('/fetch')
def fetch_url():
    url = request.args.get('url')
    return requests.get(url).text  # SSRF vulnerability
```

**Secure:**
```python
from urllib.parse import urlparse

ALLOWED_HOSTS = ['api.example.com', 'cdn.example.com']

@app.route('/fetch')
def fetch_url():
    url = request.args.get('url')
    parsed = urlparse(url)
    if parsed.hostname not in ALLOWED_HOSTS:
        return 'Forbidden', 403
    if parsed.scheme not in ['http', 'https']:
        return 'Forbidden', 403
    return requests.get(url).text
```

## Additional Critical Patterns

### Cross-Site Scripting (XSS)

**Vulnerable:**
```javascript
element.innerHTML = userInput;  // DOM XSS
```

**Secure:**
```javascript
element.textContent = userInput;
// Or use DOMPurify for HTML content
element.innerHTML = DOMPurify.sanitize(userInput);
```

### Path Traversal

**Vulnerable:**
```python
with open(f"/uploads/{filename}") as f:  # ../../../etc/passwd
```

**Secure:**
```python
import os
safe_path = os.path.normpath(os.path.join('/uploads', filename))
if not safe_path.startswith('/uploads/'):
    raise ValueError("Invalid path")
```

### Mass Assignment

**Vulnerable:**
```javascript
User.update(req.body);  // User can set isAdmin: true
```

**Secure:**
```javascript
const { name, email } = req.body;
User.update({ name, email });  // Whitelist allowed fields
```
