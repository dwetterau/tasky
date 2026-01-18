# Tasky

A personal task manager built with Next.js and Convex.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Convex

```bash
npx convex dev
```

This will prompt you to log in and create a project. Keep this running.

### 3. Create GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set Homepage URL: `http://localhost:3000`
4. Set Callback URL: `https://<your-project>.convex.site/api/auth/callback/github`
5. Copy the Client ID and Client Secret

### 4. Set environment variables

```bash
npx convex env set SITE_URL "http://localhost:3000"
npx convex env set AUTH_GITHUB_ID "<your-github-client-id>"
npx convex env set AUTH_GITHUB_SECRET "<your-github-client-secret>"
```

Generate and set JWT keys:

```bash
node -e "
const crypto = require('crypto');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const jwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' });
jwk.alg = 'RS256';
jwk.use = 'sig';
console.log('JWT_PRIVATE_KEY:', privateKey);
console.log('JWKS:', JSON.stringify({ keys: [jwk] }));
"
```

Then set them:

```bash
npx convex env set JWT_PRIVATE_KEY -- "<private-key>"
npx convex env set JWKS '<jwks-json>'
```

### 5. Run the app

```bash
npm run dev
```

Open http://localhost:3000
