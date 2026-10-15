/**
 * Scanner pins, pure. Every security tool the harness installs on a CI runner is one exact version
 * and one release asset per platform, each with the SHA256 of the archive. `pinnedAsset` looks the
 * asset up and `checkDigest` decides whether a downloaded archive is the ones that were pinned, so a
 * swapped or tampered release asset fails the gate instead of running.
 */
export type ToolName = "gitleaks" | "actionlint" | "zizmor"

export interface PinnedAsset {
  readonly version: string
  readonly url: string
  /** Lowercase hex SHA256 of the downloaded archive. */
  readonly sha256: string
  /** Where the binary sits inside the archive. */
  readonly binary: string
}

export const GITLEAKS_VERSION = "8.30.1"
export const ACTIONLINT_VERSION = "1.7.12"
export const ZIZMOR_VERSION = "1.30.1"

const gitleaks = (input: { readonly suffix: string; readonly sha256: string }): PinnedAsset => ({
  version: GITLEAKS_VERSION,
  url: `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${input.suffix}.tar.gz`,
  sha256: input.sha256,
  binary: "gitleaks",
})

const actionlint = (input: { readonly suffix: string; readonly sha256: string }): PinnedAsset => ({
  version: ACTIONLINT_VERSION,
  url: `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${input.suffix}.tar.gz`,
  sha256: input.sha256,
  binary: "actionlint",
})

const zizmor = (input: { readonly triple: string; readonly sha256: string }): PinnedAsset => ({
  version: ZIZMOR_VERSION,
  url: `https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-${input.triple}.tar.gz`,
  sha256: input.sha256,
  binary: "zizmor",
})

/** Pinned assets by tool, then by `${process.platform}-${process.arch}`. */
export const PINS: Readonly<Record<ToolName, Readonly<Record<string, PinnedAsset>>>> = {
  gitleaks: {
    "darwin-arm64": gitleaks({
      suffix: "darwin_arm64",
      sha256: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    }),
    "darwin-x64": gitleaks({
      suffix: "darwin_x64",
      sha256: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
    }),
    "linux-arm64": gitleaks({
      suffix: "linux_arm64",
      sha256: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
    }),
    "linux-x64": gitleaks({
      suffix: "linux_x64",
      sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    }),
  },
  actionlint: {
    "darwin-arm64": actionlint({
      suffix: "darwin_arm64",
      sha256: "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
    }),
    "darwin-x64": actionlint({
      suffix: "darwin_amd64",
      sha256: "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
    }),
    "linux-arm64": actionlint({
      suffix: "linux_arm64",
      sha256: "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
    }),
    "linux-x64": actionlint({
      suffix: "linux_amd64",
      sha256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
    }),
  },
  zizmor: {
    "darwin-arm64": zizmor({
      triple: "aarch64-apple-darwin",
      sha256: "e28d22b087f9ebb8d99da6e740d348c930f559961c7c3f12badda54f882195a2",
    }),
    "darwin-x64": zizmor({
      triple: "x86_64-apple-darwin",
      sha256: "10e6b18b11ea07e515a16f0f0518c7b07527bc9977c1fd5698181ce7f3554202",
    }),
    "linux-arm64": zizmor({
      triple: "aarch64-unknown-linux-gnu",
      sha256: "7ff1dce33bdd18fd2a4affe63bdd47efcccca97b2cec1c1863ec26e9e2647540",
    }),
    "linux-x64": zizmor({
      triple: "x86_64-unknown-linux-gnu",
      sha256: "e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a",
    }),
  },
}

export const pinnedAsset = (input: {
  readonly tool: ToolName
  readonly platform: string
  readonly arch: string
}): PinnedAsset | undefined => PINS[input.tool][`${input.platform}-${input.arch}`]

/** Undefined when the archive's digest matches the pin; otherwise the problem, naming both. */
export const checkDigest = (input: {
  readonly asset: PinnedAsset
  /** Lowercase hex SHA256 of the downloaded bytes, computed by the shell. */
  readonly digest: string
}): string | undefined =>
  input.digest === input.asset.sha256
    ? undefined
    : `SHA256 mismatch for ${input.asset.url}: expected ${input.asset.sha256}, got ${input.digest}`
