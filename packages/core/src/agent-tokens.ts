import { createHash, randomBytes } from "node:crypto";
import {
  isPast,
  newId,
  nowIso,
  type AgentToken,
  type AgentTokenPublic,
  type Capability,
  type CreateAgentTokenInput,
  type Environment,
} from "@agentpass/shared";
import { forbidden } from "./errors.js";
import type { Repository } from "./ports.js";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
/** How stale last_used_at may get before we bother writing it again. */
const LAST_USED_DEBOUNCE_MS = 60_000;
const strip = (t: AgentToken): AgentTokenPublic => {
  const { token_hash: _hash, ...rest } = t;
  return rest;
};

/** What an operation requires of the calling token. */
export interface AuthzNeed {
  capability: Capability;
  env?: Environment | null;
  targetTags?: string[];
  targetId?: string | null;
}

/**
 * Manages scoped per-agent tokens: create/list/revoke, authentication (hash
 * match + expiry/revocation) and per-operation authorization (capability +
 * environment + target whitelist). The full-power root token is handled
 * separately in the daemon and never touches this service.
 */
export class AgentTokenService {
  constructor(private readonly repo: Repository) {}

  /** Create a token; returns metadata plus the plaintext ONCE (never stored). */
  create(input: CreateAgentTokenInput): { token: AgentTokenPublic; plaintext: string } {
    const plaintext = `apat_${randomBytes(24).toString("base64url")}`;
    const t: AgentToken = {
      id: newId("atok"),
      name: input.name,
      token_hash: sha256(plaintext),
      capabilities: input.capabilities,
      environments: input.environments,
      target_tags: input.target_tags,
      target_ids: input.target_ids,
      expires_at: input.expires_at,
      created_at: nowIso(),
      last_used_at: null,
      revoked: false,
    };
    this.repo.createAgentToken(t);
    return { token: strip(t), plaintext };
  }

  list(): AgentTokenPublic[] {
    return this.repo.listAgentTokens().map(strip);
  }

  revoke(id: string): AgentTokenPublic | null {
    const updated = this.repo.updateAgentToken(id, { revoked: true });
    return updated ? strip(updated) : null;
  }

  /**
   * Resolve a raw bearer token to its AgentToken, or null if unknown, revoked
   * or expired. Runs on every authenticated request, so: indexed lookup by hash
   * (no full-table scan) and last_used_at written at most once per minute (no
   * DB write on the read path for back-to-back calls).
   */
  authenticate(raw: string): AgentToken | null {
    const hash = sha256(raw);
    const t = this.repo.findAgentTokenByHash(hash);
    if (!t || t.revoked) return null;
    if (t.expires_at && isPast(t.expires_at)) return null;
    const last = t.last_used_at ? Date.parse(t.last_used_at) : 0;
    if (Date.now() - last > LAST_USED_DEBOUNCE_MS)
      this.repo.updateAgentToken(t.id, { last_used_at: nowIso() });
    return t;
  }

  /** Throw 403 forbidden unless the token satisfies the operation's need. */
  authorize(token: AgentToken, need: AuthzNeed): void {
    const envLabel = need.env ?? "*";
    if (!token.capabilities.includes(need.capability))
      throw forbidden(`token not allowed to ${need.capability} ${envLabel}`);

    // Environment whitelist (empty = all). Enforced whenever an env is in play.
    if (need.env && token.environments.length > 0 && !token.environments.includes(need.env))
      throw forbidden(`token not allowed to ${need.capability} ${need.env}`);

    // Target whitelist (empty tags AND empty ids = all).
    const scoped = token.target_tags.length > 0 || token.target_ids.length > 0;
    if (scoped) {
      const idOk = need.targetId != null && token.target_ids.includes(need.targetId);
      const tagOk = (need.targetTags ?? []).some((tag) => token.target_tags.includes(tag));
      if (!idOk && !tagOk)
        throw forbidden(`token not allowed to ${need.capability} ${envLabel} on this target`);
    }
  }
}
