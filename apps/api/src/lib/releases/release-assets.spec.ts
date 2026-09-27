import { describe, expect, it } from 'vitest';

import { isValidAssetName, releaseAssetKey } from './release-assets.js';

describe('releaseAssetKey', () => {
  it('names an object, or the prefix of a release or repository', () => {
    expect(releaseAssetKey('repo_1', 'release_1', 'asset_1')).toBe(
      'release-assets/repo_1/release_1/asset_1',
    );
    expect(releaseAssetKey('repo_1', 'release_1')).toBe(
      'release-assets/repo_1/release_1/',
    );
    expect(releaseAssetKey('repo_1')).toBe('release-assets/repo_1/');
  });
});

describe('isValidAssetName', () => {
  it('accepts file names', () => {
    for (const name of [
      'app.zip',
      'ghost-v1.0.0-linux-x64.tar.gz',
      'a b (1).dmg',
    ]) {
      expect(isValidAssetName(name)).toBe(true);
    }
  });

  it('refuses paths, dot names, control characters and empty or long names', () => {
    for (const name of [
      '',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a\nb',
      'x'.repeat(256),
    ]) {
      expect(isValidAssetName(name)).toBe(false);
    }
  });
});
