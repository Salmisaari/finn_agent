/**
 * One-time OAuth2 setup for finn@droppe.com Gmail access.
 *
 * Usage:
 *   npx tsx scripts/gmail-auth.ts
 *
 * 1. Opens browser → sign in as finn@droppe.com → grant Gmail access
 * 2. Paste the auth code back here
 * 3. Prints the refresh token to add to Vercel env vars
 */

import http from "http";
import { URL } from "url";

const CLIENT_ID =
  "741669973841-np3k2q0g2g5hkpc59un7og5ctgij33tm.apps.googleusercontent.com";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || process.env.EMAIL_CLIENT_SECRET || "";
const REDIRECT_URI = "http://localhost:3456/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

async function main() {
  if (!CLIENT_SECRET) {
    // Try reading from .env.example hint or ask
    console.log("Set EMAIL_CLIENT_SECRET env var first, e.g.:");
    console.log(
      '  EMAIL_CLIENT_SECRET="<your-secret>" npx tsx scripts/gmail-auth.ts'
    );
    process.exit(1);
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\n1. Open this URL in your browser and sign in as finn@droppe.com:\n");
  console.log(authUrl.toString());
  console.log("\n2. Waiting for callback on localhost:3456...\n");

  const code = await waitForCallback();

  console.log("3. Exchanging code for tokens...\n");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await resp.json();

  if (tokens.error) {
    console.error("Error:", tokens.error, tokens.error_description);
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("Add these to Vercel environment variables:");
  console.log("=".repeat(60));
  console.log(`\nGMAIL_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`GMAIL_CLIENT_SECRET = (already set)`);
  console.log(`GMAIL_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log(`\nAccess token (temporary): ${tokens.access_token?.slice(0, 20)}...`);
  console.log(`Expires in: ${tokens.expires_in}s`);
  console.log("=".repeat(60));
}

function waitForCallback(): Promise<string> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:3456`);
      const code = url.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Done! You can close this tab.</h2><p>Return to terminal.</p>");
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end("No code received");
      }
    });
    server.listen(3456);
  });
}

main();
