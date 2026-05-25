import os
import urllib.request
import json
import ssl
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("SUPABASE_ACCESS_TOKEN", "")
project_ref = "uejwhikwtjikrsbnaabo"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# Ignore SSL verification issues if any
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch_api(url):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error calling {url}: {e}")
        if hasattr(e, 'read'):
            print(e.read().decode())
        return None

print("Fetching organizations...")
orgs = fetch_api("https://api.supabase.com/v1/organizations")
if orgs:
    print(json.dumps(orgs, indent=2))

print("\nFetching specific project details...")
project_details = fetch_api(f"https://api.supabase.com/v1/projects/{project_ref}")
if project_details:
    print(json.dumps(project_details, indent=2))

print("\nFetching project API keys...")
keys = fetch_api(f"https://api.supabase.com/v1/projects/{project_ref}/api-keys")
if keys:
    print(json.dumps(keys, indent=2))
