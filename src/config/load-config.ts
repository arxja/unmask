import z from "zod";
import { cosmiconfig } from "cosmiconfig";
import { ConfigSchema } from "./schema";

export type Config = z.infer<typeof ConfigSchema>;

export async function configLoader(searchFrom?: string): Promise<Config> {
  const explorer = cosmiconfig("unmask");

  try {
    // Search for the config file starting from the specified directory
    const result = await explorer.search(searchFrom);

    // If no config file is found, return the parsed defaults from Zod
    if (!result || result.isEmpty) {
      return ConfigSchema.parse({});
    }

    // If a config is found, validate its contents with Zod
    const validatedConfig = ConfigSchema.parse(result.config);
    return validatedConfig;
  } catch (error) {
    // Handle parsing or validation errors
    console.error("Error loading or validating configuration:", error);
    throw error;
  }
}
