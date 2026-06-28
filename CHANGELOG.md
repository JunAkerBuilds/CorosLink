# Changelog

All notable changes to CorosLink are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] - 2026-06-28

### Added

- In-app auto-updates via `electron-updater` (GitHub Releases)
- `scripts/verify-release-artifacts.mjs` to fail CI when update metadata is missing
- Training Hub **activity detail** split layout with inline route map, elevation chart, and GPS track fallback from GPX
- Training **heatmap** panel for activity frequency
- Richer parsing for personal records, race predictor, and upcoming workouts

### Changed

- Training Hub activity list and detail panels share a split view for faster browsing
- yt-dlp sync reuses already-downloaded files instead of re-downloading

### Fixed

- macOS CI now builds **DMG + ZIP** so `latest-mac.yml` is generated for auto-update

## [0.1.7] - 2026-06-27

### Added

- Linux x64 **AppImage** builds in CI and GitHub Releases
- Website download button for Linux

## [0.1.6] - 2026-06-27

### Added

- Split **Local library** and **Watch library** panels with a sync layout showing pending transfers at a glance
- Bulk select, transfer, and delete for local downloads and watch tracks
- Training Hub **zone distribution charts** for heart-rate and pace zones (training load, distance, and time)
- **VO₂ max widget** with banded gauge and recent trend readings
- Watch **connection smoke options** for development and testing without a physical watch (Pace Pro, Pace 4, Pace 3, Nomad, and other fixtures)
- GitHub Sponsors metadata and Buy Me a Coffee buttons on the README and website

### Changed

- Refreshed Training Hub layout and styling across fitness scores, trends, recovery ring, and summary tiles
- Updated Nomad hero artwork and training hub screenshot

## [0.1.5] - 2026-06-27

### Added

- Training Hub dashboard panels (fitness scores, race predictor, personal records, upcoming workouts)
- Expanded watch model support (Pace 4, Pace 3, Nomad) with model-specific presentation
- Download progress tracking for YouTube and Spotify sync jobs

### Changed

- Media library overhaul with unified local and watch track management
- Website updates and Vercel/Next.js build fixes

## [0.1.4] - 2026-06-27

### Fixed

- Training Hub activity file downloads

### Changed

- Unified media library with watch track listing
- Disabled YouTube hover previews in the embedded browser
- Migrated project website to Vercel/Next.js

## [0.1.3] - 2026-06-26

### Changed

- Aligned release version in `package.json` with git tags

## [0.1.1] - 2026-06-26

### Added

- GitHub Actions release workflow and installer build documentation

[0.1.8]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/JunAkerBuilds/CorosLink/releases/tag/v0.1.1
