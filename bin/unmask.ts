#!/usr/bin/env node
import { program } from "commander";
import scan from "../src/commands/scan";

program.name("unmask").version("1.0.0");

program
  .command("scan <patterns> <targetDir>")
  .alias("s")
  .description("Scan target directory for secrets")
  .action(async (patterns: string, targetDir: string) => {
    console.log("hello");
    await scan(patterns, targetDir);
  });

program.parseAsync(process.argv);
