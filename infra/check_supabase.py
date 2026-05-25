import os
import sys
import urllib.parse

try:
    import psycopg2
except ImportError:
    print("[Info] psycopg2 not installed. Installing psycopg2-binary...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2

# Direct connection parameters for project uejwhikwtjikrsbnaabo
DB_PARAMS = {
    "host": "aws-1-ap-south-1.pooler.supabase.com",
    "port": 6543,
    "user": "postgres.uejwhikwtjikrsbnaabo",
    "password": "Aryanrajsinha801%40%40",
    "database": "postgres",
    "sslmode": "require"
}

try:
    print(f"Connecting to database using parameters...")
    conn = psycopg2.connect(**DB_PARAMS)
except Exception as e:
    raise Exception(f"Failed to connect to Supabase: {e}")

print("====================================================")
print("NexaLink Supabase Database Verification Utility")
print("====================================================")

try:
    print(f"Connecting to database using parameters...")
    conn = psycopg2.connect(**DB_PARAMS)
    conn.autocommit = True
    cursor = conn.cursor()
    print(" [OK] Connected successfully to Supabase PostgreSQL!")
    
    # 1. Check pgvector extension
    cursor.execute("SELECT extname FROM pg_extension WHERE extname = 'vector';")
    ext = cursor.fetchone()
    if ext:
        print(" [OK] pgvector extension is enabled.")
    else:
        print(" [WARNING] pgvector extension is NOT enabled. Enabling it...")
        try:
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            print(" [OK] pgvector extension enabled successfully.")
        except Exception as e:
            print(f" [ERROR] Failed to enable pgvector: {e}")

    # 2. Check Tables
    expected_tables = ["user_profiles", "rooms", "call_logs", "recording_consents", "meeting_summaries"]
    print("\nChecking tables in public schema:")
    
    cursor.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public';
    """)
    existing_tables = [row[0] for row in cursor.fetchall()]
    
    for table in expected_tables:
        if table in existing_tables:
            print(f" [OK] Table 'public.{table}' exists.")
            # Check if RLS is enabled
            cursor.execute(f"""
                SELECT relrowsecurity 
                FROM pg_class 
                WHERE relname = '{table}' AND relnamespace = 'public'::regnamespace;
            """)
            rls = cursor.fetchone()
            if rls and rls[0]:
                print(f"      - Row Level Security (RLS): Enabled")
            else:
                print(f"      - [WARNING] Row Level Security (RLS): DISABLED!")
                
            # Check policies
            cursor.execute(f"""
                SELECT policyname, cmd, qual, with_check 
                FROM pg_policies 
                WHERE tablename = '{table}' AND schemaname = 'public';
            """)
            policies = cursor.fetchall()
            if policies:
                print(f"      - Active Policies:")
                for p in policies:
                    print(f"        * '{p[0]}' for {p[1]} (USING: {p[2]})")
            else:
                print(f"      - [WARNING] No active policies found.")
        else:
            print(f" [MISSING] Table 'public.{table}' is NOT created in the database!")

    # 3. Check new user trigger and function
    print("\nChecking trigger and trigger function:")
    cursor.execute("""
        SELECT routine_name 
        FROM information_schema.routines 
        WHERE routine_schema = 'public' AND routine_name = 'handle_new_user';
    """)
    func = cursor.fetchone()
    if func:
        print(" [OK] Function 'public.handle_new_user' exists.")
    else:
        print(" [MISSING] Function 'public.handle_new_user' is NOT created!")

    cursor.execute("""
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE trigger_schema = 'public' AND trigger_name = 'on_auth_user_created';
    """)
    trig = cursor.fetchone()
    if trig:
        print(" [OK] Trigger 'on_auth_user_created' exists.")
    else:
        print(" [MISSING] Trigger 'on_auth_user_created' is NOT created!")

    cursor.close()
    conn.close()
    print("\nVerification complete!")
except Exception as e:
    print(f"\n[FATAL ERROR] Connection or verification failed: {e}")
    sys.exit(1)
