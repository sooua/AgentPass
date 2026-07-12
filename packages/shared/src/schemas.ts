import { z } from "zod";

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
  secret_value: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  rotation_policy_id: z.string().nullable().default(null),
});
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const updateCredentialSchema = z.object({
  name: z.string().min(1).optional(),
  secret_value: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  rotation_policy_id: z.string().nullable().optional(),
});
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;

export const revealSchema = z.object({
  target_id: z.string().nullable().default(null),
  requested_by: z.string().min(1),
  purpose: z.string().min(1),
  ttl_seconds: z.number().int().positive().max(86400).default(300),
});
export type RevealInput = z.infer<typeof revealSchema>;

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
  new_secret_value: z.string().min(1),
  new_secret_version: z.string().optional(),
});
export type MarkRotationSuccessInput = z.infer<typeof markRotationSuccessSchema>;

export const markRotationFailedSchema = z.object({
  error_message: z.string().min(1),
});
export type MarkRotationFailedInput = z.infer<typeof markRotationFailedSchema>;
