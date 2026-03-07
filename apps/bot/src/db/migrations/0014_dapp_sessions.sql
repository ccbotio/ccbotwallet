-- CIP-103 dApp Session Tables
-- Migration: 0014_dapp_sessions
-- Description: Tables for CIP-103 Canton dApp Standard implementation

-- dapp_sessions: Temporary sessions for dApp interaction requests
-- Each session represents a JSON-RPC request from an external dApp
CREATE TABLE dapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(64) NOT NULL UNIQUE,

  -- PKCE (Proof Key for Code Exchange)
  code_challenge VARCHAR(128) NOT NULL,

  -- dApp information
  dapp_origin VARCHAR(512) NOT NULL,
  dapp_name VARCHAR(128),
  dapp_icon VARCHAR(512),
  callback_url VARCHAR(1024) NOT NULL,

  -- JSON-RPC request
  method VARCHAR(64) NOT NULL,
  params JSONB,
  request_id VARCHAR(128),

  -- User binding (set when user approves)
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,

  -- Session status: pending, awaiting_user, approved, rejected, expired, completed
  status VARCHAR(16) NOT NULL DEFAULT 'pending',

  -- Result (set on completion)
  result JSONB,
  error_code INTEGER,
  error_message VARCHAR(512),

  -- Security tracking
  request_ip VARCHAR(64),
  user_agent VARCHAR(512),

  -- Timestamps
  expires_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_dapp_session_id ON dapp_sessions(session_id);
CREATE INDEX idx_dapp_session_user ON dapp_sessions(user_id);
CREATE INDEX idx_dapp_session_status ON dapp_sessions(status);
CREATE INDEX idx_dapp_session_expires ON dapp_sessions(expires_at);

-- dapp_connections: Persistent dApp connections (after user approves connect)
-- Tracks which dApps are allowed to interact with user's wallet
CREATE TABLE dapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,

  -- dApp identification
  dapp_origin VARCHAR(512) NOT NULL,
  dapp_name VARCHAR(128),

  -- Connection status
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Granted permissions (JSON array of permission strings)
  permissions JSONB DEFAULT '[]',

  -- Timestamps
  connected_at TIMESTAMP DEFAULT NOW() NOT NULL,
  last_used_at TIMESTAMP DEFAULT NOW() NOT NULL,
  disconnected_at TIMESTAMP
);

CREATE INDEX idx_dapp_connection_user ON dapp_connections(user_id);
CREATE INDEX idx_dapp_connection_origin ON dapp_connections(dapp_origin);
CREATE INDEX idx_dapp_connection_active ON dapp_connections(is_active) WHERE is_active = true;

-- Unique constraint: one active connection per user+origin
CREATE UNIQUE INDEX idx_dapp_connection_unique_active
  ON dapp_connections(user_id, dapp_origin)
  WHERE is_active = true;
