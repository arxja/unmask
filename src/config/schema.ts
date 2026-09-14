import z from "zod";

export const ConfigSchema = z.object({
  ignore: z.array(z.string()).default([]),
  customPatterns: z.string().min(1).optional(),
  failOn: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  include: z.array(z.string()).optional(),
});
