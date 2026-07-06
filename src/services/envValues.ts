export function firstEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value) {
      return value;
    }
  }
  return undefined;
}
