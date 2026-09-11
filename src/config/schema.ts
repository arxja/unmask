import z from "zod";

export const ConfigSchema = z.object({
  ignore: z.array(z.string()).nonempty().optional(),
  customPatterns: z.string().min(1).optional(),
});
