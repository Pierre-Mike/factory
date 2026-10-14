/**
 * Typed configuration: the one place the app reads its environment. On Workers the env is an
 * object handed to `fetch`, so this decodes that object with a Schema. A malformed env fails the
 * first request loudly with a ParseError instead of half-working.
 */
import { Effect, Schema as S } from "effect"

const Env = S.Struct({
  APP_VERSION: S.String.pipe(S.withDecodingDefaultType(Effect.succeed("0.0.0"))),
  ENVIRONMENT: S.Literals(["development", "production"]).pipe(
    S.withDecodingDefaultType(Effect.succeed("development" as const)),
  ),
})

export interface AppConfig {
  readonly version: string
  readonly environment: "development" | "production"
}

/** Decode the Worker env. Bindings such as DB are ignored here; worker.ts wires them. */
export const decodeConfig = (env: unknown): AppConfig => {
  const decoded = S.decodeUnknownSync(Env)(env)
  return { version: decoded.APP_VERSION, environment: decoded.ENVIRONMENT }
}
