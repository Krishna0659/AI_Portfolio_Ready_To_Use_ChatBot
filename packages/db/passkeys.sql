-- Identity-only storage. Credential material never belongs to the web runtime role.
CREATE TABLE IF NOT EXISTS passkeys (
 id text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
 public_key bytea NOT NULL,
 counter bigint NOT NULL CHECK(counter>=0),
 transports text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS passkey_challenges (
 session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('register','verify')),
 challenge text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 PRIMARY KEY(session_hash,purpose)
);
REVOKE ALL ON passkeys,passkey_challenges FROM PUBLIC,portfolio_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON passkeys,passkey_challenges TO portfolio_identity;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS passkey_verified_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS passkey_enrollment_verified_at timestamptz;
CREATE OR REPLACE FUNCTION public.session_recent(token text,actor uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.sessions WHERE token_hash=token AND user_id=actor
 AND expires_at>now() AND absolute_expires_at>now() AND (
 (passkey_verified_at>now()-interval '5 minutes' AND passkey_verified_at<=now()) OR
 (EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=user_id AND a.issuer<>'https://accounts.google.com')
 AND created_at>now()-interval '10 minutes' AND authenticated_at>now()-interval '10 minutes' AND authenticated_at<=now()+interval '1 minute')));
$$;
