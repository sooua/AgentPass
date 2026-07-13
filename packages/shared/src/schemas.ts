import { z } from "zod";

/** Upper bound on any single secret (1 MiB) — guards against oversized blobs. */
export const MAX_SECRET_BYTES = 1024 * 1024;
const boundedSecret = z
  .string()
  .min(1)
  .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_SECRET_BYTES, {
    message: `secret exceeds ${MAX_SECRET_BYTES} bytes`,
  });

export const targetTypeSchema = z.enum(["ssh", "database", "kubernetes", "api"]);
export const environmentSchema = z.enum(["dev", "staging", "prod"]);
export const credentialTypeSchema = z.enum([
  "password",
  "ssh_private_key",
  "api_token",
  "kubeconfig",
  "database_password",
]);
export const credentialProviderSchema = z.enum([
  "local_encrypted",
  "keychain",
  "openbao",
  "infisical",
]);
export const checkoutModeSchema = z.enum([
  "temp_key_file",
  "ssh_agent_socket",
  "ssh_config",
  "env_vars",
]);

export const createTargetSchema = z.object({
  name: z.string().min(1),
  type: targetTypeSchema,
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  username: z.string().min(1),
  tags: z.array(z.string()).default([]),
  environment: environmentSchema.default("dev"),
  credential_ids: z.array(z.string()).default([]),
});
export type CreateTargetInput = z.infer<typeof createTargetSchema>;

export const updateTargetSchema = createTargetSchema.partial();
export type UpdateTargetInput = z.infer<typeof updateTargetSchema>;

export const createCredentialSchema = z.object({
  name: z.string().min(1),
  type: credentialTypeSchema,
  provider: credentialProviderSchema.default("local_encrypted"),
  /** Plaintext secret material — only ever accepted at this trust boundary. */
  secret_value: boundedSecret,
  metadata: z.record(z.unknown()).default({}),
  rotation_policy_id: z.string().nullable().default(null),
});
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const updateCredentialSchema = z.object({
  name: z.string().min(1).optional(),
  secret_value: boundedSecret.optional(),
  metadata: z.record(z.unknown()).optional(),
  rotation_policy_id: z.string().nullable().optional(),
});
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;

export const revealSchema = z.object({
  target_id: z.string().nullable().default(null),
  requested_by: z.string().min(1),
  purpose: z.string().min(1),
  ttl_seconds: z.number().int().positive().max(86400).default(300),
  /** Consumes an approved RevealRequest when the credential's policy requires approval. */
  approval_id: z.string().optional(),
});
export type RevealInput = z.infer<typeof revealSchema>;

export const decideRevealRequestSchema = z.object({
  decided_by: z.string().min(1).default("operator"),
});
export type DecideRevealRequestInput = z.infer<typeof decideRevealRequestSchema>;

// ---- list query filters (all optional) ----
export const targetQuerySchema = z.object({
  q: z.string().optional(),
  environment: environmentSchema.optional(),
  type: targetTypeSchema.optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type TargetQuery = z.infer<typeof targetQuerySchema>;

export const credentialQuerySchema = z.object({
  q: z.string().optional(),
  type: credentialTypeSchema.optional(),
  status: z.enum(["active", "rotation_required", "expired", "revoked"]).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type CredentialQuery = z.infer<typeof credentialQuerySchema>;

export const auditQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high", "critical"]).optional(),
  limit: z.coerce.number().int().positive().max(2000).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const checkoutSchema = z.object({
  purpose: z.string().min(1),
  requested_by: z.string().min(1),
  ttl_seconds: z.number().int().positive().max(86400).default(900),
  mode: checkoutModeSchema.default("temp_key_file"),
  credential_id: z.string().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const rotationPolicySchema = z.object({
  name: z.string().min(1),
  rotate_after_reveal: z.boolean().default(true),
  rotation_grace_period_minutes: z.number().int().nonnegative().default(60),
  rotation_interval_days: z.number().int().positive().nullable().default(null),
  max_reveals_before_rotation: z.number().int().positive().nullable().default(null),
  auto_rotate_enabled: z.boolean().default(false),
  approval_required: z.boolean().default(false),
});
export type RotationPolicyInput = z.infer<typeof rotationPolicySchema>;

export const updateRotationPolicySchema = rotationPolicySchema.partial();
export type UpdateRotationPolicyInput = z.infer<typeof updateRotationPolicySchema>;

export const rotationReasonSchema = z.enum([
  "manual",
  "after_reveal",
  "scheduled",
  "compromised",
]);

export const createRotationJobSchema = z.object({
  target_id: z.string().nullable().default(null),
  reason: rotationReasonSchema.default("manual"),
});
export type CreateRotationJobInput = z.infer<typeof createRotationJobSchema>;

export const markRotationSuccessSchema = z.object({
  /** New plaintext secret to store as the rotated material. */
  new_secret_value: boundedSecret,
  new_secret_version: z.string().optional(),
});
export type MarkRotationSuccessInput = z.infer<typeof markRotationSuccessSchema>;

export const markRotationFailedSchema = z.object({
  error_message: z.string().min(1),
});
export type MarkRotationFailedInput = z.infer<typeof markRotationFailedSchema>;

// ---- scoped agent tokens (B3) ----
export const capabilitySchema = z.enum(["reveal", "checkout", "list", "rotate", "admin"]);

export const createAgentTokenSchema = z.object({
  name: z.string().min(1),
  capabilities: z.array(capabilitySchema).min(1),
  /** Empty = no restriction (all environments / all targets). */
  environments: z.array(environmentSchema).default([]),
  target_tags: z.array(z.string()).default([]),
  target_ids: z.array(z.string()).default([]),
  /** Optional ISO expiry (TTL). null = never expires. */
  expires_at: z.string().datetime().nullable().default(null),
});
export type CreateAgentTokenInput = z.infer<typeof createAgentTokenSchema>;
