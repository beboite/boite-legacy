// Node answers `navigator.language` with the host's locale. `t()` follows it,
// serves English while that dictionary loads, then switches mid-file once the
// import lands: on a French machine an assertion on English text passed or
// failed on timing. Tests pin English, the locale CI has. `detectLocale` tests
// stub the global themselves.
for (const [key, value] of [
  ["language", "en-US"],
  ["languages", ["en-US"]],
] as const) {
  Object.defineProperty(globalThis.navigator, key, { value, configurable: true });
}
