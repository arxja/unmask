import { scanForSecrets } from "../discovery/file-discovery";

export default async function scan(patternsPath: string, targetDir: string) {
  const findings = scanForSecrets(patternsPath, targetDir)
  console.log(findings)
}
