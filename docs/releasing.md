# Releasing

Home Assistant installs only `echo-show-card.js`. The file in the repository root is the
source and installable artifact; there is no bundler or separate generated copy to maintain.

Before the first public push, set the GitHub repository description to something like
“Home Assistant kiosk clock, calendar agenda and CO2 background”, enable Issues, and add
topics such as `home-assistant`, `hacs`, `lovelace-card` and `dashboard`. Keep the repository
public so HACS can access it. The README, MIT license and `hacs.json` are included.

The HACS job skips the README image check because this custom repository intentionally has no
screenshots. For inclusion in the default HACS catalog, add README images and remove
`ignore: images` so every required check passes without exceptions.

To prepare a version:

1. Update `package.json` and `package-lock.json` together; `npm version 0.1.0 --no-git-tag-version`
   can set the first version without creating a commit or tag. Move the relevant changelog
   entries from Unreleased into a dated version section.
2. Run `npm ci`, `npm run check`, `npm test`, and `npm run test:browser`. Install Chromium with
   `npx playwright install chromium` if needed. Review the screenshots and changes.
3. Commit and push the reviewed changes when authorized. Wait for the Checks and HACS jobs
   to pass. The local metadata check does not replace the hosted HACS validation.
4. In GitHub, create a release tagged `v0.1.0` (or the new version) from that tested commit.
   Attach the root `echo-show-card.js` as a release asset, with exactly that filename. Copy
   the relevant changelog entries into the release description and publish when authorized.
5. Check that HACS offers that version. Reload the browser after installing it and check a
   real calendar and sensor on the kiosk. Local browser tests use synthetic data.

HACS can also install the default branch before a first release. Once releases are used,
publish a GitHub release for each update; a tag alone is insufficient. Retain the card file
in the repository root as well as attaching it to releases.

See the [HACS plugin requirements](https://www.hacs.xyz/docs/publish/plugin/),
[repository metadata requirements](https://www.hacs.xyz/docs/publish/start/) and
[validation action](https://www.hacs.xyz/docs/publish/action/).
