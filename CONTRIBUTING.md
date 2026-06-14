# Contributing to atelier

Thanks for your interest! atelier is open source under a **noncommercial**
license (see [LICENSE.md](LICENSE.md)) — contributions are welcome for
noncommercial use.

## Ways to contribute

- 🐛 **Bug?** Open an [issue](https://github.com/feelgoodrp-com/atelier/issues/new/choose)
  with steps to reproduce.
- ✨ **Idea / feature?** Open an issue to discuss it first, especially for larger
  changes.
- 🔧 **Code?** Fork → branch → pull request (see below).

## Development

Requirements: [Bun](https://bun.sh), Rust (stable) and the .NET 8 SDK
(see [`sidecar/README.md`](sidecar/README.md)).

```powershell
bun install
bun run tauri dev          # app + .NET sidecar
bun run build              # frontend typecheck + bundle
bun run selftest:project   # project-format / sync self-test
cargo check --manifest-path src-tauri/Cargo.toml
```

## Pull requests

1. Fork the repo and create a branch off `master` (`feat/…`, `fix/…`).
2. Keep the change focused and match the surrounding code style.
3. Make sure `bun run build` and `bun run selftest:project` pass — CI runs the
   same checks plus the sidecar build and a `cargo check`.
4. Open a PR against `master`, fill in the template and link any related issue.

A maintainer reviews and merges. Direct pushes to `master` are restricted — all
changes land via a pull request that passes CI.

## License of contributions

By contributing, you agree that your contributions are licensed under the
project's [PolyForm Noncommercial 1.0.0](LICENSE.md) license.
