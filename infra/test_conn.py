import psycopg2
import sys

db_url = "postgresql://postgres:Aryanrajsinha801%40%40@db.uejwhikwtjikrsbnaabo.supabase.co:5432/postgres"

print("Trying to connect to Supabase using URL...")
try:
    conn = psycopg2.connect(db_url)
    print(" [OK] Connected successfully!")
    conn.close()
except Exception as e:
    print(f" [ERROR] Connection failed: {e}")
    sys.exit(1)
